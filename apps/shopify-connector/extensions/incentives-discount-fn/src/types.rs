use serde::{Deserialize, Deserializer, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub cart: CartInput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_node: Option<DiscountNodeInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CartInput {
    pub id: String,
    pub cost: CartCostInput,
    #[serde(default)]
    pub lines: Vec<CartLineInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribute: Option<CartAttributeInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CartCostInput {
    pub subtotal_amount: MoneyInput,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoneyInput {
    pub amount: String,
    pub currency_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CartLineInput {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<CartLineCostInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CartLineCostInput {
    pub subtotal_amount: MoneyInput,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CartAttributeInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub value: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscountNodeInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metafield: Option<MetafieldInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetafieldInput {
    pub value: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiscountApplicationStrategy {
    First,
    Maximum,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionResult {
    pub discounts: Vec<DiscountOperation>,
    pub discount_application_strategy: DiscountApplicationStrategy,
}

impl FunctionResult {
    pub fn empty() -> Self {
        Self {
            discounts: vec![],
            discount_application_strategy: DiscountApplicationStrategy::First,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscountOperation {
    pub value: ValueInput,
    pub targets: Vec<TargetInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValueInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_amount: Option<FixedAmountInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentage: Option<PercentageInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixedAmountInput {
    pub amount: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applies_to_each_item: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PercentageInput {
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_subtotal: Option<OrderSubtotalTargetInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_variant: Option<ProductVariantTargetInput>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrderSubtotalTargetInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_variant_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProductVariantTargetInput {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IncentivesEval {
    pub evaluation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shop_domain: Option<String>,
    pub cart_id: String,
    #[serde(deserialize_with = "deserialize_number_or_string")]
    pub subtotal_minor_units: i64,
    pub currency: String,
    #[serde(deserialize_with = "deserialize_number_or_string")]
    pub discount_minor_units: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_optional_string_or_number")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentage: Option<f64>,
    pub signature: String,
}

fn deserialize_number_or_string<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Number(n) => n.as_i64().ok_or_else(|| D::Error::custom("Invalid integer")),
        serde_json::Value::String(s) => s.parse::<i64>().map_err(D::Error::custom),
        _ => Err(D::Error::custom("Expected integer or string")),
    }
}

fn deserialize_optional_string_or_number<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<serde_json::Value>::deserialize(deserializer)?;
    match v {
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(serde_json::Value::Number(n)) => Ok(Some(n.to_string())),
        Some(serde_json::Value::Null) | None => Ok(None),
        _ => Ok(None),
    }
}
