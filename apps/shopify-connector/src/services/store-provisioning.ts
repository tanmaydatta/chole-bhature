import type { OperatorCallContext } from '@incentives/contracts';
import type { Env } from '../env.js';
import { createOperatorContext } from './operator-context.js';
import { ensureShopifyBaselineSchema } from './schema-provisioning.js';
import {
  assertNoUserErrors,
  shopifyGraphQL,
} from './shopify-graphql.js';
import { ensureShopifyWebhooks } from './shopify-webhooks.js';
import { decryptToken, encryptToken } from './token-crypto.js';

export { shopifyGraphQL } from './shopify-graphql.js';

export interface ProvisionStoreOptions {
  shop: string;
  accessToken: string;
  functionHandle?: string;
  apiVersion?: string;
}

export interface ProvisionStoreResult {
  shop: string;
  merchantId: string;
  publishableToken?: string;
  secretToken?: string;
  tenantSigningKey: string;
  automaticDiscountId?: string;
  schemaVersion?: number;
  warnings: string[];
}

interface ExistingShopRow {
  shop_domain: string;
  access_token: string;
  tenant_id: string;
  tenant_signing_key: string;
  publishable_token?: string | null;
  secret_token?: string | null;
  status: string;
  automatic_discount_id?: string | null;
  function_handle?: string | null;
}

export function generateTenantSigningKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function findExistingShop(env: Env, shop: string): Promise<ExistingShopRow | null> {
  return env.DB.prepare(
    `SELECT shop_domain, access_token, tenant_id, tenant_signing_key,
            publishable_token, secret_token, status,
            automatic_discount_id, function_handle
     FROM shopify_installed_shops
     WHERE shop_domain = ?
     LIMIT 1`,
  )
    .bind(shop)
    .first<ExistingShopRow>();
}

async function upsertProvisioningRow(
  env: Env,
  input: {
    shop: string;
    accessToken: string;
    tenantId: string;
    tenantSigningKey: string;
    publishableToken?: string | undefined;
    secretToken?: string | undefined;
    status: 'provisioning' | 'active' | 'error';
    automaticDiscountId?: string | undefined;
    functionHandle?: string | undefined;
    schemaVersion?: number | undefined;
    webhookRegisteredAt?: string | undefined;
    provisioningError?: string | undefined;
    installedAt?: string | undefined;
    uninstalledAt?: string | undefined;
  },
): Promise<void> {
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
      automatic_discount_id,
      function_handle,
      schema_version,
      webhook_registered_at,
      provisioning_error,
      installed_at,
      uninstalled_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      access_token = excluded.access_token,
      tenant_id = excluded.tenant_id,
      tenant_signing_key = excluded.tenant_signing_key,
      publishable_token = COALESCE(excluded.publishable_token, shopify_installed_shops.publishable_token),
      secret_token = COALESCE(excluded.secret_token, shopify_installed_shops.secret_token),
      status = excluded.status,
      automatic_discount_id = COALESCE(excluded.automatic_discount_id, shopify_installed_shops.automatic_discount_id),
      function_handle = COALESCE(excluded.function_handle, shopify_installed_shops.function_handle),
      schema_version = COALESCE(excluded.schema_version, shopify_installed_shops.schema_version),
      webhook_registered_at = COALESCE(excluded.webhook_registered_at, shopify_installed_shops.webhook_registered_at),
      provisioning_error = excluded.provisioning_error,
      installed_at = COALESCE(shopify_installed_shops.installed_at, excluded.installed_at),
      uninstalled_at = excluded.uninstalled_at,
      updated_at = excluded.updated_at`,
  )
    .bind(
      input.shop,
      await encryptToken(env, input.accessToken),
      input.tenantId,
      await encryptToken(env, input.tenantSigningKey),
      input.publishableToken === undefined
        ? null
        : await encryptToken(env, input.publishableToken),
      input.secretToken === undefined ? null : await encryptToken(env, input.secretToken),
      input.status,
      input.automaticDiscountId ?? null,
      input.functionHandle ?? null,
      input.schemaVersion ?? null,
      input.webhookRegisteredAt ?? null,
      input.provisioningError ?? null,
      input.installedAt ?? now,
      input.uninstalledAt ?? null,
      now,
      now,
    )
    .run();
}

async function createCredentials(
  env: Env,
  operatorContext: OperatorCallContext,
  shop: string,
  existing: ExistingShopRow | null,
): Promise<{ publishableToken?: string; secretToken?: string; warnings: string[] }> {
  const warnings: string[] = [];
  let publishableToken: string | undefined;
  let secretToken: string | undefined;

  if (existing?.publishable_token) {
    publishableToken = await decryptToken(env, existing.publishable_token);
  } else {
    const credential = await env.CORE.createCredential(operatorContext, {
      name: `Shopify Storefront (${shop})`,
      kind: 'publishable',
      environment: 'production',
      scopes: ['evaluations:write', 'schema:read'],
      allowedOrigins: [`https://${shop}`],
    });
    publishableToken = credential.token;
  }

  if (existing?.secret_token) {
    try {
      secretToken = await decryptToken(env, existing.secret_token);
    } catch {
      warnings.push('Stored Shopify backend credential could not be decrypted; creating a new one.');
    }
  }
  if (!secretToken) {
    const credential = await env.CORE.createCredential(operatorContext, {
      name: `Shopify Backend (${shop})`,
      kind: 'secret',
      environment: 'production',
      scopes: ['evaluations:write', 'redemptions:write', 'customers:write'],
    });
    secretToken = credential.token;
  }

  return { publishableToken, secretToken, warnings };
}

async function ensureAutomaticDiscountNode(
  env: Env,
  input: {
    shop: string;
    accessToken: string;
    functionHandle: string;
    tenantSigningKey: string;
    apiVersion: string;
    existingDiscountId?: string | undefined;
  },
): Promise<string> {
  const metafields = [
    {
      namespace: '$app:incentives',
      key: 'signing-secret',
      type: 'single_line_text_field',
      value: input.tenantSigningKey,
    },
  ];
  const startsAt = new Date().toISOString();

  if (input.existingDiscountId) {
    const update = await shopifyGraphQL<Record<string, unknown>>(
      input.shop,
      input.accessToken,
      `mutation UpdateAutomaticDiscount(
        $id: ID!
        $automaticAppDiscount: DiscountAutomaticAppInput!
      ) {
        discountAutomaticAppUpdate(
          id: $id
          automaticAppDiscount: $automaticAppDiscount
        ) {
          automaticAppDiscount { discountId title status }
          userErrors { field message code }
        }
      }`,
      {
        id: input.existingDiscountId,
        automaticAppDiscount: {
          title: 'Incentives Automatic Discounts',
          functionHandle: input.functionHandle,
          discountClasses: ['ORDER'],
          startsAt,
          metafields,
        },
      },
      input.apiVersion,
    );

    const updateErrors = (
      update.data?.['discountAutomaticAppUpdate'] as
        | { userErrors?: Array<{ message: string; code?: string }> }
        | undefined
    )?.userErrors;
    const notFound = updateErrors?.some(error => /not found|does not exist/iu.test(error.message));
    if (!notFound) {
      assertNoUserErrors('discountAutomaticAppUpdate', update as { data?: Record<string, unknown> });
      return input.existingDiscountId;
    }
  }

  const created = await shopifyGraphQL<Record<string, unknown>>(
    input.shop,
    input.accessToken,
    `mutation CreateAutomaticDiscount(
      $automaticAppDiscount: DiscountAutomaticAppInput!
    ) {
      discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount { discountId title status }
        userErrors { field message code }
      }
    }`,
    {
      automaticAppDiscount: {
        title: 'Incentives Automatic Discounts',
        functionHandle: input.functionHandle,
        discountClasses: ['ORDER'],
        startsAt,
        metafields,
      },
    },
    input.apiVersion,
  );
  assertNoUserErrors('discountAutomaticAppCreate', created as { data?: Record<string, unknown> });

  const discountId = (
    created.data?.['discountAutomaticAppCreate'] as
      | { automaticAppDiscount?: { discountId?: string } }
      | undefined
  )?.automaticAppDiscount?.discountId;
  if (!discountId) {
    throw new Error('Shopify discountAutomaticAppCreate returned no discountId');
  }
  return discountId;
}

export async function provisionStore(
  env: Env,
  options: ProvisionStoreOptions,
): Promise<ProvisionStoreResult> {
  const { shop, accessToken } = options;
  const apiVersion = options.apiVersion ?? env.SHOPIFY_API_VERSION ?? '2026-07';
  const functionHandle =
    options.functionHandle ??
    env.SHOPIFY_DISCOUNT_FUNCTION_HANDLE ??
    'incentives-discount-fn';
  const appUrl = env.SHOPIFY_APP_URL;
  if (!appUrl) {
    throw new Error('SHOPIFY_APP_URL is required to register Shopify webhooks');
  }

  const tenantId = `shop_${shop.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const correlationId = crypto.randomUUID();
  const warnings: string[] = [];
  const existing = await findExistingShop(env, shop);
  const tenantSigningKey = existing?.tenant_signing_key
    ? await decryptToken(env, existing.tenant_signing_key)
    : generateTenantSigningKey();

  await upsertProvisioningRow(env, {
    shop,
    accessToken,
    tenantId,
    tenantSigningKey,
    status: 'provisioning',
    functionHandle,
    automaticDiscountId: existing?.automatic_discount_id ?? undefined,
  });

  try {
    // 1. Create or reuse the merchant tenant.
    const provisionContext = createOperatorContext(
      tenantId,
      'credentials:manage',
      correlationId,
    );
    const provisioningId = existing ? `prov_reinstall_${crypto.randomUUID()}` : `prov_${crypto.randomUUID()}`;
    const provisionResult = await env.CORE.provisionMerchant(provisionContext, {
      id: tenantId,
      name: shop,
      provisioningId,
    });
    if (!provisionResult.ok && provisionResult.error.code !== 'CONFLICT') {
      throw new Error(
        `Failed to provision merchant in Core: ${provisionResult.error.message} (${provisionResult.error.code})`,
      );
    }
    if (env.CORE.activateMerchant) {
      await env.CORE.activateMerchant(provisionContext, {
        id: tenantId,
        provisioningId,
      });
    }

    // 2. Reuse or create API credentials. The storefront now authenticates with
    // Shopify session tokens, so the publishable token is kept only for
    // compatibility with existing operator tooling.
    const credentials = await createCredentials(env, provisionContext, shop, existing);
    warnings.push(...credentials.warnings);

    // 3. Publish the baseline schema required by /v1/evaluate.
    const schema = await ensureShopifyBaselineSchema(env, tenantId, correlationId);

    // 4. Create or update the single automatic discount node.
    const automaticDiscountId = await ensureAutomaticDiscountNode(env, {
      shop,
      accessToken,
      functionHandle,
      tenantSigningKey,
      apiVersion,
      existingDiscountId: existing?.automatic_discount_id ?? undefined,
    });

    // 5. Register webhooks.
    const webhooks = await ensureShopifyWebhooks(shop, accessToken, appUrl, apiVersion);
    warnings.push(...webhooks.warnings);

    const now = new Date().toISOString();
    await upsertProvisioningRow(env, {
      shop,
      accessToken,
      tenantId,
      tenantSigningKey,
      publishableToken: credentials.publishableToken,
      secretToken: credentials.secretToken,
      status: 'active',
      automaticDiscountId,
      functionHandle,
      schemaVersion: schema.version,
      webhookRegisteredAt: now,
      installedAt: now,
    });

    return {
      shop,
      merchantId: tenantId,
      ...(credentials.publishableToken === undefined
        ? {}
        : { publishableToken: credentials.publishableToken }),
      ...(credentials.secretToken === undefined ? {} : { secretToken: credentials.secretToken }),
      tenantSigningKey,
      automaticDiscountId,
      schemaVersion: schema.version,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertProvisioningRow(env, {
      shop,
      accessToken,
      tenantId,
      tenantSigningKey,
      status: 'error',
      functionHandle,
      provisioningError: message,
      automaticDiscountId: existing?.automatic_discount_id ?? undefined,
    });
    throw error;
  }
}
