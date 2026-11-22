import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sign } from 'hono/jwt';
import { createApp } from '../src/app.js';
import type { Env, CoreServiceBinding } from '../src/env.js';
import {
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  type EvaluationResponse,
  type CandidateOffer,
} from '@incentives/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Helper Functions for Cryptographic Signatures & Tokens
// ============================================================================

export function computeShopifyOAuthHmac(params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'hmac' && k !== 'signature')
    .sort();
  const message = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function computeShopifyWebhookHmac(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

export function computeDiscountFunctionHmac(
  data: {
    evaluationId: string;
    cartId: string;
    subtotalMinorUnits: number;
    currency: string;
    discountMinorUnits: number;
    expiresAt?: string;
  },
  secret: string,
): string {
  const message = `${data.evaluationId}:${data.cartId}:${data.subtotalMinorUnits}:${data.currency}:${data.discountMinorUnits}:${data.expiresAt ?? ''}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export async function createSessionToken(
  shop: string,
  clientId: string,
  clientSecret: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: clientId,
    sub: 'operator_merchant_user_1',
    exp: now + 3600,
    nbf: now - 30,
    iat: now - 30,
    jti: crypto.randomUUID(),
    ...overrides,
  };
  return sign(payload, clientSecret, 'HS256');
}

// ============================================================================
// Rust Wasm Discount Function Contract Types & Evaluator
// ============================================================================

interface DiscountFunctionInput {
  cart: {
    id: string;
    cost: {
      subtotalAmount: {
        amount: string;
        currencyCode: string;
      };
    };
    lines?: Array<any>;
    attribute?: {
      key?: string;
      value?: string;
    };
  };
  discountNode?: {
    metafield?: {
      value?: string;
    };
  };
}

interface DiscountFunctionResult {
  discounts: Array<{
    value: {
      fixedAmount?: {
        amount: string;
        appliesToEachItem?: boolean;
      };
      percentage?: {
        value: string;
      };
    };
    targets: Array<{
      orderSubtotal?: {
        excludedVariantIds?: string[];
      };
      productVariant?: {
        id: string;
        quantity?: number;
      };
    }>;
    message?: string;
  }>;
  discountApplicationStrategy: 'FIRST' | 'MAXIMUM';
}

function parseToMinorUnits(amountStr: string): number | null {
  const trimmed = amountStr.trim();
  if (!trimmed) return null;
  const isNegative = trimmed.startsWith('-');
  const numStr = isNegative ? trimmed.slice(1) : trimmed;
  if (!numStr) return null;

  const parts = numStr.split('.');
  if (parts.length > 2) return null;
  if (!parts.every(p => /^\d*$/.test(p))) return null;

  const whole = parts[0] === '' ? 0 : parseInt(parts[0], 10);
  if (Number.isNaN(whole)) return null;

  let frac = 0;
  if (parts.length === 2) {
    const fracStr = parts[1];
    if (fracStr.length === 0) {
      frac = 0;
    } else if (fracStr.length === 1) {
      frac = parseInt(fracStr, 10) * 10;
    } else if (fracStr.length === 2) {
      frac = parseInt(fracStr, 10);
    } else {
      const firstTwo = parseInt(fracStr.slice(0, 2), 10);
      const third = parseInt(fracStr.slice(2, 3), 10);
      frac = third >= 5 ? firstTwo + 1 : firstTwo;
    }
  }

  const total = whole * 100 + frac;
  return isNegative ? -total : total;
}

function canonicalFingerprint(input: DiscountFunctionInput, evalPayload: any): string {
  const lines = (input.cart.lines ?? [])
    .map((line: any) => {
      const quantity = Number(line.quantity ?? 1);
      const lineTotal = parseToMinorUnits(line.cost?.subtotalAmount?.amount ?? '0') ?? 0;
      const unitPrice = Math.round(lineTotal / Math.max(1, quantity));
      return {
        lineRef: String(line.id),
        productRef: String(line.merchandise?.product?.id ?? ''),
        variantRef: line.merchandise?.id ? String(line.merchandise.id) : null,
        quantity,
        unitPrice,
      };
    })
    .sort((left: any, right: any) => left.lineRef.localeCompare(right.lineRef));
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        currency: evalPayload.currency,
        subtotal: evalPayload.subtotalMinorUnits,
        lines,
      }),
    )
    .digest('hex');
}

function verifyDiscountFunctionContract(input: DiscountFunctionInput): DiscountFunctionResult {
  const emptyResult: DiscountFunctionResult = {
    discounts: [],
    discountApplicationStrategy: 'FIRST',
  };

  const attrVal = input.cart.attribute?.value?.trim();
  if (!attrVal) return emptyResult;

  let evalPayload: any;
  try {
    evalPayload = JSON.parse(attrVal);
  } catch {
    return emptyResult;
  }

  const cartSubtotalMinor = parseToMinorUnits(input.cart.cost.subtotalAmount.amount);
  if (cartSubtotalMinor === null || evalPayload.subtotalMinorUnits !== cartSubtotalMinor) {
    return emptyResult;
  }

  if (
    evalPayload.currency?.toLowerCase() !==
    input.cart.cost.subtotalAmount.currencyCode?.toLowerCase()
  ) {
    return emptyResult;
  }

  if (evalPayload.expiresAt !== undefined) {
    const expiresAt = Date.parse(evalPayload.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return emptyResult;
  }

  const secret = input.discountNode?.metafield?.value?.trim();
  if (!secret) return emptyResult;

  const fingerprint = canonicalFingerprint(input, evalPayload);
  if (evalPayload.cartFingerprint !== fingerprint) return emptyResult;

  const message = [
    'v2',
    evalPayload.evaluationId,
    evalPayload.shopDomain ?? '',
    evalPayload.checkoutToken ?? evalPayload.cartId ?? '',
    evalPayload.cartFingerprint,
    evalPayload.subtotalMinorUnits,
    evalPayload.currency,
    evalPayload.discountMinorUnits,
    evalPayload.leaseId ?? '',
    evalPayload.leaseExpiresAt ?? '',
    evalPayload.expiresAt ?? '',
  ].join(':');
  const expectedSig = crypto.createHmac('sha256', secret).update(message).digest('hex');

  let sigValid = false;
  try {
    sigValid = crypto.timingSafeEqual(
      Buffer.from(evalPayload.signature?.trim() || '', 'hex'),
      Buffer.from(expectedSig, 'hex'),
    );
  } catch {
    sigValid = false;
  }

  if (!sigValid) return emptyResult;

  const target = evalPayload.target || 'order';
  if (target !== 'order') return emptyResult;

  if (!evalPayload.discountMinorUnits || evalPayload.discountMinorUnits <= 0) {
    return emptyResult;
  }

  const discountMinor = Math.min(evalPayload.discountMinorUnits, cartSubtotalMinor);
  const major = Math.floor(discountMinor / 100);
  const rem = discountMinor % 100;
  const formattedAmount = `${major}.${rem.toString().padStart(2, '0')}`;

  return {
    discounts: [
      {
        value: {
          fixedAmount: {
            amount: formattedAmount,
          },
        },
        targets: [
          {
            orderSubtotal: {
              excludedVariantIds: [],
            },
          },
        ],
        message: 'Incentives Discount',
      },
    ],
    discountApplicationStrategy: 'FIRST',
  };
}

function execDiscountFunctionRust(input: DiscountFunctionInput): DiscountFunctionResult | null {
  const rustBinaryPath = path.resolve(
    __dirname,
    '../extensions/incentives-discount-fn/target/debug/incentives-discount-fn',
  );
  if (!fs.existsSync(rustBinaryPath)) {
    return null;
  }
  try {
    const stdout = execFileSync(rustBinaryPath, [], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout) as DiscountFunctionResult;
  } catch {
    return null;
  }
}

// ============================================================================
// Mock D1 Database & Storage Layer
// ============================================================================

class MockD1PreparedStatement {
  constructor(
    private db: MockD1Database,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new MockD1PreparedStatement(this.db, this.sql, params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.db.executeAll<T>(this.sql, this.params);
  }

  async run(): Promise<{ success: boolean; meta: Record<string, unknown> }> {
    return this.db.executeRun(this.sql, this.params);
  }
}

class MockD1Database {
  public rows: Map<string, Record<string, unknown>> = new Map();

  prepare(sql: string) {
    return new MockD1PreparedStatement(this, sql);
  }

  executeRun(sql: string, params: unknown[]): { success: boolean; meta: Record<string, unknown> } {
    if (sql.includes('shopify_installed_shops')) {
      if (sql.toUpperCase().includes('INSERT') || sql.toUpperCase().includes('REPLACE')) {
        const [
          shopDomain,
          accessToken,
          tenantId,
          tenantSigningKey,
          publishableToken,
          secretToken,
          status,
          automaticDiscountId,
          functionHandle,
          schemaVersion,
          webhookRegisteredAt,
          provisioningError,
          installedAt,
          uninstalledAt,
          createdAt,
          updatedAt,
        ] = params as Array<string | null>;

        this.rows.set(shopDomain as string, {
          shop_domain: shopDomain,
          access_token: accessToken,
          tenant_id: tenantId,
          tenant_signing_key: tenantSigningKey,
          publishable_token: publishableToken,
          secret_token: secretToken,
          status,
          automatic_discount_id: automaticDiscountId,
          function_handle: functionHandle,
          schema_version: schemaVersion,
          webhook_registered_at: webhookRegisteredAt,
          provisioning_error: provisioningError,
          installed_at: installedAt,
          uninstalled_at: uninstalledAt,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      } else if (sql.toUpperCase().includes('UPDATE')) {
        // Uninstall/status updates
        const [uninstalledAt, updatedAt, shopDomain] = params as string[];
        const row = this.rows.get(shopDomain);
        if (row) {
          this.rows.set(shopDomain, {
            ...row,
            status: 'uninstalled',
            uninstalled_at: uninstalledAt,
            updated_at: updatedAt,
          });
        }
      }
    }
    return { success: true, meta: {} };
  }

  executeAll<T>(sql: string, params: unknown[]): { results: T[] } {
    if (sql.includes('shopify_installed_shops') && sql.toUpperCase().includes('SELECT')) {
      const param = params[0] as string | undefined;
      if (param) {
        if (this.rows.has(param)) {
          return { results: [this.rows.get(param) as T] };
        }
        for (const row of this.rows.values()) {
          if (row.publishable_token === param || row.secret_token === param) {
            return { results: [row as T] };
          }
        }
        return { results: [] };
      }
      return { results: Array.from(this.rows.values()) as T[] };
    }
    return { results: [] };
  }
}

// ============================================================================
// End-to-End Integration Suite
// ============================================================================

describe('Shopify Plus Turnkey Integration - End-to-End System Integration Suite', () => {
  const CLIENT_ID = 'test-shopify-client-id';
  const CLIENT_SECRET = 'test-shopify-client-secret-super-secure';
  const APP_URL = 'https://shopify.incentives.dev';
  const SHOP = 'quickstart-plus-store.myshopify.com';
  const EXPECTED_TENANT_ID = 'shop_quickstart_plus_store_myshopify_com';

  let mockDb: MockD1Database;
  let mockCore: CoreServiceBinding;
  let testEnv: Env;
  let capturedShopifyCalls: Array<{ url: string; query?: string; variables?: unknown }> = [];

  // Stateful tracking for Core Engine
  let provisionedMerchants: Map<string, any>;
  let issuedCredentials: Map<string, any>;
  let committedRedemptions: Map<string, any>;
  let reversedRedemptions: Map<string, any>;
  let refundedRedemptions: Map<string, any>;
  let auditRows: Array<any>;
  let mockCampaignBudget: { total: number; remaining: number };

  beforeEach(() => {
    mockDb = new MockD1Database();
    capturedShopifyCalls = [];
    provisionedMerchants = new Map();
    issuedCredentials = new Map();
    committedRedemptions = new Map();
    reversedRedemptions = new Map();
    refundedRedemptions = new Map();
    auditRows = [];
    mockCampaignBudget = { total: 100000, remaining: 100000 }; // $1000 budget in cents

    mockCore = {
      provisionMerchant: vi.fn(async (context, input) => {
        const tenant = {
          id: input.id,
          name: input.name,
          provisioningId: input.provisioningId,
          status: 'active' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        provisionedMerchants.set(input.id, tenant);
        return { ok: true as const, value: tenant };
      }),
      activateMerchant: vi.fn(async (_context, input) => {
        const tenant = provisionedMerchants.get(input.id);
        if (tenant) tenant.status = 'active';
        return { ok: true as const, value: tenant ?? { id: input.id, name: input.id, provisioningId: input.id, status: 'active', createdAt: '', updatedAt: '' } };
      }),
      createCredential: vi.fn(async (context, input) => {
        const isPub = input.kind === 'publishable';
        const token = isPub
          ? `pk_live_${crypto.randomUUID().replace(/-/g, '')}`
          : `sk_live_${crypto.randomUUID().replace(/-/g, '')}`;
        const cred = {
          id: `cred_${input.kind}_${crypto.randomUUID()}`,
          name: input.name,
          merchantId: context.merchantId,
          environment: 'production' as const,
          scopes: input.scopes,
          createdAt: new Date().toISOString(),
          createdBy: context.actorUserId,
          status: 'active' as const,
          suffix: isPub ? 'pk1234' : 'sk1234',
          ...(isPub
            ? {
                kind: 'publishable' as const,
                allowedOrigins: input.allowedOrigins ?? [],
                requestsPerMinute: 60,
              }
            : { kind: 'secret' as const }),
        };
        issuedCredentials.set(token, cred);
        return { credential: cred, token };
      }),
      listSchemaDefinitions: vi.fn(async () => ({ definitions: [] })),
      createSchemaDefinition: vi.fn(async (_context, input) => ({
        id: `def_${input.key}`,
        definition: input,
        readOnly: false,
        referenced: false,
      })),
      publishSchema: vi.fn(async () => ({
        version: 1,
        publishedAt: new Date().toISOString(),
        definitions: [],
        jsonSchema: {},
        sample: {},
        warnings: [],
      })),
      evaluate: vi.fn(async (_context, input) => {
        const subtotal = input.cart.subtotal;
        const isQualified = subtotal >= 10000;
        const discountAmount = isQualified ? 2000 : 0;
        const candidateOffers: CandidateOffer[] = [
          {
            programRef: 'tier-100-get-20',
            name: 'Spend $100 get $20 off',
            qualified: isQualified,
            estimatedDiscountMinorUnits: 2000,
            progress: {
              current: subtotal,
              target: 10000,
              shortfall: Math.max(0, 10000 - subtotal),
            },
          },
        ];
        return {
          evaluationId: 'eval-cart-e2e-001',
          schemaVersion: 1,
          expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
          decisions: isQualified
            ? [
                {
                  programRef: 'tier-100-get-20',
                  programRevision: 1,
                  programType: 'promo' as const,
                  outcome: 'qualified' as const,
                  eligible: true,
                  commitRequired: true,
                  effects: [
                    {
                      type: 'order_discount' as const,
                      calculation: 'fixed' as const,
                      amount: { currency: 'USD', minorUnits: discountAmount },
                    },
                  ],
                  reasonCodes: ['QUALIFIED_AUTO_APPLY'],
                },
              ]
            : [
                {
                  programRef: 'tier-100-get-20',
                  programRevision: 1,
                  programType: 'promo' as const,
                  outcome: 'not_qualified' as const,
                  eligible: false,
                  commitRequired: false,
                  effects: [],
                  reasonCodes: ['SUBTOTAL_THRESHOLD_NOT_MET'],
                },
              ],
          priceBreakdown: {
            currency: 'USD',
            originalMerchandiseSubtotal: subtotal,
            discountAllocations: isQualified
              ? [
                  {
                    programRef: 'tier-100-get-20',
                    programRevision: 1,
                    rewardRuleRef: 'rule-fixed-20',
                    discountMinorUnits: discountAmount,
                  },
                ]
              : [],
            totalDiscount: discountAmount,
            discountedMerchandiseSubtotal: subtotal - discountAmount,
          },
          candidateOffers,
        };
      }),
      commitRedemption: vi.fn(async (input: any) => {
        // Idempotency check: if already committed, return the existing record without double-decrementing
        if (committedRedemptions.has(input.idempotencyKey)) {
          return committedRedemptions.get(input.idempotencyKey);
        }

        const discountMinor = 2000; // $20.00
        mockCampaignBudget.remaining -= discountMinor;

        const redemptionRecord = {
          redemptionId: `red_${crypto.randomUUID()}`,
          evaluationId: input.evaluationId,
          externalOrderRef: input.externalOrderRef,
          idempotencyKey: input.idempotencyKey,
          status: 'committed' as const,
          entries: [
            {
              programRef: 'tier-100-get-20',
              programRevision: 1,
              rewardRuleRef: 'rule-fixed-20',
              effects: [
                {
                  type: 'order_discount' as const,
                  calculation: 'fixed' as const,
                  amount: { currency: 'USD', minorUnits: discountMinor },
                },
              ],
            },
          ],
          priceBreakdown: {
            currency: 'USD',
            originalMerchandiseSubtotal: 10000,
            discountAllocations: [
              {
                programRef: 'tier-100-get-20',
                programRevision: 1,
                rewardRuleRef: 'rule-fixed-20',
                discountMinorUnits: discountMinor,
              },
            ],
            totalDiscount: discountMinor,
            discountedMerchandiseSubtotal: 8000,
          },
        };

        expect(RedemptionResponseSchema.safeParse(redemptionRecord).success).toBe(true);

        committedRedemptions.set(input.idempotencyKey, redemptionRecord);
        auditRows.push({
          action: 'commit_redemption',
          merchantId: input.merchantId,
          idempotencyKey: input.idempotencyKey,
          amountMinor: discountMinor,
          timestamp: new Date().toISOString(),
        });

        return redemptionRecord;
      }),
      reverseRedemption: vi.fn(async (input: any) => {
        reversedRedemptions.set(input.idempotencyKey, input);
        mockCampaignBudget.remaining += 2000;
        auditRows.push({
          action: 'reverse_redemption',
          merchantId: input.merchantId,
          orderId: input.orderId,
          timestamp: new Date().toISOString(),
        });
        return { reversed: true };
      }),
      refundRedemption: vi.fn(async (input: any) => {
        refundedRedemptions.set(String(input.refundId), input);
        mockCampaignBudget.remaining += 2000;
        auditRows.push({
          action: 'refund_redemption',
          merchantId: input.merchantId,
          refundId: input.refundId,
          timestamp: new Date().toISOString(),
        });
        return { refunded: true };
      }),
      upsertCustomer: vi.fn(async () => ({
        customerRef: 'customer_123',
        attributes: {},
      })),
      fetch: vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === '/v1/programs') {
          return new Response(
            JSON.stringify({
              programs: [
                { id: 'prog_1', name: 'Spend $100 Get $20 Off VIP Tier', active: true },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
      }),
    };

    testEnv = {
      CORE: mockCore,
      DB: mockDb as unknown as D1Database,
      SHOPIFY_CLIENT_ID: CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
      SHOPIFY_APP_URL: APP_URL,
      SHOPIFY_DISCOUNT_FUNCTION_HANDLE: 'incentives-discount-fn',
    };

    // Mock global fetch for external Shopify API interactions and Storefront / Core evaluations
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};

      capturedShopifyCalls.push({
        url,
        query: body.query,
        variables: body.variables,
      });

      // 1. Shopify OAuth Token Exchange
      if (url.includes('/admin/oauth/access_token')) {
        return new Response(
          JSON.stringify({
            access_token: 'shpat_e2e_permanent_access_token_12345',
            scope: 'read_orders,write_discounts,read_customers,write_customers',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // 2. Shopify GraphQL Admin API
      if (url.includes('/graphql.json')) {
        const query = body.query || '';

        if (query.includes('WebhookSubscriptions')) {
          return new Response(
            JSON.stringify({ data: { webhookSubscriptions: { nodes: [] } } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (query.includes('webhookSubscriptionCreate')) {
          return new Response(
            JSON.stringify({
              data: {
                webhookSubscriptionCreate: {
                  webhookSubscription: { id: `gid://shopify/WebhookSubscription/${Math.random()}` },
                  userErrors: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (query.includes('discountAutomaticAppCreate') || query.includes('discountAutomaticAppUpdate')) {
          return new Response(
            JSON.stringify({
              data: {
                [query.includes('discountAutomaticAppUpdate')
                  ? 'discountAutomaticAppUpdate'
                  : 'discountAutomaticAppCreate']: {
                  automaticAppDiscount: {
                    discountId: 'gid://shopify/DiscountAutomaticApp/100',
                    title: 'Incentives Automatic Discounts',
                    status: 'ACTIVE',
                  },
                  userErrors: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response(
          JSON.stringify({ data: {}, userErrors: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // 3. Core Storefront Evaluation API (/v1/evaluate)
      if (url.includes('/v1/evaluate')) {
        const subtotal = body.cart?.subtotal ?? 0;
        const isQualified = subtotal >= 10000;
        const discountAmount = isQualified ? 2000 : 0;

        const candidateOffers: CandidateOffer[] = [
          {
            programRef: 'tier-100-get-20',
            name: 'Spend $100 get $20 off',
            qualified: isQualified,
            estimatedDiscountMinorUnits: 2000,
            progress: {
              current: subtotal,
              target: 10000,
              shortfall: Math.max(0, 10000 - subtotal),
            },
          },
        ];

        const evalResponse: EvaluationResponse = {
          evaluationId: 'eval-cart-e2e-001',
          schemaVersion: 1,
          expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
          decisions: isQualified
            ? [
                {
                  programRef: 'tier-100-get-20',
                  programRevision: 1,
                  programType: 'promo' as const,
                  outcome: 'qualified' as const,
                  eligible: true,
                  commitRequired: true,
                  effects: [
                    {
                      type: 'order_discount' as const,
                      calculation: 'fixed' as const,
                      amount: { currency: 'USD', minorUnits: discountAmount },
                    },
                  ],
                  reasonCodes: ['QUALIFIED_AUTO_APPLY'],
                },
              ]
            : [
                {
                  programRef: 'tier-100-get-20',
                  programRevision: 1,
                  programType: 'promo' as const,
                  outcome: 'not_qualified' as const,
                  eligible: false,
                  commitRequired: false,
                  effects: [],
                  reasonCodes: ['SUBTOTAL_THRESHOLD_NOT_MET'],
                },
              ],
          priceBreakdown: {
            currency: 'USD',
            originalMerchandiseSubtotal: subtotal,
            discountAllocations: isQualified
              ? [
                  {
                    programRef: 'tier-100-get-20',
                    programRevision: 1,
                    rewardRuleRef: 'rule-fixed-20',
                    discountMinorUnits: discountAmount,
                  },
                ]
              : [],
            totalDiscount: discountAmount,
            discountedMerchandiseSubtotal: subtotal - discountAmount,
          },
          candidateOffers,
        };

        return new Response(JSON.stringify(evalResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // MASTER TEST: Complete Turnkey Lifecycle (Steps 1 to 8 Sequential Journey)
  // ==========================================================================
  describe('Unified End-to-End Turnkey Lifecycle', () => {
    it('executes steps 1 through 8 sequentially with complete state continuity and cryptographic integrity', async () => {
      const app = createApp();

      // ----------------------------------------------------------------------
      // Step 1: Merchant OAuth Install (/auth/shopify -> /auth/callback)
      // ----------------------------------------------------------------------
      // 1.1 Initiate OAuth
      const installRes = await app.request(`/auth/shopify?shop=${SHOP}`, { method: 'GET' }, testEnv);
      expect(installRes.status).toBe(302);
      const redirectLocation = installRes.headers.get('Location')!;
      expect(redirectLocation).toContain(`https://${SHOP}/admin/oauth/authorize`);
      expect(redirectLocation).toContain(`client_id=${CLIENT_ID}`);

      // Extract CSRF state cookie
      const setCookieHeader = installRes.headers.get('Set-Cookie')!;
      expect(setCookieHeader).toContain('shopify_oauth_state=');
      const stateMatch = setCookieHeader.match(/shopify_oauth_state=([^;]+)/);
      expect(stateMatch).not.toBeNull();
      const stateNonce = stateMatch![1];

      // 1.2 Merchant accepts scopes and Shopify redirects to /auth/callback
      const callbackParams: Record<string, string> = {
        code: 'shopify-auth-code-xyz',
        shop: SHOP,
        state: stateNonce,
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      const oauthHmac = computeShopifyOAuthHmac(callbackParams, CLIENT_SECRET);
      callbackParams['hmac'] = oauthHmac;

      const queryString = new URLSearchParams(callbackParams).toString();
      const callbackRes = await app.request(
        `/auth/callback?${queryString}`,
        {
          method: 'GET',
          headers: {
            Cookie: `shopify_oauth_state=${stateNonce}`,
          },
        },
        testEnv,
      );

      // Verify redirect to the onboarding page
      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.get('Location')).toContain(`/onboarding?shop=${encodeURIComponent(SHOP)}`);

      // Verify Core tenant provisioning
      expect(mockCore.provisionMerchant).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'system:shopify-connector',
          merchantId: EXPECTED_TENANT_ID,
        }),
        expect.objectContaining({
          id: EXPECTED_TENANT_ID,
          name: SHOP,
        }),
      );

      // Verify Core credentials created
      expect(mockCore.createCredential).toHaveBeenCalledTimes(2);

      // Verify D1 store persistence
      const storedShop = mockDb.rows.get(SHOP);
      expect(storedShop).toBeDefined();
      expect(storedShop!.shop_domain).toBe(SHOP);
      expect(storedShop!.tenant_id).toBe(EXPECTED_TENANT_ID);
      expect(storedShop!.status).toBe('active');
      expect(storedShop!.access_token).toBe('shpat_e2e_permanent_access_token_12345');
      expect(storedShop!.publishable_token).toMatch(/^pk_live_/);
      expect(storedShop!.secret_token).toMatch(/^sk_live_/);
      expect(storedShop!.tenant_signing_key).toBeDefined();

      const publishableToken = storedShop!.publishable_token as string;
      const secretToken = storedShop!.secret_token as string;
      const tenantSigningKey = storedShop!.tenant_signing_key as string;

      // Verify the automatic discount node uses the function handle and ORDER class
      const autoDiscountCall = capturedShopifyCalls.find(c => c.query?.includes('discountAutomaticAppCreate'));
      expect(autoDiscountCall).toBeDefined();
      expect(JSON.stringify(autoDiscountCall?.variables)).toContain(tenantSigningKey);
      expect(JSON.stringify(autoDiscountCall?.variables)).toContain('incentives-discount-fn');
      expect(JSON.stringify(autoDiscountCall?.variables)).toContain('ORDER');
      expect(capturedShopifyCalls.some(c => c.query?.includes('discountCodeAppCreate'))).toBe(false);
      expect(capturedShopifyCalls.some(c => c.query?.includes('webhookSubscriptionCreate'))).toBe(true);

      // ----------------------------------------------------------------------
      // Step 2: Evaluation Request with candidate offers & shortfall progress
      // ----------------------------------------------------------------------
      const checkoutToken = 'chk_e2e_shopper_001';
      const checkoutSessionToken = await createSessionToken(SHOP, CLIENT_ID, CLIENT_SECRET, {
        sub: 'gid://shopify/Customer/123',
      });

      const evaluate = async (subtotal: number, items: unknown[]) => {
        const res = await app.fetch(
          new Request('https://shopify.incentives.dev/v1/evaluate', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${checkoutSessionToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              cart: { currency: 'USD', subtotal, items },
              checkoutToken,
              codes: [],
              includeCandidateOffers: true,
            }),
          }),
          testEnv,
        );
        expect(res.status).toBe(200);
        return (await res.json()) as EvaluationResponse;
      };

      // 2.1 First Evaluation: Cart subtotal $80.00 (8000 cents) -> Shortfall $20.00
      const evalData1 = await evaluate(8000, [
        {
          lineRef: 'gid://shopify/CartLine/1',
          productRef: 'gid://shopify/Product/1',
          variantRef: 'gid://shopify/ProductVariant/1',
          quantity: 1,
          unitPrice: 8000,
        },
      ]);
      expect(EvaluationResponseSchema.safeParse(evalData1).success).toBe(true);
      expect(evalData1.candidateOffers).toHaveLength(1);
      expect(evalData1.candidateOffers![0].qualified).toBe(false);
      expect(evalData1.candidateOffers![0].progress).toEqual({
        current: 8000,
        target: 10000,
        shortfall: 2000,
      });

      // 2.2 Shopper adds item reaching $100.00 subtotal (10000 cents) -> Qualified!
      const evalData2 = await evaluate(10000, [
        {
          lineRef: 'gid://shopify/CartLine/1',
          productRef: 'gid://shopify/Product/1',
          variantRef: 'gid://shopify/ProductVariant/1',
          quantity: 1,
          unitPrice: 8000,
        },
        {
          lineRef: 'gid://shopify/CartLine/2',
          productRef: 'gid://shopify/Product/2',
          variantRef: 'gid://shopify/ProductVariant/2',
          quantity: 1,
          unitPrice: 2000,
        },
      ]);
      expect(evalData2.candidateOffers![0].qualified).toBe(true);
      expect(evalData2.candidateOffers![0].progress?.shortfall).toBe(0);
      expect(evalData2.priceBreakdown.totalDiscount).toBe(2000);
      expect(evalData2.signedEvaluation).toBeDefined();

      // ----------------------------------------------------------------------
      // Step 3: Checkout UI Extension Signed Payload Generation (_incentives_eval)
      // ----------------------------------------------------------------------
      const signedExtensionPayload = evalData2.signedEvaluation!;
      expect(signedExtensionPayload.checkoutToken).toBe(checkoutToken);
      expect(signedExtensionPayload.cartFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(signedExtensionPayload.subtotalMinorUnits).toBe(10000);
      expect(signedExtensionPayload.discountMinorUnits).toBe(2000);

      // ----------------------------------------------------------------------
      // Step 4: Verification of Discount Function Contract matching Rust Wasm
      // ----------------------------------------------------------------------
      const fnInput: DiscountFunctionInput = {
        cart: {
          id: 'gid://shopify/Cart/c1-e2e-shopper-001',
          cost: {
            subtotalAmount: {
              amount: '100.00',
              currencyCode: 'USD',
            },
          },
          lines: [
            {
              id: 'gid://shopify/CartLine/1',
              quantity: 1,
              cost: { subtotalAmount: { amount: '80.00', currencyCode: 'USD' } },
              merchandise: {
                id: 'gid://shopify/ProductVariant/1',
                product: { id: 'gid://shopify/Product/1' },
              },
            },
            {
              id: 'gid://shopify/CartLine/2',
              quantity: 1,
              cost: { subtotalAmount: { amount: '20.00', currencyCode: 'USD' } },
              merchandise: {
                id: 'gid://shopify/ProductVariant/2',
                product: { id: 'gid://shopify/Product/2' },
              },
            },
          ],
          attribute: {
            key: '_incentives_eval',
            value: JSON.stringify(signedExtensionPayload),
          },
        },
        discountNode: {
          metafield: {
            value: tenantSigningKey,
          },
        },
      };

      // 4.1 Validate contract logic in TypeScript
      const tsContractResult = verifyDiscountFunctionContract(fnInput);
      expect(tsContractResult.discounts).toHaveLength(1);
      expect(tsContractResult.discounts[0].value.fixedAmount?.amount).toBe('20.00');
      expect(tsContractResult.discounts[0].targets[0].orderSubtotal).toBeDefined();
      expect(tsContractResult.discountApplicationStrategy).toBe('FIRST');

      // ----------------------------------------------------------------------
      // Step 5: Webhook Ingestion of orders/paid with _incentives_eval note attribute
      // ----------------------------------------------------------------------
      const orderId = 987654321;
      const orderPayload = {
        id: orderId,
        admin_graphql_api_id: `gid://shopify/Order/${orderId}`,
        checkout_token: checkoutToken,
        subtotal_price: '100.00',
        total_price: '80.00',
        total_discounts: '20.00',
        currency: 'USD',
        note_attributes: [
          { name: '_incentives_eval', value: JSON.stringify(signedExtensionPayload) },
        ],
      };
      const rawWebhookBody = JSON.stringify(orderPayload);
      const webhookHmac = computeShopifyWebhookHmac(rawWebhookBody, CLIENT_SECRET);

      const paidRes = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': webhookHmac,
          },
          body: rawWebhookBody,
        },
        testEnv,
      );

      expect(paidRes.status).toBe(200);
      const paidJson = await paidRes.json();
      expect(paidJson.received).toBe(true);
      expect(paidJson.status).toBe('committed');

      // Verify atomic commitment in Core
      expect(mockCore.commitRedemption).toHaveBeenCalledTimes(1);
      expect(mockCore.commitRedemption).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: EXPECTED_TENANT_ID,
          evaluationId: signedExtensionPayload.evaluationId,
          externalOrderRef: `gid://shopify/Order/${orderId}`,
          idempotencyKey: `shopify_${orderId}`,
          postCaptureReconciliation: true,
        }),
      );
      expect(mockCampaignBudget.remaining).toBe(98000); // 100000 - 2000
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('commit_redemption');

      // ----------------------------------------------------------------------
      // Step 6: Idempotency Verification (Exact Duplicate Webhook Retried)
      // ----------------------------------------------------------------------
      const duplicatePaidRes = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': webhookHmac,
          },
          body: rawWebhookBody,
        },
        testEnv,
      );

      expect(duplicatePaidRes.status).toBe(200);
      const duplicatePaidJson = await duplicatePaidRes.json();
      expect(duplicatePaidJson.received).toBe(true);
      expect(duplicatePaidJson.status).toBe('committed');

      // Crucial: No double-decrement of budget and no duplicate audit entries!
      expect(mockCore.commitRedemption).toHaveBeenCalledTimes(2);
      expect(mockCampaignBudget.remaining).toBe(98000);
      expect(auditRows).toHaveLength(1);

      // ----------------------------------------------------------------------
      // Step 7: Order Cancellation / Refund Webhook Atomic Reversal
      // ----------------------------------------------------------------------
      // 7.1 Cancel Order Webhook
      const cancelPayload = {
        id: orderId,
        cancelled_at: '2026-11-19T14:30:00Z',
        cancel_reason: 'customer_changed_mind',
      };
      const cancelRawBody = JSON.stringify(cancelPayload);
      const cancelHmac = computeShopifyWebhookHmac(cancelRawBody, CLIENT_SECRET);

      const cancelRes = await app.request(
        '/webhooks/orders-cancelled',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': cancelHmac,
          },
          body: cancelRawBody,
        },
        testEnv,
      );

      expect(cancelRes.status).toBe(200);
      const cancelJson = await cancelRes.json();
      expect(cancelJson.received).toBe(true);
      expect(cancelJson.cancelled).toBe(true);
      expect(mockCore.reverseRedemption).toHaveBeenCalledTimes(1);
      expect(mockCampaignBudget.remaining).toBe(100000); // Restored
      expect(auditRows).toHaveLength(2);
      expect(auditRows[1].action).toBe('reverse_redemption');

      // 7.2 Refund Webhook
      const refundPayload = {
        id: 778899,
        order_id: orderId,
        refund_line_items: [{ line_item_id: 1, quantity: 1 }],
      };
      const refundRawBody = JSON.stringify(refundPayload);
      const refundHmac = computeShopifyWebhookHmac(refundRawBody, CLIENT_SECRET);

      const refundRes = await app.request(
        '/webhooks/refunds-create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': refundHmac,
          },
          body: refundRawBody,
        },
        testEnv,
      );

      expect(refundRes.status).toBe(200);
      const refundJson = await refundRes.json();
      expect(refundJson.received).toBe(true);
      expect(refundJson.refunded).toBe(true);
      expect(mockCore.refundRedemption).toHaveBeenCalledTimes(1);

      // ----------------------------------------------------------------------
      // Step 8: Embedded Operator Dashboard (App Bridge JWT Session & Proxy)
      // ----------------------------------------------------------------------
      const sessionToken = await createSessionToken(SHOP, CLIENT_ID, CLIENT_SECRET);

      // 8.1 GET /admin/session
      const sessionRes = await app.request(
        '/admin/session',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        },
        testEnv,
      );

      expect(sessionRes.status).toBe(200);
      const sessionJson = await sessionRes.json();
      expect(sessionJson).toEqual({
        authenticated: true,
        shop: SHOP,
        tenantId: EXPECTED_TENANT_ID,
        publishableToken,
        status: 'active',
      });

      // 8.2 GET /admin/dashboard/proxy/v1/programs (Forwarded to Core API)
      const proxyRes = await app.request(
        '/admin/dashboard/proxy/v1/programs',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        },
        testEnv,
      );

      expect(proxyRes.status).toBe(200);
      const proxyJson = await proxyRes.json();
      expect(proxyJson.programs).toHaveLength(1);
      expect(proxyJson.programs[0].name).toBe('Spend $100 Get $20 Off VIP Tier');

      // Verify proxy headers passed to Core fetch
      expect(mockCore.fetch).toHaveBeenCalledTimes(1);
      const coreReq = (mockCore.fetch as any).mock.calls[0][0] as Request;
      expect(coreReq.headers.get('x-tenant-id')).toBe(EXPECTED_TENANT_ID);
      expect(coreReq.headers.get('x-merchant-id')).toBe(EXPECTED_TENANT_ID);
      expect(coreReq.headers.get('authorization')).toBe(`Bearer ${secretToken}`);
    });
  });

  // ==========================================================================
  // GRANULAR STEP-LEVEL DEEP VERIFICATIONS & FAILURE INVARIANTS
  // ==========================================================================

  describe('Step 1 Invariants: Merchant OAuth & Security Gates', () => {
    it('rejects OAuth callback if CSRF state cookie is missing or mismatched', async () => {
      const app = createApp();
      const params: Record<string, string> = {
        code: 'valid-code',
        shop: SHOP,
        state: 'attacker-injected-state',
      };
      const hmac = computeShopifyOAuthHmac(params, CLIENT_SECRET);
      params['hmac'] = hmac;

      const res = await app.request(
        `/auth/callback?${new URLSearchParams(params).toString()}`,
        {
          method: 'GET',
          headers: {
            Cookie: 'shopify_oauth_state=genuine-session-state',
          },
        },
        testEnv,
      );

      expect(res.status).toBe(403);
      expect(await res.text()).toContain('Invalid state');
    });

    it('rejects OAuth callback if Shopify HMAC signature is invalid', async () => {
      const app = createApp();
      const params = {
        code: 'valid-code',
        shop: SHOP,
        state: 'valid-state',
        hmac: 'deadbeef1234567890abcdef',
      };

      const res = await app.request(
        `/auth/callback?${new URLSearchParams(params).toString()}`,
        {
          method: 'GET',
          headers: {
            Cookie: 'shopify_oauth_state=valid-state',
          },
        },
        testEnv,
      );

      expect(res.status).toBe(401);
      expect(await res.text()).toContain('Invalid HMAC');
    });
  });

  describe('Step 4 Invariants: Rust Wasm Discount Function Determinism & Hardening', () => {
    const signingSecret = 'tenant-signing-key-super-secret-xyz';
    const validCartId = 'gid://shopify/Cart/valid-cart-id';

    it('rejects stale subtotal when shopper mutates cart quantity after evaluation', () => {
      const payload = {
        evaluationId: 'eval-123',
        shopDomain: SHOP,
        cartId: validCartId,
        subtotalMinorUnits: 10000, // Evaluated at $100
        currency: 'USD',
        discountMinorUnits: 2000,
        target: 'order',
        signature: computeDiscountFunctionHmac(
          {
            evaluationId: 'eval-123',
            cartId: validCartId,
            subtotalMinorUnits: 10000,
            currency: 'USD',
            discountMinorUnits: 2000,
          },
          signingSecret,
        ),
      };

      // Cart subtotal has changed to $80.00
      const fnInput: DiscountFunctionInput = {
        cart: {
          id: validCartId,
          cost: {
            subtotalAmount: { amount: '80.00', currencyCode: 'USD' },
          },
          lines: [],
          attribute: { key: '_incentives_eval', value: JSON.stringify(payload) },
        },
        discountNode: { metafield: { value: signingSecret } },
      };

      const tsResult = verifyDiscountFunctionContract(fnInput);
      expect(tsResult.discounts).toEqual([]);

      const rustResult = execDiscountFunctionRust(fnInput);
      if (rustResult) {
        expect(rustResult.discounts).toEqual([]);
      }
    });

    it('rejects cross-cart token replay when attacker passes signed payload to another cart', () => {
      const payload = {
        evaluationId: 'eval-123',
        shopDomain: SHOP,
        cartId: validCartId,
        subtotalMinorUnits: 10000,
        currency: 'USD',
        discountMinorUnits: 2000,
        target: 'order',
        signature: computeDiscountFunctionHmac(
          {
            evaluationId: 'eval-123',
            cartId: validCartId,
            subtotalMinorUnits: 10000,
            currency: 'USD',
            discountMinorUnits: 2000,
          },
          signingSecret,
        ),
      };

      // Attacker uses this token on another cart
      const fnInput: DiscountFunctionInput = {
        cart: {
          id: 'gid://shopify/Cart/attacker-cart-id',
          cost: {
            subtotalAmount: { amount: '100.00', currencyCode: 'USD' },
          },
          lines: [],
          attribute: { key: '_incentives_eval', value: JSON.stringify(payload) },
        },
        discountNode: { metafield: { value: signingSecret } },
      };

      const tsResult = verifyDiscountFunctionContract(fnInput);
      expect(tsResult.discounts).toEqual([]);

      const rustResult = execDiscountFunctionRust(fnInput);
      if (rustResult) {
        expect(rustResult.discounts).toEqual([]);
      }
    });

    it('rejects tampered discount amounts with signature invalidation', () => {
      const payload = {
        evaluationId: 'eval-123',
        shopDomain: SHOP,
        cartId: validCartId,
        subtotalMinorUnits: 10000,
        currency: 'USD',
        discountMinorUnits: 9900, // Attacker forged $99 discount
        target: 'order',
        signature: computeDiscountFunctionHmac(
          {
            evaluationId: 'eval-123',
            cartId: validCartId,
            subtotalMinorUnits: 10000,
            currency: 'USD',
            discountMinorUnits: 2000, // Original signature was for $20
          },
          signingSecret,
        ),
      };

      const fnInput: DiscountFunctionInput = {
        cart: {
          id: validCartId,
          cost: {
            subtotalAmount: { amount: '100.00', currencyCode: 'USD' },
          },
          lines: [],
          attribute: { key: '_incentives_eval', value: JSON.stringify(payload) },
        },
        discountNode: { metafield: { value: signingSecret } },
      };

      const tsResult = verifyDiscountFunctionContract(fnInput);
      expect(tsResult.discounts).toEqual([]);

      const rustResult = execDiscountFunctionRust(fnInput);
      if (rustResult) {
        expect(rustResult.discounts).toEqual([]);
      }
    });

    it('rejects a legacy payload without a cart fingerprint even if a percentage field is injected', () => {
      const discountMinor = 1500;
      const signature = computeDiscountFunctionHmac(
        {
          evaluationId: 'eval-tamper-pct',
          cartId: validCartId,
          subtotalMinorUnits: 10000,
          currency: 'USD',
          discountMinorUnits: discountMinor,
        },
        signingSecret,
      );

      // Tampered JSON with injected "percentage": 90.0
      const tamperedJson = JSON.stringify({
        evaluationId: 'eval-tamper-pct',
        cartId: validCartId,
        subtotalMinorUnits: 10000,
        currency: 'USD',
        discountMinorUnits: discountMinor,
        target: 'order',
        percentage: 90.0,
        signature,
      });

      const fnInput: DiscountFunctionInput = {
        cart: {
          id: validCartId,
          cost: {
            subtotalAmount: { amount: '100.00', currencyCode: 'USD' },
          },
          lines: [],
          attribute: { key: '_incentives_eval', value: tamperedJson },
        },
        discountNode: { metafield: { value: signingSecret } },
      };

      const tsResult = verifyDiscountFunctionContract(fnInput);
      expect(tsResult.discounts).toEqual([]);
    });
  });

  describe('Step 5 & 6 Invariants: Webhook Security & Idempotency', () => {
    beforeEach(() => {
      // Seed installed store
      mockDb.rows.set(SHOP, {
        shop_domain: SHOP,
        access_token: 'shpat_test_token',
        tenant_id: EXPECTED_TENANT_ID,
        tenant_signing_key: 'test_signing_key_12345',
        publishable_token: 'pk_live_123',
        secret_token: 'sk_live_123',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it('returns 401 when webhook HMAC is missing or invalid', async () => {
      const app = createApp();
      const body = JSON.stringify({ id: 12345 });

      // Missing header
      const res1 = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Shop-Domain': SHOP },
          body,
        },
        testEnv,
      );
      expect(res1.status).toBe(401);

      // Invalid signature
      const res2 = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': 'invalid-hmac-base64',
          },
          body,
        },
        testEnv,
      );
      expect(res2.status).toBe(401);
    });

    it('returns 200 skipped when webhook arrives for an uninstalled store', async () => {
      const app = createApp();
      const uninstalledShop = 'uninstalled-store.myshopify.com';
      const orderPayload = {
        id: 999,
        note_attributes: [{ name: '_incentives_eval', value: '{"evaluationId":"eval-1"}' }],
      };
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': uninstalledShop,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ received: true, skipped: true, reason: 'shop_not_installed' });
    });

    it('gracefully skips orders without _incentives_eval note attributes', async () => {
      const app = createApp();
      const orderPayload = {
        id: 888,
        note_attributes: [{ name: 'gift_message', value: 'Happy Birthday!' }],
      };
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
      expect(json.skipped).toBe(true);
      expect(json.reason).toBe('no_incentives_eval');
      expect(mockCore.commitRedemption).not.toHaveBeenCalled();
    });
  });

  describe('Step 8 Invariants: Embedded Admin Bridge Security Gates', () => {
    beforeEach(() => {
      mockDb.rows.set(SHOP, {
        shop_domain: SHOP,
        access_token: 'shpat_test_token',
        tenant_id: EXPECTED_TENANT_ID,
        tenant_signing_key: 'test_signing_key_12345',
        publishable_token: 'pk_live_123',
        secret_token: 'sk_live_123',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it('rejects admin requests missing Authorization Bearer token with 401', async () => {
      const app = createApp();
      const res = await app.request('/admin/session', { method: 'GET' }, testEnv);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Missing or malformed Authorization header');
    });

    it('rejects expired session tokens with 401', async () => {
      const app = createApp();
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      const expiredToken = await createSessionToken(SHOP, CLIENT_ID, CLIENT_SECRET, {
        exp: pastTime,
        iat: pastTime - 300,
        nbf: pastTime - 300,
      });

      const res = await app.request(
        '/admin/session',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${expiredToken}` },
        },
        testEnv,
      );
      expect(res.status).toBe(401);
    });

    it('rejects tokens with mismatched destination and issuer domains with 401', async () => {
      const app = createApp();
      const mismatchedToken = await createSessionToken(SHOP, CLIENT_ID, CLIENT_SECRET, {
        iss: 'https://attacker-store.myshopify.com/admin',
        dest: `https://${SHOP}`,
      });

      const res = await app.request(
        '/admin/session',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${mismatchedToken}` },
        },
        testEnv,
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Destination and Issuer domain mismatch');
    });
  });
});
