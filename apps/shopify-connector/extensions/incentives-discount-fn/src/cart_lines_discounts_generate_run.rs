use super::schema;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use shopify_function::prelude::*;
use shopify_function::Result;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncentivesEval {
    evaluation_id: String,
    #[serde(default)]
    shop_domain: Option<String>,
    #[serde(default)]
    cart_id: Option<String>,
    #[serde(default)]
    checkout_token: Option<String>,
    #[serde(default)]
    cart_fingerprint: Option<String>,
    subtotal_minor_units: i64,
    currency: String,
    discount_minor_units: i64,
    #[serde(default)]
    lease_id: Option<String>,
    #[serde(default)]
    lease_expires_at: Option<String>,
    #[serde(default)]
    target: Option<String>,
    expires_at: String,
    signature: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintLine {
    line_ref: String,
    product_ref: String,
    variant_ref: Option<String>,
    quantity: i64,
    unit_price: i64,
}

#[derive(Debug, Serialize)]
struct Fingerprint {
    currency: String,
    subtotal: i64,
    lines: Vec<FingerprintLine>,
}

pub fn parse_to_minor_units(amount: &str) -> Option<i64> {
    let trimmed = amount.trim();
    if trimmed.is_empty() {
        return None;
    }
    let negative = trimmed.starts_with('-');
    let unsigned = if negative { &trimmed[1..] } else { trimmed };
    let parts: Vec<&str> = unsigned.split('.').collect();
    if parts.len() > 2 || parts.iter().any(|part| !part.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    let whole: i64 = if parts[0].is_empty() { 0 } else { parts[0].parse().ok()? };
    let fraction = parts.get(1).copied().unwrap_or("");
    let cents: i64 = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 10,
        2 => fraction.parse::<i64>().ok()?,
        _ => {
            let first_two: i64 = fraction[..2].parse().ok()?;
            let third: i64 = fraction[2..3].parse().ok()?;
            if third >= 5 { first_two + 1 } else { first_two }
        }
    };
    let total = whole.checked_mul(100)?.checked_add(cents)?;
    Some(if negative { -total } else { total })
}

fn verify_signature(secret: &str, message: &str, signature: &str) -> bool {
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(mac) => mac,
        Err(_) => return false,
    };
    mac.update(message.as_bytes());
    let signature = match hex::decode(signature.trim()) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    mac.verify_slice(&signature).is_ok()
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if is_leap_year(year) { 29 } else { 28 },
        _ => 0,
    }
}

/// Parses YYYY-MM-DD and subtracts one calendar day. Used to give the
/// date-granularity expiry a one-day tolerance for shop-local timezones.
fn previous_day(date: &str) -> Option<String> {
    let mut parts = date.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || month == 0 || month > 12 || day == 0
        || day > days_in_month(year, month)
    {
        return None;
    }

    let (mut year, mut month, mut day) = (year, month, day);
    if day > 1 {
        day -= 1;
    } else if month > 1 {
        month -= 1;
        day = days_in_month(year, month);
    } else {
        year -= 1;
        month = 12;
        day = 31;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn cart_fingerprint(input: &schema::cart_lines_discounts_generate_run::Input) -> Option<String> {
    let mut lines = Vec::new();
    for line in input.cart().lines() {
        let quantity = i64::from(*line.quantity());
        if quantity <= 0 {
            return None;
        }
        let line_total = parse_to_minor_units(&line.cost().total_amount().amount().to_string())?;
        let unit_price = (line_total + quantity / 2) / quantity;
        let (product_ref, variant_ref) = match line.merchandise() {
            schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(
                variant,
            ) => (
                variant.product().id().to_string(),
                Some(variant.id().to_string()),
            ),
            _ => (String::new(), None),
        };
        lines.push(FingerprintLine {
            line_ref: line.id().to_string(),
            product_ref,
            variant_ref,
            quantity,
            unit_price,
        });
    }
    lines.sort_by(|left, right| left.line_ref.cmp(&right.line_ref));

    let canonical = serde_json::to_string(&Fingerprint {
        currency: input.cart().cost().subtotal_amount().currency_code().to_string(),
        subtotal: parse_to_minor_units(
            &input.cart().cost().subtotal_amount().amount().to_string(),
        )?,
        lines,
    })
    .ok()?;
    Some(hex::encode(Sha256::digest(canonical.as_bytes())))
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let has_order_discount_class = input
        .discount()
        .discount_classes()
        .contains(&schema::DiscountClass::Order);

    if !has_order_discount_class {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let Some(attribute) = input.cart().attribute() else {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    };
    let Some(raw) = attribute.value() else {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    };
    let Ok(eval) = serde_json::from_str::<IncentivesEval>(raw) else {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    };

    let Some(cart_subtotal) = parse_to_minor_units(
        &input.cart().cost().subtotal_amount().amount().to_string(),
    ) else {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    };
    if eval.subtotal_minor_units != cart_subtotal {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }
    if !eval
        .currency
        .eq_ignore_ascii_case(&input.cart().cost().subtotal_amount().currency_code().to_string())
    {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }
    if eval.discount_minor_units <= 0 {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }
    if eval.target.as_deref().unwrap_or("order") != "order" {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    // Day-level expiry guard with a one-day tolerance. Exact expiry is enforced
    // again by the webhook/Core; shop-local dates can be a day ahead of UTC.
    let today = input.shop().local_time().date().to_string();
    let earliest_allowed = previous_day(&today).unwrap_or_else(|| today.clone());
    let expiry_date = eval.expires_at.split('T').next().unwrap_or("");
    if expiry_date.is_empty() || expiry_date < earliest_allowed.as_str() {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let Some(metafield) = input
        .discount()
        .metafield()
    else {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    };
    let secret = metafield.value().to_string();
    if secret.trim().is_empty() {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let Some(fingerprint) = cart_fingerprint(&input) else {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    };
    if eval.cart_fingerprint.as_deref() != Some(fingerprint.as_str()) {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let checkout_token = eval
        .checkout_token
        .as_deref()
        .or(eval.cart_id.as_deref())
        .unwrap_or("");
    let message = [
        "v2",
        eval.evaluation_id.as_str(),
        eval.shop_domain.as_deref().unwrap_or(""),
        checkout_token,
        eval.cart_fingerprint.as_deref().unwrap_or(""),
        &eval.subtotal_minor_units.to_string(),
        eval.currency.as_str(),
        &eval.discount_minor_units.to_string(),
        eval.lease_id.as_deref().unwrap_or(""),
        eval.lease_expires_at.as_deref().unwrap_or(""),
        eval.expires_at.as_str(),
    ]
    .join(":");
    if !verify_signature(&secret, &message, &eval.signature) {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let discount_minor = eval.discount_minor_units.min(cart_subtotal);
    if discount_minor <= 0 {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let operation = schema::CartOperation::OrderDiscountsAdd(
        schema::OrderDiscountsAddOperation {
            selection_strategy: schema::OrderDiscountSelectionStrategy::First,
            candidates: vec![schema::OrderDiscountCandidate {
                associated_discount_code: None,
                conditions: None,
                message: Some("Incentives Discount".to_string()),
                targets: vec![schema::OrderDiscountCandidateTarget::OrderSubtotal(
                    schema::OrderSubtotalTarget {
                        excluded_cart_line_ids: vec![],
                    },
                )],
                value: schema::OrderDiscountCandidateValue::FixedAmount(schema::FixedAmount {
                    amount: Decimal(discount_minor as f64 / 100.0),
                }),
            }],
        },
    );

    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: vec![operation],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use shopify_function::run_function_with_input;

    const SECRET: &str = "test-tenant-signing-secret";

    fn fingerprint() -> String {
        let canonical = serde_json::to_string(&Fingerprint {
            currency: "USD".to_string(),
            subtotal: 10000,
            lines: vec![FingerprintLine {
                line_ref: "line-1".to_string(),
                product_ref: "prod-1".to_string(),
                variant_ref: Some("var-1".to_string()),
                quantity: 1,
                unit_price: 10000,
            }],
        })
        .unwrap();
        hex::encode(Sha256::digest(canonical.as_bytes()))
    }

    fn signature(eval: &serde_json::Value) -> String {
        let message = [
            "v2",
            eval["evaluationId"].as_str().unwrap(),
            eval["shopDomain"].as_str().unwrap(),
            eval["checkoutToken"].as_str().unwrap(),
            eval["cartFingerprint"].as_str().unwrap(),
            &eval["subtotalMinorUnits"].to_string(),
            eval["currency"].as_str().unwrap(),
            &eval["discountMinorUnits"].to_string(),
            "",
            "",
            eval["expiresAt"].as_str().unwrap(),
        ]
        .join(":");
        let mut mac = HmacSha256::new_from_slice(SECRET.as_bytes()).unwrap();
        mac.update(message.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn valid_payload() -> serde_json::Value {
        let mut eval = json!({
            "evaluationId": "eval-1",
            "shopDomain": "test.myshopify.com",
            "checkoutToken": "chk-1",
            "cartFingerprint": fingerprint(),
            "subtotalMinorUnits": 10000,
            "currency": "USD",
            "discountMinorUnits": 2000,
            "target": "order",
            "expiresAt": "2099-01-01T00:00:00Z",
        });
        let sig = signature(&eval);
        eval["signature"] = json!(sig);
        eval
    }

    fn input(eval: &serde_json::Value) -> serde_json::Value {
        json!({
            "cart": {
                "attribute": { "value": eval.to_string() },
                "cost": {
                    "subtotalAmount": { "amount": "100.00", "currencyCode": "USD" }
                },
                "lines": [{
                    "id": "line-1",
                    "quantity": 1,
                    "cost": {
                        "subtotalAmount": { "amount": "100.00", "currencyCode": "USD" },
                        "totalAmount": { "amount": "100.00", "currencyCode": "USD" }
                    },
                    "merchandise": {
                        "__typename": "ProductVariant",
                        "id": "var-1",
                        "product": { "id": "prod-1" }
                    }
                }]
            },
            "discount": {
                "discountClasses": ["ORDER"],
                "metafield": { "value": SECRET }
            },
            "shop": { "localTime": { "date": "2026-11-22" } }
        })
    }

    fn run(eval: serde_json::Value) -> shopify_function::Result<schema::CartLinesDiscountsGenerateRunResult> {
        run_function_with_input(cart_lines_discounts_generate_run, &input(&eval).to_string())
    }

    #[test]
    fn fingerprint_matches_the_shared_ts_vector() {
        assert_eq!(
            fingerprint(),
            "06e494d2202ed65bf4b8e1ce302b5befbca56e503c4e1cf0a8de60bea029ba0d"
        );
    }

    #[test]
    fn applies_a_valid_signed_order_discount() {
        let result = run(valid_payload()).unwrap();
        assert_eq!(result.operations.len(), 1);
        match &result.operations[0] {
            schema::CartOperation::OrderDiscountsAdd(operation) => {
                assert_eq!(operation.selection_strategy, schema::OrderDiscountSelectionStrategy::First);
                assert_eq!(operation.candidates.len(), 1);
                match &operation.candidates[0].value {
                    schema::OrderDiscountCandidateValue::FixedAmount(amount) => {
                        assert_eq!(amount.amount, Decimal(20.0));
                    }
                    _ => panic!("expected fixed amount"),
                }
            }
            _ => panic!("expected order discount"),
        }
    }

    #[test]
    fn rejects_tampered_discount_amount() {
        let mut eval = valid_payload();
        eval["discountMinorUnits"] = json!(9900);
        assert!(run(eval).unwrap().operations.is_empty());
    }

    #[test]
    fn rejects_a_changed_cart_fingerprint() {
        let mut eval = valid_payload();
        eval["cartFingerprint"] = json!("deadbeef");
        assert!(run(eval).unwrap().operations.is_empty());
    }

    #[test]
    fn rejects_a_stale_subtotal() {
        let mut eval = valid_payload();
        eval["subtotalMinorUnits"] = json!(8000);
        // Re-sign so only the subtotal mismatch is under test.
        let sig = signature(&eval);
        eval["signature"] = json!(sig);
        assert!(run(eval).unwrap().operations.is_empty());
    }

    #[test]
    fn rejects_an_expired_payload() {
        let mut eval = valid_payload();
        eval["expiresAt"] = json!("2020-01-01T00:00:00Z");
        let sig = signature(&eval);
        eval["signature"] = json!(sig);
        assert!(run(eval).unwrap().operations.is_empty());
    }

    #[test]
    fn allows_expiry_one_day_behind_shop_local_date() {
        let mut eval = valid_payload();
        eval["expiresAt"] = json!("2026-11-22T23:15:00Z");
        let sig = signature(&eval);
        eval["signature"] = json!(sig);

        let mut value = input(&eval);
        value["shop"]["localTime"]["date"] = json!("2026-11-23");
        let result = run_function_with_input(
            cart_lines_discounts_generate_run,
            &value.to_string(),
        )
        .unwrap();

        assert_eq!(result.operations.len(), 1);
    }

    #[test]
    fn rejects_a_non_order_target() {
        let mut eval = valid_payload();
        eval["target"] = json!("line");
        let sig = signature(&eval);
        eval["signature"] = json!(sig);
        assert!(run(eval).unwrap().operations.is_empty());
    }
}
