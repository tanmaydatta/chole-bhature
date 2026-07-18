export interface LineItemFactInput {
  productRef: string;
  variantRef?: string;
  quantity?: number;
  unitPrice?: number;
  attributes?: Record<string, unknown>;
}

export interface AssembleFactsInput {
  customer?: Record<string, unknown>;
  context?: Record<string, unknown>;
  cart?: Record<string, unknown>;
  lineItems?: readonly LineItemFactInput[];
  system?: Record<string, unknown>;
}

export interface FactSet {
  scalar: Record<string, unknown>;
  lineItems: Array<Record<string, unknown>>;
}

const LINE_ITEM_CANONICAL_KEYS = new Set([
  'product_ref',
  'variant_ref',
  'quantity',
  'unit_price',
]);

function assertNoCustomerNamespace(
  values: Record<string, unknown>,
  source: string,
): void {
  for (const key of Object.keys(values)) {
    if (key.startsWith('customer.')) {
      throw new Error(`Customer namespace values cannot be supplied by ${source} facts`);
    }
  }
}

function namespace(
  source: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${source}.${key}`, value]),
  );
}

function assembleLineItemFacts(item: LineItemFactInput): Record<string, unknown> {
  const rawItem = item as LineItemFactInput & Record<string, unknown>;
  assertNoCustomerNamespace(rawItem, 'line-item');
  assertNoCustomerNamespace(item.attributes ?? {}, 'line-item');

  for (const key of Object.keys(item.attributes ?? {})) {
    if (LINE_ITEM_CANONICAL_KEYS.has(key)) {
      throw new Error(`Line-item attribute ${key} cannot override a canonical fact`);
    }
  }

  const facts: Record<string, unknown> = {
    'line_item.product_ref': item.productRef,
    ...namespace('line_item', item.attributes ?? {}),
  };

  if (item.variantRef !== undefined) {
    facts['line_item.variant_ref'] = item.variantRef;
  }
  if (item.quantity !== undefined) {
    facts['line_item.quantity'] = item.quantity;
  }
  if (item.unitPrice !== undefined) {
    facts['line_item.unit_price'] = item.unitPrice;
  }

  return facts;
}

export function assembleFacts(input: AssembleFactsInput): FactSet {
  const customer = input.customer ?? {};
  const context = input.context ?? {};
  const cart = input.cart ?? {};
  const system = input.system ?? {};

  assertNoCustomerNamespace(context, 'context');
  assertNoCustomerNamespace(cart, 'cart');

  return {
    scalar: {
      ...namespace('customer', customer),
      ...namespace('context', context),
      ...namespace('cart', cart),
      ...namespace('system', system),
    },
    lineItems: (input.lineItems ?? []).map(assembleLineItemFacts),
  };
}
