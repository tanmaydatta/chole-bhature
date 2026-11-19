import type { Money } from '@incentives/contracts';

/**
 * Shopify Customer representation for the connector.
 * Supports Storefront API GIDs, GraphQL node representations, and REST payloads.
 */
export interface ShopifyCustomer {
  readonly id: string;
  readonly email?: string | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly tags?: readonly string[] | string | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
  readonly ordersCount?: number | undefined;
  readonly totalSpent?: string | number | undefined;
  readonly [key: string]: unknown;
}

/**
 * Line item in a Shopify Cart.
 * Supports Storefront API CartLine, Rust Discount Function input, and standard fixture formats.
 */
export interface ShopifyCartLine {
  readonly id?: string | undefined;
  readonly lineId?: string | undefined;
  readonly lineRef?: string | undefined;
  readonly productId?: string | undefined;
  readonly productRef?: string | undefined;
  readonly variantId?: string | undefined;
  readonly variantRef?: string | undefined;
  readonly quantity?: number | undefined;
  readonly unitPrice?: number | string | undefined;
  readonly price?: number | string | undefined;
  readonly merchandise?: {
    readonly id?: string | undefined;
    readonly product?: {
      readonly id?: string | undefined;
    } | undefined;
  } | undefined;
  readonly cost?: {
    readonly amountPerQuantity?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
    readonly subtotalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
    readonly totalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
  } | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | readonly { readonly key: string; readonly value: unknown }[] | undefined;
  readonly [key: string]: unknown;
}

/**
 * Shopify Cart representation for the connector.
 */
export interface ShopifyCart {
  readonly id?: string | undefined;
  readonly currency?: string | undefined;
  readonly currencyCode?: string | undefined;
  readonly subtotal?: number | string | undefined;
  readonly subtotalAmount?: number | string | undefined;
  readonly cost?: {
    readonly subtotalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
    readonly totalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
  } | undefined;
  readonly lines?: readonly ShopifyCartLine[] | undefined;
  readonly items?: readonly ShopifyCartLine[] | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | readonly { readonly key: string; readonly value: unknown }[] | undefined;
  readonly [key: string]: unknown;
}

/**
 * Line item in a Shopify Order.
 */
export interface ShopifyOrderLine {
  readonly id?: string | number | undefined;
  readonly lineId?: string | undefined;
  readonly lineRef?: string | undefined;
  readonly productId?: string | undefined;
  readonly productRef?: string | undefined;
  readonly product_id?: string | number | undefined;
  readonly variantId?: string | undefined;
  readonly variantRef?: string | undefined;
  readonly variant_id?: string | number | undefined;
  readonly quantity?: number | undefined;
  readonly unitPrice?: number | string | undefined;
  readonly price?: number | string | undefined;
  readonly merchandise?: {
    readonly id?: string | undefined;
    readonly product?: {
      readonly id?: string | undefined;
    } | undefined;
  } | undefined;
  readonly cost?: {
    readonly amountPerQuantity?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
    readonly subtotalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
    readonly totalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
  } | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | readonly { readonly key: string; readonly value: unknown }[] | undefined;
  readonly [key: string]: unknown;
}

/**
 * Shopify Order representation for the connector (webhooks, GraphQL, REST).
 */
export interface ShopifyOrder {
  readonly id?: string | number | undefined;
  readonly admin_graphql_api_id?: string | undefined;
  readonly externalRef?: string | undefined;
  readonly orderRef?: string | undefined;
  readonly customerId?: string | number | undefined;
  readonly customerRef?: string | undefined;
  readonly customer?: {
    readonly id?: string | number | undefined;
    readonly admin_graphql_api_id?: string | undefined;
  } | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly currency?: string | undefined;
  readonly currencyCode?: string | undefined;
  readonly total?: number | string | undefined;
  readonly totalPrice?: number | string | undefined;
  readonly total_price?: number | string | undefined;
  readonly cost?: {
    readonly totalAmount?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
  } | undefined;
  readonly totalPriceSet?: {
    readonly shopMoney?: {
      readonly amount: number | string;
      readonly currencyCode?: string | undefined;
    } | undefined;
  } | undefined;
  readonly items?: readonly ShopifyOrderLine[] | undefined;
  readonly lines?: readonly ShopifyOrderLine[] | undefined;
  readonly line_items?: readonly ShopifyOrderLine[] | undefined;
  readonly [key: string]: unknown;
}

/**
 * Target and value representation of Shopify Discounts.
 */
export type ShopifyDiscount =
  | {
      readonly type: 'order_discount';
      readonly calculation: 'fixed';
      readonly amount: Money;
    }
  | {
      readonly type: 'order_discount';
      readonly calculation: 'percent';
      readonly basisPoints: number;
      readonly maximumDiscountAmount?: Money | undefined;
    }
  | {
      readonly type: 'line_item_discount';
      readonly productRef: string;
      readonly calculation: 'fixed';
      readonly amount: Money;
    }
  | {
      readonly type: 'line_item_discount';
      readonly productRef: string;
      readonly calculation: 'percent';
      readonly basisPoints: number;
      readonly maximumDiscountAmount?: Money | undefined;
    }
  | {
      readonly type: 'free_shipping';
    };

/**
 * Mapped decision for Shopify.
 */
export interface ShopifyDecision {
  readonly programRef: string;
  readonly outcome: string;
  readonly discounts: readonly ShopifyDiscount[];
}

/**
 * Configuration options for Shopify Connector.
 */
export interface ShopifyConnectorOptions {
  readonly secret?: string | undefined;
}
