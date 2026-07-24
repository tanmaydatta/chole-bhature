import {
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  normalizeDistinctPromoCodes,
  type Cart,
  type CodeEvaluationResult,
  type Effect,
  type EvaluationRequest,
  type EvaluationResponse,
  type IncentiveDecision,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import {
  assembleFacts,
  compareProgramRank,
  selectCodedDecisionCombination,
} from '@incentives/engine';
import { PromoModule } from '@incentives/promo';
import { z } from 'zod';

import type { Env } from '../env.js';
import { NotFoundError } from '../errors.js';
import { canonicalJson } from '../json.js';
import type {
  EvaluationDecisionRecord,
  EvaluationFactsSnapshot,
  EvaluationMode,
  ProgramRecord,
  RedemptionIntegrityVerifiers,
  Repositories,
} from '../repositories/types.js';
import { BUILTIN_VARIABLE_DEFINITIONS } from './schema-service.js';
import { validateCustomerAttributes } from './customer-service.js';
import { effectiveProgram, effectiveProgramStatus } from './program-runtime.js';
import { verifyRedemptionReceipt } from './redemption-receipt.js';

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

  function validateExtension(
    extension: ReturnType<typeof extensionSchema>,
    input: Record<string, unknown> | undefined,
    prefix: PropertyKey[],
  ): void {
    if (input === undefined && !extension.required) return;
    try {
      extension.schema.parse(input ?? {});
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      for (const issue of error.issues) {
        (issue as { path: PropertyKey[] }).path = [...prefix, ...issue.path];
      }
      throw error;
    }
  }

  validateExtension(context, request.context, ['context']);
  validateExtension(cart, request.cart.attributes, ['cart']);
  request.cart.items.forEach((item, index) => {
    validateExtension(lineItem, item.attributes, [`line_item[${index}]`]);
  });
  return request;
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
  | 'mode'
  | 'submittedCodes'
  | 'codeResults'
  | 'requestDigest'
  | 'correlationId'
  | 'customerRef'
  | 'customerVersion'
  | 'schemaVersion'
  | 'request'
  | 'facts'
  | 'decisions'
>) {
  return {
    mode: record.mode,
    submittedCodes: record.submittedCodes,
    codeResults: record.codeResults,
    requestDigest: record.requestDigest,
    correlationId: record.correlationId,
    ...(record.customerRef === undefined ? {} : { customerRef: record.customerRef }),
    ...(record.customerVersion === undefined ? {} : { customerVersion: record.customerVersion }),
    schemaVersion: record.schemaVersion,
    request: record.request,
    facts: record.facts,
    decisions: record.decisions,
  };
}

function legacyDecisionSnapshot(record: Pick<
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
  | 'mode'
  | 'submittedCodes'
  | 'codeResults'
  | 'requestDigest'
  | 'correlationId'
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

function legacyIntegrityPayload(record: EvaluationDecisionRecord) {
  return {
    merchantId: record.merchantId,
    evaluationId: record.evaluationId,
    snapshot: legacyDecisionSnapshot(record),
    expiresAt: record.expiresAt,
  };
}

function isMigratedLegacySnapshot(record: EvaluationDecisionRecord): boolean {
  return (
    record.requestDigest === `legacy:${record.evaluationId}`
    && record.correlationId === `migration:${record.evaluationId}`
    && record.mode === 'automatic'
    && record.submittedCodes.length === 0
    && record.codeResults.length === 0
  );
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
  const payload = isMigratedLegacySnapshot(record)
    ? legacyIntegrityPayload(record)
    : integrityPayload(record);
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    signature,
    encoder.encode(canonicalJson(payload)),
  );
}

function formatPercent(basisPoints: number): string {
  return String(basisPoints / 100);
}

export function formatMinorUnits(currency: string, minorUnits: number): string {
  const currencyOptions = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).resolvedOptions();
  const fractionDigits = currencyOptions.maximumFractionDigits ?? 2;
  const signedAmount = BigInt(minorUnits);
  const negative = signedAmount < 0n;
  const absoluteAmount = negative ? -signedAmount : signedAmount;
  const divisor = 10n ** BigInt(fractionDigits);
  const integerPart = absoluteAmount / divisor;
  const fractionPart = absoluteAmount % divisor;
  const formattedInteger = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(integerPart);
  const formattedFraction = fractionDigits === 0
    ? ''
    : `.${fractionPart.toString().padStart(fractionDigits, '0')}`;
  return `${currency} ${negative ? '-' : ''}${formattedInteger}${formattedFraction}`;
}

function qualifiedMessage(effects: readonly Effect[]): string {
  const effect = effects[0];
  if (effect === undefined) return 'This promotion was applied.';
  if (effect.type === 'free_shipping') return 'You received free shipping.';
  if (
    (effect.type === 'order_discount' || effect.type === 'line_item_discount')
    && effect.calculation === 'fixed'
  ) {
    return `You received ${formatMinorUnits(
      effect.amount.currency,
      effect.amount.minorUnits,
    )} off.`;
  }
  if (
    (effect.type === 'order_discount' || effect.type === 'line_item_discount')
    && effect.calculation === 'percent'
  ) {
    return `You received ${formatPercent(effect.basisPoints)}% off.`;
  }
  return 'This promotion was applied.';
}

function stableDecision(decision: PromoDecision): IncentiveDecision {
  const {
    priority: _priority,
    stackable: _stackable,
    ...canonical
  } = decision;

  switch (canonical.outcome) {
    case 'qualified':
      return { ...canonical, message: qualifiedMessage(canonical.effects) };
    case 'not_qualified':
      return {
        ...canonical,
        message: canonical.reasonCodes.includes('NO_REWARD_RULE_MATCHED')
          ? 'No reward rule matched.'
          : canonical.message ?? "This promotion isn't valid for your order.",
      };
    case 'invalid_code':
      return { ...canonical, message: 'This promotion code is invalid.' };
    case 'unavailable':
      return {
        ...canonical,
        message: canonical.reasonCodes.includes('CURRENCY_MISMATCH')
          ? 'This promotion is unavailable for this currency.'
          : 'This promotion is unavailable.',
      };
    case 'conflict':
      return {
        ...canonical,
        effects: [],
        message: 'This promotion cannot be combined with another offer.',
      };
    case 'exhausted':
      return { ...canonical, message: 'This promotion has been exhausted.' };
  }
  throw new TypeError(`Unsupported decision outcome: ${String(canonical.outcome)}`);
}

function safeMinorUnits(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Projected discount exceeds the supported minor-unit range');
  }
  return Number(value);
}

function percentOf(value: bigint, basisPoints: number): bigint {
  return (value * BigInt(basisPoints)) / 10_000n;
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function projectedDiscountMinorUnits(
  effects: readonly Effect[],
  cart: Cart,
): number {
  let projected = 0n;
  const subtotal = BigInt(cart.subtotal);
  for (const effect of effects) {
    if (effect.type === 'free_shipping') continue;
    if (effect.type === 'order_discount') {
      projected += effect.calculation === 'fixed'
        ? minimum(BigInt(effect.amount.minorUnits), subtotal)
        : percentOf(subtotal, effect.basisPoints);
      continue;
    }
    if (effect.type === 'line_item_discount') {
      for (const item of cart.items) {
        if (item.productRef !== effect.productRef) continue;
        const quantity = BigInt(item.quantity);
        const extendedLineValue = BigInt(item.unitPrice) * quantity;
        const lineDiscount = effect.calculation === 'fixed'
          ? BigInt(effect.amount.minorUnits) * quantity
          : percentOf(extendedLineValue, effect.basisPoints);
        projected += minimum(lineDiscount, extendedLineValue);
      }
      continue;
    }
    throw new TypeError(`Unsupported projected discount effect: ${effect.type}`);
  }
  return safeMinorUnits(minimum(projected, subtotal));
}

type PromoDecision = Awaited<ReturnType<typeof PromoModule.evaluate>>[number] & {
  programType: 'promo';
};

function baseProgramDecision(program: PromoProgram, revision = 1): Pick<
  PromoDecision,
  | 'programRef'
  | 'programRevision'
  | 'programType'
  | 'priority'
  | 'stackable'
> {
  return {
    programRef: program.id,
    programRevision: revision,
    programType: 'promo',
    priority: program.priority,
    stackable: program.stackable,
  };
}

function currencyMismatchDecision(decision: PromoDecision): PromoDecision {
  return {
    ...decision,
    outcome: 'unavailable',
    effects: [],
    reasonCodes: ['CURRENCY_MISMATCH'],
    commitRequired: false,
    eligible: false,
  };
}

function exhaustedDecision(
  decision: PromoDecision,
  reasonCodes: string[],
): PromoDecision {
  return {
    ...decision,
    outcome: 'exhausted',
    effects: [],
    reasonCodes,
    commitRequired: false,
    eligible: false,
  };
}

function customerRequiredDecision(program: PromoProgram, revision: number): PromoDecision {
  return {
    ...baseProgramDecision(program, revision),
    outcome: 'not_qualified',
    effects: [],
    reasonCodes: ['CUSTOMER_REQUIRED'],
    commitRequired: false,
    eligible: false,
  };
}

function selectedCurrencyMismatch(
  program: PromoProgram,
  decision: PromoDecision,
  cartCurrency: string,
): boolean {
  const effect = decision.effects[0];
  return (
    program.budget !== undefined
    && program.budget.currency !== cartCurrency
  ) || (
    effect !== undefined
    && 'amount' in effect
    && effect.amount.currency !== cartCurrency
  );
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

function modeForCodes(
  codes: ReturnType<typeof normalizeDistinctPromoCodes>,
): EvaluationMode {
  return codes.length === 0 ? 'automatic' : 'coded';
}

async function evaluationRequestDigest(
  request: EvaluationRequest,
  mode: EvaluationMode,
  codes: ReturnType<typeof normalizeDistinctPromoCodes>,
): Promise<string> {
  const { codes: _rawCodes, ...requestWithoutCodes } = request;
  const normalizedRequest = mode === 'automatic'
    ? requestWithoutCodes
    : {
      ...requestWithoutCodes,
      codes: codes.map(code => code.normalized),
    };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonicalJson({ mode, request: normalizedRequest })),
  );
  return bytesToHex(digest);
}

async function automaticCandidates(
  repositories: Repositories,
  merchantId: string,
  now: Date,
): Promise<ProgramRecord[]> {
  return (await repositories.programs.listActive(merchantId))
    .filter(record => (
      record.program.autoApply
      && effectiveProgramStatus(record.program, now) === 'active'
    ))
    .sort((left, right) => compareProgramRank(
      { priority: left.program.priority, programRef: left.externalRef },
      { priority: right.program.priority, programRef: right.externalRef },
    ));
}

type EvaluationCustomer = Awaited<ReturnType<Repositories['customers']['get']>>;

interface ReservationPreparationInput {
  merchantId: string;
  evaluationId: string;
  correlationId: string;
  decision: IncentiveDecision;
}

interface ReservationCleanupContext {
  merchantId: string;
  evaluationId: string;
  correlationId: string;
  programRef: string;
}

interface EvaluationReservationHooks {
  prepare(input: ReservationPreparationInput): Promise<unknown | undefined>;
  cancel(handle: unknown): Promise<void>;
  onCleanupFailure?(context: ReservationCleanupContext, error: unknown): void;
}

interface EvaluationServiceOptions {
  reservations?: EvaluationReservationHooks;
}

interface PreparedReservation {
  handle: unknown;
  programRef: string;
}

const defaultReservationHooks: EvaluationReservationHooks = {
  async prepare() {
    return undefined;
  },
  async cancel() {},
};

interface SingleProgramEvaluationContext {
  repositories: Repositories;
  merchantId: string;
  evaluationId: string;
  correlationId: string;
  now: Date;
  request: EvaluationRequest;
  customer: EvaluationCustomer;
  liveFacts: ReturnType<typeof factInputs>;
  definitions: VariableDefinition[];
  facts: EvaluationFactsSnapshot;
  verifyHistoricalIntegrity: RedemptionIntegrityVerifiers;
  reservations: EvaluationReservationHooks;
  preparedReservations: PreparedReservation[];
}

interface EvaluatedProgram {
  decision: PromoDecision;
}

async function evaluateSingleProgram(
  record: ProgramRecord,
  context: SingleProgramEvaluationContext,
): Promise<EvaluatedProgram> {
  const {
    repositories,
    merchantId,
    evaluationId,
    correlationId,
    now,
    request,
    customer,
    liveFacts,
    definitions,
    facts,
    verifyHistoricalIntegrity,
    reservations,
    preparedReservations,
  } = context;
  const runtimeProgram = effectiveProgram(record.program, now);
  const customerUsesCount = customer === null
    ? 0
    : await repositories.redemptions.countCommittedForCustomerProgram(
      merchantId,
      customer.externalRef,
      record.externalRef,
      verifyHistoricalIntegrity,
    );
  const system = {
    ...(record.budgetRemaining === undefined
      ? {}
      : { budget_remaining: record.budgetRemaining }),
    redemptions_total: record.usageCount,
    customer_uses_count: customerUsesCount,
    today: now.toISOString().slice(0, 10),
  };
  facts.programs.push({
    programRef: record.externalRef,
    system,
    config: runtimeProgram,
  });
  const programFacts = assembleFacts({
    ...(customer === null ? {} : { customer: customer.attributes }),
    ...(request.context === undefined ? {} : { context: request.context }),
    ...liveFacts,
    system,
  });
  const moduleDecisions = await PromoModule.evaluate({
    merchantId,
    evaluationId,
    now,
    request,
    facts: programFacts,
    definitions,
  }, runtimeProgram);
  if (moduleDecisions.length !== 1 || moduleDecisions[0] === undefined) {
    throw new Error('Promo evaluation must return exactly one decision');
  }
  const [moduleDecision] = moduleDecisions;
  if (moduleDecision.programType !== 'promo') {
    throw new Error('Promo evaluation returned a non-Promo decision');
  }

  let decision: PromoDecision = {
    ...moduleDecision,
    programType: 'promo',
    programRevision: record.revision,
  };
  if (
    decision.outcome === 'qualified'
    && selectedCurrencyMismatch(runtimeProgram, decision, request.cart.currency)
  ) {
    decision = currencyMismatchDecision(decision);
  }
  if (
    decision.outcome === 'qualified'
    && customer === null
    && runtimeProgram.perCustomerCap !== undefined
  ) {
    decision = customerRequiredDecision(runtimeProgram, record.revision);
  }
  if (decision.outcome !== 'qualified') return { decision };

  const projectedCost = projectedDiscountMinorUnits(decision.effects, request.cart);
  const exhaustionReasons = [
    ...(runtimeProgram.usageCap !== undefined
      && record.usageCount >= runtimeProgram.usageCap
      ? ['USAGE_CAP_EXHAUSTED']
      : []),
    ...(runtimeProgram.perCustomerCap !== undefined
      && customerUsesCount >= runtimeProgram.perCustomerCap
      ? ['PER_CUSTOMER_CAP_EXHAUSTED']
      : []),
    ...(record.budgetRemaining !== undefined
      && record.budgetRemaining < projectedCost
      ? ['BUDGET_EXHAUSTED']
      : []),
  ];
  if (exhaustionReasons.length !== 0) {
    return { decision: exhaustedDecision(decision, exhaustionReasons) };
  }
  const reservation = await reservations.prepare({
    merchantId,
    evaluationId,
    correlationId,
    decision: stableDecision(decision),
  });
  if (reservation !== undefined) {
    preparedReservations.push({
      handle: reservation,
      programRef: decision.programRef,
    });
  }
  return { decision };
}

function codeResult(
  code: ReturnType<typeof normalizeDistinctPromoCodes>[number],
  decision: PromoDecision,
  rejectedProgramRefs: ReadonlySet<string>,
): CodeEvaluationResult {
  if (decision.outcome === 'qualified') {
    const rejected = rejectedProgramRefs.has(decision.programRef);
    return {
      code: code.display,
      normalizedCode: code.normalized,
      outcome: rejected ? 'combination_rejected' : 'selected',
      programRef: decision.programRef,
      reasonCodes: rejected ? ['CODE_COMBINATION_NOT_ALLOWED'] : [],
    };
  }
  if (decision.outcome === 'conflict') {
    throw new Error('Resolved coded evaluations cannot produce conflict decisions');
  }
  return {
    code: code.display,
    normalizedCode: code.normalized,
    outcome: decision.outcome,
    programRef: decision.programRef,
    reasonCodes: decision.reasonCodes,
  };
}

function boundedCleanupValue(value: string): string {
  return value.slice(0, 200);
}

async function cleanupPreparedReservations(
  preparedReservations: PreparedReservation[],
  hooks: EvaluationReservationHooks,
  context: Omit<ReservationCleanupContext, 'programRef'>,
): Promise<void> {
  const reservations = preparedReservations.splice(0);
  for (const reservation of reservations) {
    try {
      await hooks.cancel(reservation.handle);
    } catch (error) {
      const failureContext = {
        merchantId: boundedCleanupValue(context.merchantId),
        evaluationId: boundedCleanupValue(context.evaluationId),
        correlationId: boundedCleanupValue(context.correlationId),
        programRef: boundedCleanupValue(reservation.programRef),
      };
      try {
        if (hooks.onCleanupFailure === undefined) {
          console.error('Evaluation reservation cleanup failed', {
            ...failureContext,
            failure: 'reservation_cancellation_failed',
          });
        } else {
          hooks.onCleanupFailure(failureContext, error);
        }
      } catch {
        console.error('Evaluation reservation cleanup failure could not be reported', failureContext);
      }
    }
  }
}

export function createEvaluationService(
  repositories: Repositories,
  env: Env,
  options: EvaluationServiceOptions = {},
) {
  const reservations = options.reservations ?? defaultReservationHooks;
  return {
    async evaluate(
      merchantId: string,
      input: unknown,
      correlationId: string,
    ): Promise<EvaluationResponse> {
      const fixedRequest = EvaluationRequestSchema.parse(input);
      const published = await repositories.schemas.getLatestVersion(merchantId, 'published')
        .catch((error: unknown) => {
          throw new Error('Published schema lookup failed', { cause: error });
        });
      if (published === null) {
        throw new NotFoundError('No schema has been published', 'SCHEMA_NOT_PUBLISHED');
      }
      const request = validatePublishedRequest(fixedRequest, published.definitions);
      const preparedReservations: PreparedReservation[] = [];
      let cleanupContext: Omit<ReservationCleanupContext, 'programRef'> | undefined;

      try {
        const customer = request.customerRef === undefined
          ? null
          : await repositories.customers.get(merchantId, request.customerRef);
        if (request.customerRef !== undefined && customer === null) {
          throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
        }
        if (customer !== null) {
          validateCustomerAttributes(customer.attributes, published.definitions);
        }
        const signingSecret = SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET);
        const verifyHistoricalIntegrity: RedemptionIntegrityVerifiers = {
          verifyDecision: (snapshot: EvaluationDecisionRecord) => (
            verifyDecisionIntegrity(snapshot, signingSecret)
          ),
          verifyReceipt: receipt => (
            verifyRedemptionReceipt(receipt, signingSecret)
          ),
        };

        const now = new Date();
        const evaluationId = crypto.randomUUID();
        cleanupContext = { merchantId, evaluationId, correlationId };
        const normalizedCodes = normalizeDistinctPromoCodes(request.codes ?? []);
        const mode = modeForCodes(normalizedCodes);
        const submittedCodes = normalizedCodes.map(code => code.display);
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
        const singleProgramContext: SingleProgramEvaluationContext = {
          repositories,
          merchantId,
          evaluationId,
          correlationId,
          now,
          request,
          customer,
          liveFacts,
          definitions,
          facts,
          verifyHistoricalIntegrity,
          reservations,
          preparedReservations,
        };
        let decisions: IncentiveDecision[];
        let codeResults: CodeEvaluationResult[];
        if (mode === 'automatic') {
          decisions = [];
          codeResults = [];
          for (const candidate of await automaticCandidates(repositories, merchantId, now)) {
            const evaluated = await evaluateSingleProgram(candidate, singleProgramContext);
            if (evaluated.decision.outcome !== 'qualified') continue;
            decisions = [stableDecision(evaluated.decision)];
            break;
          }
        } else {
          const codedEvaluations: Array<{
            code: ReturnType<typeof normalizeDistinctPromoCodes>[number];
            decision?: PromoDecision;
          }> = [];
          for (const code of normalizedCodes) {
            const record = await repositories.programs.getPublishedByNormalizedCode(
              merchantId,
              code.normalized,
            );
            const evaluated = record === null
              ? undefined
              : await evaluateSingleProgram(record, singleProgramContext);
            codedEvaluations.push({
              code,
              ...(evaluated === undefined
                ? {}
                : evaluated),
            });
          }
          const resolvedDecisions = codedEvaluations.flatMap(entry => (
            entry.decision === undefined ? [] : [entry.decision]
          ));
          const selected = selectCodedDecisionCombination(resolvedDecisions);
          const rejectedProgramRefs = new Set(selected.rejectedProgramRefs);
          if (rejectedProgramRefs.size !== 0) {
            await cleanupPreparedReservations(
              preparedReservations,
              reservations,
              cleanupContext,
            );
          }
          decisions = selected.decisions.map(stableDecision);
          codeResults = codedEvaluations.map(entry => (
            entry.decision === undefined
              ? {
                code: entry.code.display,
                normalizedCode: entry.code.normalized,
                outcome: 'invalid_code',
                reasonCodes: ['INVALID_PROMO_CODE'],
              }
              : codeResult(entry.code, entry.decision, rejectedProgramRefs)
          ));
        }
        const createdAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + ttlSeconds(env) * 1_000).toISOString();
        const unsigned = {
          evaluationId,
          merchantId,
          mode,
          submittedCodes,
          codeResults,
          requestDigest: await evaluationRequestDigest(request, mode, normalizedCodes),
          correlationId,
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
            signingSecret,
          ),
          createdAt,
        };
        const response = EvaluationResponseSchema.parse({
          evaluationId,
          ...(record.customerRef === undefined ? {} : { customerRef: record.customerRef }),
          ...(record.customerVersion === undefined
            ? {}
            : { customerVersion: record.customerVersion }),
          schemaVersion: record.schemaVersion,
          expiresAt,
          decisions,
          ...(mode === 'coded' ? { codeResults } : {}),
        });
        await repositories.decisions.create(record);
        preparedReservations.length = 0;

        return response;
      } catch (error) {
        if (cleanupContext !== undefined) {
          await cleanupPreparedReservations(
            preparedReservations,
            reservations,
            cleanupContext,
          );
        }
        if (error instanceof NotFoundError) throw error;
        throw new Error('Evaluation pipeline failed', { cause: error });
      }
    },
  };
}
