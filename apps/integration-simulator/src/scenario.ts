import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CustomerPatchRequestSchema, CustomerRecordSchema, EvaluationRequestSchema, EvaluationResponseSchema,
  PublishedSchemaResponseSchema, RedemptionRequestSchema, RedemptionResponseSchema,
  RuntimeCapabilitiesResponseSchema, type EvaluationResponse, type RedemptionResponse } from '@incentives/contracts';
import { PublicClient, SimulatorError, approvedOrigin, type Diagnostic } from './client.js';
import { createFakeConnector, mapPricing, type NativeCart, type NativeCustomer, type NativePricing } from './fake-connector.js';

export interface FakeCapture { order_id: string; currency: string; merchandise_total_pence: number }
export interface ScenarioConfig {
  origin: string; environment: 'local' | 'staging'; secretKey: string; schemaVersion: number;
  fixture: { programRef: string; programRevision: number; rewardRuleRef: string }[];
  customer: NativeCustomer; updatedProfile: Record<string, unknown>; cart: NativeCart;
  context: Record<string, unknown>; codes: string[]; order: { order_id: string; retry_key: string };
  capture?: (capture: FakeCapture) => void | Promise<void>;
}
export interface ScenarioResult {
  customerVersions: [number, number]; preflightEvaluation: EvaluationResponse; evaluation: EvaluationResponse; staleEvaluation: EvaluationResponse;
  redemption: RedemptionResponse; retry: RedemptionResponse; repricedEvaluation: EvaluationResponse;
  applied: NativePricing; repriced: NativePricing; captures: FakeCapture[]; trace: Diagnostic[];
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function reference(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'; }
export function validateConfig(value: unknown): ScenarioConfig {
  try {
    if (!exactKeys(value, ['origin', 'environment', 'secretKey', 'schemaVersion', 'fixture', 'customer', 'updatedProfile', 'cart', 'context', 'codes', 'order'], ['capture'])) throw Error('shape');
    if (value.environment !== 'local' && value.environment !== 'staging') throw Error('environment');
    approvedOrigin(value.origin);
    if (typeof value.secretKey !== 'string' || !/^sk_[A-Za-z0-9_-]{32,256}$/u.test(value.secretKey)
      || !Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) throw Error('configuration');
    if (!Array.isArray(value.fixture) || value.fixture.length === 0 || value.fixture.some(item => (
      !exactKeys(item, ['programRef', 'programRevision', 'rewardRuleRef']) || !reference(item.programRef)
      || !reference(item.rewardRuleRef) || !Number.isSafeInteger(item.programRevision) || Number(item.programRevision) < 1
    ))) throw Error('fixture');
    if (!exactKeys(value.customer, ['shopper_id', 'profile']) || !reference(value.customer.shopper_id)
      || !object(value.customer.profile) || !object(value.updatedProfile) || !object(value.context)) throw Error('customer');
    if (!exactKeys(value.cart, ['currency', 'total_pence', 'items']) || !Array.isArray(value.cart.items)
      || value.cart.items.length === 0 || value.cart.items.some(item => !exactKeys(item, ['line_id', 'sku', 'count', 'unit_pence']))) throw Error('cart');
    if (!exactKeys(value.order, ['order_id', 'retry_key']) || !reference(value.order.order_id) || !reference(value.order.retry_key)
      || (value.capture !== undefined && typeof value.capture !== 'function')) throw Error('order');
    const config = value as unknown as ScenarioConfig;
    const connector = createFakeConnector(randomUUID());
    connector.normalizeCustomer(config.customer); connector.normalizeCustomer({ ...config.customer, profile: config.updatedProfile });
    EvaluationRequestSchema.parse({ customerRef: config.customer.shopper_id, cart: connector.normalizeCart(config.cart), codes: config.codes, context: config.context });
    return config;
  } catch { throw new SimulatorError('configuration', 'INVALID_CONFIG'); }
}
function validateEvaluation(evaluation: EvaluationResponse, config: ScenarioConfig, customerVersion: number) {
  if (evaluation.schemaVersion !== config.schemaVersion || evaluation.customerRef !== config.customer.shopper_id
    || evaluation.customerVersion !== customerVersion || evaluation.priceBreakdown.currency !== config.cart.currency
    || evaluation.priceBreakdown.originalMerchandiseSubtotal !== config.cart.total_pence || Date.parse(evaluation.expiresAt) <= Date.now()) throw new SimulatorError('evaluate', 'FIXTURE_MISMATCH');
  for (const allocation of evaluation.priceBreakdown.discountAllocations) {
    const decision = evaluation.decisions.find(item => item.programRef === allocation.programRef && item.programRevision === allocation.programRevision && item.rewardRuleRef === allocation.rewardRuleRef);
    for (const line of allocation.lineAllocations ?? []) {
      const cartLine = config.cart.items.find(item => item.line_id === line.lineRef);
      if (!cartLine || !decision?.effects.some(effect => effect.type === 'line_item_discount' && effect.productRef === cartLine.sku)) throw new SimulatorError('evaluate', 'FIXTURE_MISMATCH');
    }
  }
}
function selectedFixture(evaluation: EvaluationResponse, config: ScenarioConfig) {
  const actual = evaluation.decisions.map(decision => ({ programRef: decision.programRef, programRevision: decision.programRevision, rewardRuleRef: decision.rewardRuleRef }));
  if (!isDeepStrictEqual(actual, config.fixture) || evaluation.decisions.some(decision => decision.programType !== 'promo' || decision.outcome !== 'qualified' || !decision.commitRequired)) throw new SimulatorError('evaluate', 'FIXTURE_MISMATCH');
  for (const allocation of evaluation.priceBreakdown.discountAllocations) {
    if (!actual.some(decision => decision.programRef === allocation.programRef && decision.programRevision === allocation.programRevision && decision.rewardRuleRef === allocation.rewardRuleRef)) throw new SimulatorError('evaluate', 'FIXTURE_MISMATCH');
  }
}
export async function runScenario(input: unknown): Promise<ScenarioResult> {
  const config = validateConfig(input); const trace: Diagnostic[] = [];
  const client = new PublicClient(config.origin, config.secretKey, trace);
  const capabilities = await client.request('capabilities', 'GET', '/v1/runtime-capabilities', RuntimeCapabilitiesResponseSchema);
  if (!capabilities.simulatorAllowed || capabilities.environment !== config.environment) throw new SimulatorError('capabilities', 'ENVIRONMENT_REFUSED');
  const published = await client.request('schema', 'GET', '/v1/schema/published', PublishedSchemaResponseSchema);
  if (published.version !== config.schemaVersion) throw new SimulatorError('schema', 'FIXTURE_MISMATCH');
  const connector = createFakeConnector(randomUUID()); const normalized = connector.normalizeCustomer(config.customer);
  const customerPath = `/v1/customers/${encodeURIComponent(normalized.externalRef)}`;
  // Configuration and a fixture customer are operator-preseeded; proof is a normal non-spending evaluation.
  const prior = await client.request('customer-read', 'GET', customerPath, CustomerRecordSchema);
  if (prior.externalRef !== normalized.externalRef) throw new SimulatorError('customer-read', 'FIXTURE_MISMATCH');
  const evaluationRequest = EvaluationRequestSchema.parse({ customerRef: normalized.externalRef, cart: connector.normalizeCart(config.cart), context: config.context, codes: config.codes });
  const preflightEvaluation = await client.request('fixture-evaluate', 'POST', '/v1/evaluate', EvaluationResponseSchema, evaluationRequest);
  validateEvaluation(preflightEvaluation, config, prior.version); selectedFixture(preflightEvaluation, config);
  for (const decision of preflightEvaluation.decisions) connector.mapDecision(decision);
  const first = await client.request('customer-upsert', 'PATCH', customerPath, CustomerRecordSchema,
    CustomerPatchRequestSchema.parse({ attributes: normalized.attributes, expectedVersion: prior.version }));
  if (first.externalRef !== normalized.externalRef || first.version !== prior.version + 1 || !isDeepStrictEqual(first.attributes, normalized.attributes)) throw new SimulatorError('customer-upsert', 'INVALID_RESPONSE');
  const second = await client.request('customer-update', 'PATCH', customerPath, CustomerRecordSchema,
    CustomerPatchRequestSchema.parse({ attributes: config.updatedProfile, expectedVersion: first.version }));
  if (second.externalRef !== normalized.externalRef || second.version !== first.version + 1 || !isDeepStrictEqual(second.attributes, config.updatedProfile)) throw new SimulatorError('customer-update', 'INVALID_RESPONSE');
  const evaluate = async (phase: 'evaluate' | 'stale-evaluate' | 'reprice') => {
    const evaluation = await client.request(phase, 'POST', '/v1/evaluate', EvaluationResponseSchema, evaluationRequest);
    validateEvaluation(evaluation, config, second.version); return evaluation;
  };
  const evaluation = await evaluate('evaluate'); selectedFixture(evaluation, config);
  for (const decision of evaluation.decisions) connector.mapDecision(decision);
  const applied = mapPricing(evaluation.priceBreakdown);
  const staleEvaluation = await evaluate('stale-evaluate'); selectedFixture(staleEvaluation, config);
  if (staleEvaluation.evaluationId === evaluation.evaluationId || !isDeepStrictEqual(staleEvaluation.priceBreakdown, evaluation.priceBreakdown)) throw new SimulatorError('stale-evaluate', 'FIXTURE_MISMATCH');
  const order = connector.normalizeOrder({ ...config.cart, ...config.order, shopper_id: normalized.externalRef, total_pence: applied.total_pence });
  const request = RedemptionRequestSchema.parse({ evaluationId: evaluation.evaluationId, externalOrderRef: order.externalRef, idempotencyKey: order.idempotencyKey });
  const redemption = await client.request('redeem', 'POST', '/v1/redemptions', RedemptionResponseSchema, request);
  const expectedEntries = evaluation.decisions.map(decision => ({ programRef: decision.programRef, programRevision: decision.programRevision,
    ...(decision.rewardRuleRef === undefined ? {} : { rewardRuleRef: decision.rewardRuleRef }), effects: decision.effects }));
  if (redemption.evaluationId !== request.evaluationId || redemption.externalOrderRef !== request.externalOrderRef || redemption.idempotencyKey !== request.idempotencyKey
    || !isDeepStrictEqual(redemption.entries, expectedEntries) || !isDeepStrictEqual(redemption.priceBreakdown, evaluation.priceBreakdown)) throw new SimulatorError('redeem', 'RECEIPT_MISMATCH');
  const retry = await client.request('retry', 'POST', '/v1/redemptions', RedemptionResponseSchema, request);
  if (!isDeepStrictEqual(retry, redemption)) throw new SimulatorError('retry', 'RECEIPT_MISMATCH');
  const capture: FakeCapture = { order_id: order.externalRef, currency: order.currency, merchandise_total_pence: order.total };
  try { await config.capture?.(capture); } catch { throw new SimulatorError('capture', 'CAPTURE_FAILED'); }
  trace.push({ phase: 'capture' });
  const staleRequest = RedemptionRequestSchema.parse({ evaluationId: staleEvaluation.evaluationId, externalOrderRef: `${order.externalRef}:stale`, idempotencyKey: `${order.idempotencyKey}:stale` });
  try {
    await client.request('stale-redemption', 'POST', '/v1/redemptions', RedemptionResponseSchema, staleRequest);
    throw new SimulatorError('stale-redemption', 'EXHAUSTION_NOT_OBSERVED');
  } catch (error) {
    if (!(error instanceof SimulatorError && error.status === 409 && ['EXHAUSTED', 'USAGE_CAP_EXHAUSTED', 'BUDGET_EXHAUSTED', 'PER_CUSTOMER_CAP_EXHAUSTED'].includes(error.code))) throw error;
    trace.push({ phase: 'exhausted', status: 409, code: error.code });
  }
  const repricedEvaluation = await evaluate('reprice');
  for (const decision of repricedEvaluation.decisions) connector.mapDecision(decision);
  const repriced = mapPricing(repricedEvaluation.priceBreakdown);
  if (isDeepStrictEqual(repriced, applied)) throw new SimulatorError('reprice', 'REPRICE_NOT_OBSERVED');
  // Repricing is display-only: no stale or automatically repriced payment capture.
  return { customerVersions: [first.version, second.version], preflightEvaluation, evaluation, staleEvaluation, redemption, retry, repricedEvaluation, applied, repriced, captures: [capture], trace };
}
