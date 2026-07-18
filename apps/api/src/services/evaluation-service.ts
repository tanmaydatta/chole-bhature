import {
  CartLineItemSchema,
  CartSchema,
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  type Effect,
  type EvaluationRequest,
  type EvaluationResponse,
  type IncentiveDecision,
  type VariableDefinition,
} from '@incentives/contracts';
import { assembleFacts, resolveDecisionConflicts } from '@incentives/engine';
import { PromoModule } from '@incentives/promo';
import { z } from 'zod';

import type { Env } from '../env.js';
import { NotFoundError } from '../errors.js';
import type {
  EvaluationDecisionRecord,
  EvaluationFactsSnapshot,
  Repositories,
} from '../repositories/types.js';
import { BUILTIN_VARIABLE_DEFINITIONS } from './schema-service.js';

const DEFAULT_TTL_SECONDS = 300;
const SigningSecretSchema = z.string().min(16).max(4_096);
const TtlSchema = z.coerce.number().int().positive().max(86_400);
const encoder = new TextEncoder();

function valueSchema(definition: VariableDefinition): z.ZodType {
  switch (definition.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'enum':
      return z.enum(definition.enumValues as [string, ...string[]]);
    case 'date':
      return z.iso.date();
  }
}

function extensionSchema(
  definitions: readonly VariableDefinition[],
  source: 'context' | 'cart' | 'line_item',
) {
  const shape: Record<string, z.ZodType> = {};
  let required = false;
  for (const definition of definitions) {
    if (definition.source !== source) continue;
    const field = definition.key.slice(source.length + 1);
    shape[field] = definition.required
      ? valueSchema(definition)
      : valueSchema(definition).optional();
    required ||= definition.required;
  }
  return { required, schema: z.object(shape).strict() };
}

function validatePublishedRequest(
  request: EvaluationRequest,
  definitions: readonly VariableDefinition[],
): EvaluationRequest {
  const context = extensionSchema(definitions, 'context');
  const cart = extensionSchema(definitions, 'cart');
  const lineItem = extensionSchema(definitions, 'line_item');
  const lineItemSchema = CartLineItemSchema.extend({
    attributes: lineItem.required ? lineItem.schema : lineItem.schema.optional(),
  });
  const cartSchema = CartSchema.extend({
    attributes: cart.required ? cart.schema : cart.schema.optional(),
    items: z.array(lineItemSchema),
  });
  if (context.required && request.context === undefined) {
    z.object({ context: context.schema }).parse({ context: {} });
  }
  return EvaluationRequestSchema.extend({
    context: context.required ? context.schema : context.schema.optional(),
    cart: cartSchema,
  }).parse(request);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const record = value as Record<string, unknown>;
  const properties = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${properties.join(',')}}`;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/u.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(SigningSecretSchema.parse(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function decisionSnapshot(record: Pick<
  EvaluationDecisionRecord,
  | 'customerRef'
  | 'customerVersion'
  | 'schemaVersion'
  | 'request'
  | 'facts'
  | 'decisions'
>) {
  return {
    ...(record.customerRef === undefined ? {} : { customerRef: record.customerRef }),
    ...(record.customerVersion === undefined ? {} : { customerVersion: record.customerVersion }),
    schemaVersion: record.schemaVersion,
    request: record.request,
    facts: record.facts,
    decisions: record.decisions,
  };
}

function integrityPayload(record: Pick<
  EvaluationDecisionRecord,
  | 'merchantId'
  | 'evaluationId'
  | 'customerRef'
  | 'customerVersion'
  | 'schemaVersion'
  | 'request'
  | 'facts'
  | 'decisions'
  | 'expiresAt'
>) {
  return {
    merchantId: record.merchantId,
    evaluationId: record.evaluationId,
    snapshot: decisionSnapshot(record),
    expiresAt: record.expiresAt,
  };
}

export async function signDecisionSnapshot(
  record: Parameters<typeof integrityPayload>[0],
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(canonicalJson(integrityPayload(record))),
  );
  return bytesToHex(signature);
}

export async function verifyDecisionIntegrity(
  record: EvaluationDecisionRecord,
  secret: string,
): Promise<boolean> {
  const signature = hexToBytes(record.integrityHash);
  if (signature === null) return false;
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    signature,
    encoder.encode(canonicalJson(integrityPayload(record))),
  );
}

function formatPercent(basisPoints: number): string {
  const percent = basisPoints / 100;
  return Number.isInteger(percent) ? String(percent) : String(percent);
}

function qualifiedMessage(effects: readonly Effect[]): string {
  const effect = effects[0];
  if (effect === undefined) return 'This promotion was applied.';
  if (effect.type === 'free_shipping') return 'You received free shipping.';
  if (
    (effect.type === 'order_discount' || effect.type === 'line_item_discount')
    && effect.calculation === 'fixed'
  ) {
    return `You received ${effect.amount.currency} ${(effect.amount.minorUnits / 100).toFixed(2)} off.`;
  }
  if (
    (effect.type === 'order_discount' || effect.type === 'line_item_discount')
    && effect.calculation === 'percent'
  ) {
    return `You received ${formatPercent(effect.basisPoints)}% off.`;
  }
  return 'This promotion was applied.';
}

function stableDecision(decision: ReturnType<typeof resolveDecisionConflicts>[number]): IncentiveDecision {
  const {
    priority: _priority,
    stackable: _stackable,
    stackingGroup: _stackingGroup,
    ...canonical
  } = decision;

  switch (canonical.outcome) {
    case 'qualified':
      return { ...canonical, message: qualifiedMessage(canonical.effects) };
    case 'not_qualified':
      return {
        ...canonical,
        message: canonical.message ?? "This promotion isn't valid for your order.",
      };
    case 'invalid_code':
      return { ...canonical, message: 'This promotion code is invalid.' };
    case 'unavailable':
      return { ...canonical, message: 'This promotion is unavailable.' };
    case 'conflict':
      return {
        ...canonical,
        effects: [],
        message: 'This promotion cannot be combined with another offer.',
      };
    case 'exhausted':
      return { ...canonical, message: 'This promotion has been exhausted.' };
  }
}

function ttlSeconds(env: Env): number {
  return env.EVALUATION_TTL_SECONDS === undefined
    ? DEFAULT_TTL_SECONDS
    : TtlSchema.parse(env.EVALUATION_TTL_SECONDS);
}

function factInputs(request: EvaluationRequest) {
  return {
    cart: {
      currency: request.cart.currency,
      subtotal: request.cart.subtotal,
      ...(request.cart.attributes === undefined
        ? {}
        : { attributes: request.cart.attributes }),
    },
    lineItems: request.cart.items.map(item => ({
      productRef: item.productRef,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      ...(item.variantRef === undefined ? {} : { variantRef: item.variantRef }),
      ...(item.attributes === undefined ? {} : { attributes: item.attributes }),
    })),
  };
}

export function createEvaluationService(repositories: Repositories, env: Env) {
  return {
    async evaluate(merchantId: string, input: unknown): Promise<EvaluationResponse> {
      const fixedRequest = EvaluationRequestSchema.parse(input);
      const published = await repositories.schemas.getLatestVersion(merchantId, 'published')
        .catch((error: unknown) => {
          throw new Error('Published schema lookup failed', { cause: error });
        });
      if (published === null) {
        throw new NotFoundError('No schema has been published', 'SCHEMA_NOT_PUBLISHED');
      }
      const request = validatePublishedRequest(fixedRequest, published.definitions);

      try {
        const customer = request.customerRef === undefined
          ? null
          : await repositories.customers.get(merchantId, request.customerRef);
        if (request.customerRef !== undefined && customer === null) {
          throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
        }

        const programs = await repositories.programs.list(merchantId);
        const now = new Date();
        const evaluationId = crypto.randomUUID();
        const liveFacts = factInputs(request);
        const commonFacts = assembleFacts({
          ...(customer === null ? {} : { customer: customer.attributes }),
          ...(request.context === undefined ? {} : { context: request.context }),
          ...liveFacts,
          system: { today: now.toISOString().slice(0, 10) },
        });
        const facts: EvaluationFactsSnapshot = {
          ...commonFacts,
          programs: [],
        };
        const definitions = [
          ...BUILTIN_VARIABLE_DEFINITIONS,
          ...published.definitions,
        ];
        const moduleDecisions = [];

        for (const record of programs) {
          const system = {
            budget_remaining: record.budgetRemaining,
            redemptions_total: record.usageCount,
            customer_uses_count: 0,
            today: now.toISOString().slice(0, 10),
          };
          facts.programs.push({ programRef: record.externalRef, system });
          const programFacts = assembleFacts({
            ...(customer === null ? {} : { customer: customer.attributes }),
            ...(request.context === undefined ? {} : { context: request.context }),
            ...liveFacts,
            system,
          });
          moduleDecisions.push(...await PromoModule.evaluate({
            merchantId,
            evaluationId,
            now,
            request,
            facts: programFacts,
            definitions,
          }, record.program));
        }

        const decisions = resolveDecisionConflicts(moduleDecisions).map(stableDecision);
        const createdAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + ttlSeconds(env) * 1_000).toISOString();
        const unsigned = {
          evaluationId,
          merchantId,
          ...(request.customerRef === undefined ? {} : { customerRef: request.customerRef }),
          ...(customer === null ? {} : { customerVersion: customer.version }),
          schemaVersion: published.version,
          request,
          facts,
          decisions,
          expiresAt,
        };
        const record: EvaluationDecisionRecord = {
          ...unsigned,
          integrityHash: await signDecisionSnapshot(
            unsigned,
            SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET),
          ),
          createdAt,
        };
        await repositories.decisions.create(record);

        return EvaluationResponseSchema.parse({
          evaluationId,
          ...(record.customerRef === undefined ? {} : { customerRef: record.customerRef }),
          ...(record.customerVersion === undefined
            ? {}
            : { customerVersion: record.customerVersion }),
          schemaVersion: record.schemaVersion,
          expiresAt,
          decisions,
        });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new Error('Evaluation pipeline failed', { cause: error });
      }
    },
  };
}
