import type { VariableDefinition } from '@incentives/contracts';
import type { Env } from '../env.js';
import { createOperatorContext } from './operator-context.js';

export interface BaselineSchemaResult {
  version: number;
  createdDefinitionKeys: string[];
}

/**
 * The Shopify checkout surface cannot evaluate without a published schema.
 * This is the minimum set of variables the connector sends from Shopify.
 */
export const SHOPIFY_BASELINE_DEFINITIONS: readonly VariableDefinition[] = [
  {
    key: 'customer.tags',
    label: 'Customer tags',
    source: 'customer',
    type: 'string',
    required: false,
    description: 'Comma-separated Shopify customer tags.',
  },
  {
    key: 'customer.orders_count',
    label: 'Customer order count',
    source: 'customer',
    type: 'number',
    required: false,
    description: 'Number of orders previously placed by the customer.',
  },
  {
    key: 'customer.total_spent',
    label: 'Customer total spent',
    source: 'customer',
    type: 'number',
    required: false,
    description: 'Lifetime customer spend in the store currency.',
  },
  {
    key: 'cart.subtotal',
    label: 'Cart subtotal',
    source: 'cart',
    type: 'number',
    required: false,
    description: 'Checkout merchandise subtotal in minor units.',
  },
  {
    key: 'context.channel',
    label: 'Sales channel',
    source: 'context',
    type: 'string',
    required: false,
    description: 'Channel that produced the evaluation, e.g. shopify_checkout.',
  },
];

export async function ensureShopifyBaselineSchema(
  env: Env,
  merchantId: string,
  correlationId: string = crypto.randomUUID(),
): Promise<BaselineSchemaResult> {
  const readContext = createOperatorContext(merchantId, 'schemas:read', correlationId);
  const list = await env.CORE.listSchemaDefinitions(readContext);
  const existingKeys = new Set(list.definitions.map(entry => entry.definition.key));
  const createdDefinitionKeys: string[] = [];

  const manageContext = createOperatorContext(merchantId, 'schemas:manage', correlationId);
  for (const definition of SHOPIFY_BASELINE_DEFINITIONS) {
    if (existingKeys.has(definition.key)) continue;
    await env.CORE.createSchemaDefinition(manageContext, definition);
    createdDefinitionKeys.push(definition.key);
  }

  if (createdDefinitionKeys.length === 0 && list.publishedVersion !== undefined) {
    return { version: list.publishedVersion, createdDefinitionKeys };
  }

  const publishContext = createOperatorContext(merchantId, 'schemas:publish', correlationId);
  const published = await env.CORE.publishSchema(publishContext);
  return { version: published.version, createdDefinitionKeys };
}
