mod types;

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::io::{self, Read, Write};
use types::*;

type HmacSha256 = Hmac<Sha256>;

pub fn verify_signature(secret: &str, payload: &str, signature: &str) -> bool {
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(payload.as_bytes());
    let sig_bytes = match hex::decode(signature.trim()) {
        Ok(b) => b,
        Err(_) => return false,
    };
    mac.verify_slice(&sig_bytes).is_ok()
}

pub fn parse_to_minor_units(amount_str: &str) -> Option<i64> {
    let trimmed = amount_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    let is_negative = trimmed.starts_with('-');
    let num_str = if is_negative { &trimmed[1..] } else { trimmed };
    if num_str.is_empty() {
        return None;
    }

    let parts: Vec<&str> = num_str.split('.').collect();
    if parts.len() > 2 {
        return None;
    }
    // Must contain only ASCII digits
    if !parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }

    let whole: i64 = if parts[0].is_empty() {
        0
    } else {
        parts[0].parse().ok()?
    };

    let frac: i64 = if parts.len() == 2 {
        let frac_str = parts[1];
        if frac_str.is_empty() {
            0
        } else if frac_str.len() == 1 {
            frac_str.parse::<i64>().ok()? * 10
        } else if frac_str.len() == 2 {
            frac_str.parse::<i64>().ok()?
        } else {
            // Because we verified all chars are ASCII digits, byte slicing is completely safe
            let first_two: i64 = frac_str[..2].parse().ok()?;
            let third: i64 = frac_str[2..3].parse().ok()?;
            if third >= 5 {
                first_two + 1
            } else {
                first_two
            }
        }
    } else {
        0
    };

    let total = whole.checked_mul(100)?.checked_add(frac)?;
    if is_negative {
        Some(-total)
    } else {
        Some(total)
    }
}

pub fn format_minor_to_major(minor: i64) -> String {
    let major = minor / 100;
    let rem = (minor % 100).abs();
    format!("{}.{:02}", major, rem)
}

pub fn run_function(input: &Input) -> FunctionResult {
    // 1. Check if attribute is missing or empty
    let attr_val = match input
        .cart
        .attribute
        .as_ref()
        .and_then(|a| a.value.as_ref())
    {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => return FunctionResult::empty(),
    };

    // Parse _incentives_eval JSON
    let eval: IncentivesEval = match serde_json::from_str(attr_val) {
        Ok(e) => e,
        Err(_) => return FunctionResult::empty(),
    };

    // 2. Check cartId == input.cart.id
    if eval.cart_id != input.cart.id {
        return FunctionResult::empty();
    }

    // 3. Convert input.cart.cost.subtotalAmount.amount to minor units and verify match
    let cart_subtotal_minor = match parse_to_minor_units(&input.cart.cost.subtotal_amount.amount) {
        Some(units) => units,
        None => return FunctionResult::empty(),
    };
    if eval.subtotal_minor_units != cart_subtotal_minor {
        return FunctionResult::empty();
    }

    // 4. Check currency == input.cart.cost.subtotalAmount.currencyCode
    if !eval
        .currency
        .eq_ignore_ascii_case(&input.cart.cost.subtotal_amount.currency_code)
    {
        return FunctionResult::empty();
    }

    // 5. Read tenant secret from discountNode.metafield.value
    let secret = match input
        .discount_node
        .as_ref()
        .and_then(|dn| dn.metafield.as_ref())
        .and_then(|mf| mf.value.as_ref())
    {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return FunctionResult::empty(),
    };

    // Verify HMAC-SHA256 signature over:
    // ${evaluationId}:${cartId}:${subtotalMinorUnits}:${currency}:${discountMinorUnits}:${expiresAt}
    let expires_at_str = eval.expires_at.as_deref().unwrap_or("");
    let primary_payload = format!(
        "{}:{}:{}:{}:{}:{}",
        eval.evaluation_id,
        eval.cart_id,
        eval.subtotal_minor_units,
        eval.currency,
        eval.discount_minor_units,
        expires_at_str
    );

    let is_valid = if verify_signature(secret, &primary_payload, &eval.signature) {
        true
    } else if eval.expires_at.is_none() {
        // Fallback for payload signed without trailing colon if expires_at was omitted
        let alt_payload = format!(
            "{}:{}:{}:{}:{}",
            eval.evaluation_id,
            eval.cart_id,
            eval.subtotal_minor_units,
            eval.currency,
            eval.discount_minor_units
        );
        verify_signature(secret, &alt_payload, &eval.signature)
    } else {
        false
    };

    if !is_valid {
        return FunctionResult::empty();
    }

    // Verify target (defaults to "order" if omitted; promotions are evaluated against order subtotal)
    let target = eval.target.as_deref().unwrap_or("order");
    if target != "order" {
        return FunctionResult::empty();
    }

    // Emit fixed amount discount from cryptographically signed discount_minor_units
    if eval.discount_minor_units <= 0 {
        return FunctionResult::empty();
    }

    let value = ValueInput {
        fixed_amount: Some(FixedAmountInput {
            amount: format_minor_to_major(eval.discount_minor_units),
            applies_to_each_item: None,
        }),
        percentage: None,
    };

    let discount = DiscountOperation {
        value,
        targets: vec![TargetInput {
            order_subtotal: Some(OrderSubtotalTargetInput {
                excluded_variant_ids: Some(vec![]),
            }),
            product_variant: None,
        }],
        message: Some("Incentives Discount".to_string()),
    };

    FunctionResult {
        discounts: vec![discount],
        discount_application_strategy: DiscountApplicationStrategy::First,
    }
}

pub fn run_function_json(input_json: &str) -> String {
    let input: Input = match serde_json::from_str(input_json) {
        Ok(val) => val,
        Err(_) => return serde_json::to_string(&FunctionResult::empty()).unwrap(),
    };
    let result = run_function(&input);
    serde_json::to_string(&result).unwrap()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input_str = String::new();
    io::stdin().read_to_string(&mut input_str)?;
    let output = run_function_json(&input_str);
    io::stdout().write_all(output.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &str, payload: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(payload.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn create_test_input(
        cart_id: &str,
        subtotal_amount: &str,
        currency: &str,
        eval_payload: Option<IncentivesEval>,
        secret: Option<&str>,
    ) -> Input {
        let attribute = eval_payload.map(|payload| CartAttributeInput {
            key: Some("_incentives_eval".to_string()),
            value: Some(serde_json::to_string(&payload).unwrap()),
        });

        let discount_node = secret.map(|s| DiscountNodeInput {
            metafield: Some(MetafieldInput {
                value: Some(s.to_string()),
            }),
        });

        Input {
            cart: CartInput {
                id: cart_id.to_string(),
                cost: CartCostInput {
                    subtotal_amount: MoneyInput {
                        amount: subtotal_amount.to_string(),
                        currency_code: currency.to_string(),
                    },
                },
                lines: vec![],
                attribute,
            },
            discount_node,
        }
    }

    #[test]
    fn test_verifies_valid_signature_and_emits_discount() {
        let secret = "test-tenant-secret-key-1234567890123456";
        let cart_id = "gid://shopify/Cart/c1-valid";
        let subtotal_minor = 5000;
        let currency = "USD";
        let discount_minor = 1000;
        let expires_at = "2026-11-19T12:00:00Z";
        let eval_id = "eval-001";

        let sig_payload = format!(
            "{}:{}:{}:{}:{}:{}",
            eval_id, cart_id, subtotal_minor, currency, discount_minor, expires_at
        );
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: eval_id.to_string(),
            shop_domain: Some("test-store.myshopify.com".to_string()),
            cart_id: cart_id.to_string(),
            subtotal_minor_units: subtotal_minor,
            currency: currency.to_string(),
            discount_minor_units: discount_minor,
            target: Some("order".to_string()),
            expires_at: Some(expires_at.to_string()),
            signature,
        };

        let input = create_test_input(cart_id, "50.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(
            result.discount_application_strategy,
            DiscountApplicationStrategy::First
        );
        assert_eq!(result.discounts.len(), 1);

        let discount = &result.discounts[0];
        assert_eq!(discount.message, Some("Incentives Discount".to_string()));
        let fixed_val = discount.value.fixed_amount.as_ref().expect("expected fixedAmount");
        assert_eq!(fixed_val.amount, "10.00");
        assert_eq!(discount.targets.len(), 1);
        assert!(discount.targets[0].order_subtotal.is_some());
    }

    #[test]
    fn test_rejects_subtotal_mismatch() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1";
        let currency = "USD";
        let sig_payload = format!("eval-1:{}:5000:{}:1000:", cart_id, currency);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-1".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000, // Token expected 5000 cents ($50)
            currency: currency.to_string(),
            discount_minor_units: 1000,
            target: Some("order".to_string()),
            expires_at: None,
            signature,
        };

        // Cart subtotal is 75.00 ($75) != 5000 minor units
        let input = create_test_input(cart_id, "75.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_rejects_cart_id_mismatch() {
        let secret = "test-secret";
        let currency = "USD";
        let sig_payload = format!("eval-1:gid://shopify/Cart/c1:5000:{}:1000:", currency);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-1".to_string(),
            shop_domain: None,
            cart_id: "gid://shopify/Cart/c1".to_string(),
            subtotal_minor_units: 5000,
            currency: currency.to_string(),
            discount_minor_units: 1000,
            target: Some("order".to_string()),
            expires_at: None,
            signature,
        };

        // Cart id is c2 != c1
        let input = create_test_input("gid://shopify/Cart/c2", "50.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_rejects_tampered_signature() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1";
        let currency = "USD";

        let eval = IncentivesEval {
            evaluation_id: "eval-1".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000,
            currency: currency.to_string(),
            discount_minor_units: 1000,
            target: Some("order".to_string()),
            expires_at: None,
            signature: "deadbeef0123456789abcdefdeadbeef0123456789abcdefdeadbeef01234567".to_string(),
        };

        let input = create_test_input(cart_id, "50.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_rejects_missing_attribute() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1";
        let input = create_test_input(cart_id, "50.00", "USD", None, Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
        assert_eq!(
            result.discount_application_strategy,
            DiscountApplicationStrategy::First
        );
    }

    #[test]
    fn test_rejects_currency_mismatch() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1";
        let sig_payload = format!("eval-1:{}:5000:USD:1000:", cart_id);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-1".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000,
            currency: "USD".to_string(),
            discount_minor_units: 1000,
            target: Some("order".to_string()),
            expires_at: None,
            signature,
        };

        // Cart currency is EUR != USD
        let input = create_test_input(cart_id, "50.00", "EUR", Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_rejects_missing_metafield_secret() {
        let cart_id = "gid://shopify/Cart/c1";
        let currency = "USD";
        let sig_payload = format!("eval-1:{}:5000:{}:1000:", cart_id, currency);
        let signature = sign("test-secret", &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-1".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000,
            currency: currency.to_string(),
            discount_minor_units: 1000,
            target: Some("order".to_string()),
            expires_at: None,
            signature,
        };

        // No discountNode or secret
        let input = create_test_input(cart_id, "50.00", currency, Some(eval), None);
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_rejects_invalid_json_attribute() {
        let secret = "test-secret";
        let mut input = create_test_input("gid://shopify/Cart/c1", "50.00", "USD", None, Some(secret));
        input.cart.attribute = Some(CartAttributeInput {
            key: Some("_incentives_eval".to_string()),
            value: Some("{ invalid json ".to_string()),
        });

        let result = run_function(&input);
        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_zero_discount_emits_empty() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1";
        let currency = "USD";
        let sig_payload = format!("eval-1:{}:5000:{}:0:", cart_id, currency);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-1".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000,
            currency: currency.to_string(),
            discount_minor_units: 0,
            target: Some("order".to_string()),
            expires_at: None,
            signature,
        };

        let input = create_test_input(cart_id, "50.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);
        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_tampered_json_with_injected_percentage_cannot_override_signed_fixed_discount() {
        let secret = "test-tenant-secret-key-1234567890123456";
        let cart_id = "gid://shopify/Cart/c1-pct";
        let subtotal_minor = 10000;
        let currency = "USD";
        let discount_minor = 1500;
        let expires_at = "2026-11-19T12:00:00Z";
        let eval_id = "eval-pct-001";

        let sig_payload = format!(
            "{}:{}:{}:{}:{}:{}",
            eval_id, cart_id, subtotal_minor, currency, discount_minor, expires_at
        );
        let signature = sign(secret, &sig_payload);

        // Attacker crafts JSON with an injected "percentage": 90.0
        let tampered_json = format!(
            r#"{{"evaluationId":"{}","cartId":"{}","subtotalMinorUnits":{},"currency":"{}","discountMinorUnits":{},"target":"order","expiresAt":"{}","percentage":90.0,"signature":"{}"}}"#,
            eval_id, cart_id, subtotal_minor, currency, discount_minor, expires_at, signature
        );

        let mut input = create_test_input(cart_id, "100.00", currency, None, Some(secret));
        input.cart.attribute = Some(CartAttributeInput {
            key: Some("_incentives_eval".to_string()),
            value: Some(tampered_json),
        });

        let result = run_function(&input);

        // Crucial security guarantee: percentage injection does NOT produce a percentage discount;
        // it strictly emits the signed 1500 minor units ($15.00) fixed amount discount.
        assert_eq!(result.discounts.len(), 1);
        let discount = &result.discounts[0];
        assert!(discount.value.percentage.is_none());
        let fixed_val = discount.value.fixed_amount.as_ref().expect("expected fixedAmount");
        assert_eq!(fixed_val.amount, "15.00");
    }

    #[test]
    fn test_omitted_target_defaults_to_order() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1-def";
        let currency = "USD";
        let sig_payload = format!("eval-def:{}:5000:{}:500:", cart_id, currency);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-def".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000,
            currency: currency.to_string(),
            discount_minor_units: 500,
            target: None,
            expires_at: None,
            signature,
        };

        let input = create_test_input(cart_id, "50.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 1);
        let discount = &result.discounts[0];
        assert_eq!(
            discount.value.fixed_amount.as_ref().unwrap().amount,
            "5.00"
        );
        assert!(discount.targets[0].order_subtotal.is_some());
    }

    #[test]
    fn test_unknown_target_rejects() {
        let secret = "test-secret";
        let cart_id = "gid://shopify/Cart/c1-unk";
        let currency = "USD";
        let sig_payload = format!("eval-unk:{}:5000:{}:500:", cart_id, currency);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "eval-unk".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 5000,
            currency: currency.to_string(),
            discount_minor_units: 500,
            target: Some("unsupported_target".to_string()),
            expires_at: None,
            signature,
        };

        let input = create_test_input(cart_id, "50.00", currency, Some(eval), Some(secret));
        let result = run_function(&input);

        assert_eq!(result.discounts.len(), 0);
    }

    #[test]
    fn test_json_pipeline_round_trip() {
        let secret = "secret123";
        let cart_id = "gid://shopify/Cart/c1-pipe";
        let currency = "USD";
        let sig_payload = format!("e-pipe:{}:2500:{}:250:", cart_id, currency);
        let signature = sign(secret, &sig_payload);

        let eval = IncentivesEval {
            evaluation_id: "e-pipe".to_string(),
            shop_domain: None,
            cart_id: cart_id.to_string(),
            subtotal_minor_units: 2500,
            currency: currency.to_string(),
            discount_minor_units: 250,
            target: Some("order".to_string()),
            expires_at: None,
            signature,
        };

        let input = create_test_input(cart_id, "25.00", currency, Some(eval), Some(secret));
        let input_json = serde_json::to_string(&input).unwrap();
        let output_json = run_function_json(&input_json);

        let result: FunctionResult = serde_json::from_str(&output_json).unwrap();
        assert_eq!(result.discounts.len(), 1);
        assert_eq!(
            result.discounts[0].value.fixed_amount.as_ref().unwrap().amount,
            "2.50"
        );
    }

    #[test]
    fn test_parses_various_decimal_subtotals() {
        assert_eq!(parse_to_minor_units("50.00"), Some(5000));
        assert_eq!(parse_to_minor_units("50.0"), Some(5000));
        assert_eq!(parse_to_minor_units("50"), Some(5000));
        assert_eq!(parse_to_minor_units("50.5"), Some(5050));
        assert_eq!(parse_to_minor_units("50.05"), Some(5005));
        assert_eq!(parse_to_minor_units("0.99"), Some(99));
        assert_eq!(parse_to_minor_units("0"), Some(0));
        assert_eq!(format_minor_to_major(5000), "50.00");
        assert_eq!(format_minor_to_major(1050), "10.50");
        assert_eq!(format_minor_to_major(99), "0.99");
        assert_eq!(format_minor_to_major(5), "0.05");
        assert_eq!(format_minor_to_major(0), "0.00");
    }

    #[test]
    fn test_parse_to_minor_units_handles_negative_and_unicode_safely() {
        assert_eq!(parse_to_minor_units("-0.50"), Some(-50));
        assert_eq!(parse_to_minor_units("-10.00"), Some(-1000));
        assert_eq!(parse_to_minor_units("-5"), Some(-500));
        assert_eq!(parse_to_minor_units("100.999"), Some(10100)); // rounds 999 to 100
        assert_eq!(parse_to_minor_units("100.994"), Some(10099)); // rounds 994 to 99
        assert_eq!(parse_to_minor_units("10.0€"), None); // Non-ascii unicode character
        assert_eq!(parse_to_minor_units("€10.00"), None);
        assert_eq!(parse_to_minor_units("abc"), None);
        assert_eq!(parse_to_minor_units(""), None);
        assert_eq!(parse_to_minor_units("   "), None);
        assert_eq!(parse_to_minor_units("1.2.3"), None);
    }
}
