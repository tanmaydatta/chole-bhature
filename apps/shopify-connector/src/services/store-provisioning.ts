import type { OperatorCallContext } from '@incentives/contracts';
import type { Env } from '../env.js';

export interface ProvisionStoreOptions {
  shop: string;
  accessToken: string;
  functionId?: string;
  apiVersion?: string;
}

export interface ProvisionStoreResult {
  shop: string;
  merchantId: string;
  publishableToken: string;
  secretToken: string;
  tenantSigningKey: string;
}

export function generateTenantSigningKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function shopifyGraphQL<T = unknown>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  apiVersion = '2026-07',
): Promise<{ data?: T; errors?: unknown[]; userErrors?: unknown[] }> {
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify GraphQL request failed with status ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<{ data?: T; errors?: unknown[]; userErrors?: unknown[] }>;
}

export async function provisionStore(
  env: Env,
  options: ProvisionStoreOptions,
): Promise<ProvisionStoreResult> {
  const { shop, accessToken } = options;
  const apiVersion = options.apiVersion ?? env.SHOPIFY_API_VERSION ?? '2026-07';
  const functionId =
    options.functionId ??
    env.SHOPIFY_DISCOUNT_FUNCTION_ID ??
    '00000000-0000-0000-0000-000000000000';

  // 1. Create dedicated merchant tenant via CORE service binding
  const tenantId = `shop_${shop.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const correlationId = crypto.randomUUID();
  const operatorContext: OperatorCallContext = {
    correlationId,
    actorUserId: 'system:shopify-connector',
    actorKind: 'root',
    merchantId: tenantId,
    permission: 'credentials:manage',
  };

  const provisioningId = `prov_${crypto.randomUUID()}`;
  const provisionResult = await env.CORE.provisionMerchant(operatorContext, {
    id: tenantId,
    name: shop,
    provisioningId,
  });

  if (!provisionResult.ok) {
    throw new Error(
      `Failed to provision merchant in Core: ${provisionResult.error.message} (${provisionResult.error.code})`,
    );
  }

  if (env.CORE.activateMerchant) {
    await env.CORE.activateMerchant(operatorContext, {
      id: tenantId,
      provisioningId,
    });
  }

  // 2. Generate pk_... (publishable token) and sk_... (secret token)
  const publishableCred = await env.CORE.createCredential(operatorContext, {
    name: `Shopify Storefront (${shop})`,
    kind: 'publishable',
    environment: 'production',
    scopes: ['evaluations:write', 'schema:read'],
    allowedOrigins: [`https://${shop}`],
  });
  const publishableToken = publishableCred.token;

  const secretCred = await env.CORE.createCredential(operatorContext, {
    name: `Shopify Backend (${shop})`,
    kind: 'secret',
    environment: 'production',
    scopes: ['evaluations:write', 'redemptions:write', 'customers:write'],
  });
  const secretToken = secretCred.token;

  // 3. Generate cryptographically random tenant signing key (HMAC secret for Wasm discount function)
  const tenantSigningKey = generateTenantSigningKey();

  // 4. Store shop record in D1 shopify_installed_shops table
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO shopify_installed_shops (
      shop_domain,
      access_token,
      tenant_id,
      tenant_signing_key,
      publishable_token,
      secret_token,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      access_token = excluded.access_token,
      tenant_id = excluded.tenant_id,
      tenant_signing_key = excluded.tenant_signing_key,
      publishable_token = excluded.publishable_token,
      secret_token = excluded.secret_token,
      status = 'active',
      updated_at = excluded.updated_at`,
  )
    .bind(
      shop,
      accessToken,
      tenantId,
      tenantSigningKey,
      publishableToken,
      secretToken,
      now,
      now,
    )
    .run();

  // 5. Register App Metafield ($app:incentives:publishable_token) on Shopify
  const setMetafieldsMutation = `
    mutation SetAppMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  await shopifyGraphQL(
    shop,
    accessToken,
    setMetafieldsMutation,
    {
      metafields: [
        {
          namespace: '$app:incentives',
          key: 'publishable_token',
          type: 'single_line_text_field',
          value: publishableToken,
        },
      ],
    },
    apiVersion,
  );

  // 6. Register Shopify Automatic Discount Function
  const createAutoDiscountMutation = `
    mutation CreateAutomaticDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          discountId
          title
          status
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  await shopifyGraphQL(
    shop,
    accessToken,
    createAutoDiscountMutation,
    {
      automaticAppDiscount: {
        title: 'Incentives Automatic Discounts',
        functionId,
        startsAt: now,
        metafields: [
          {
            namespace: '$app:incentives',
            key: 'signing-secret',
            type: 'single_line_text_field',
            value: tenantSigningKey,
          },
        ],
      },
    },
    apiVersion,
  );

  // 7. Register Shopify Master Discount Code Node
  const createCodeDiscountMutation = `
    mutation CreateCodeDiscount($codeAppDiscount: DiscountCodeAppInput!) {
      discountCodeAppCreate(codeAppDiscount: $codeAppDiscount) {
        codeAppDiscount {
          discountId
          title
          status
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  await shopifyGraphQL(
    shop,
    accessToken,
    createCodeDiscountMutation,
    {
      codeAppDiscount: {
        title: 'Incentives Exclusive Codes',
        functionId,
        code: 'INCENTIVES_APPLIED',
        startsAt: now,
        metafields: [
          {
            namespace: '$app:incentives',
            key: 'signing-secret',
            type: 'single_line_text_field',
            value: tenantSigningKey,
          },
        ],
      },
    },
    apiVersion,
  );

  return {
    shop,
    merchantId: tenantId,
    publishableToken,
    secretToken,
    tenantSigningKey,
  };
}
