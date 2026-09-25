import { MoneySchema } from './money.js';
import {
  NormalizedPromoCodeSchema,
  PromoCodeSchema,
  normalizeDistinctPromoCodes,
} from './promo-codes.js';
import { z } from './zod.js';

const AttributesSchema = z.record(z.string(), z.unknown());

export const CartLineItemSchema = z.object({
  lineRef: z.string().min(1),
  productRef: z.string().min(1),
  variantRef: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  attributes: AttributesSchema.optional(),
}).strict();

export const CartSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal: z.number().int().nonnegative(),
  items: z.array(CartLineItemSchema),
  attributes: AttributesSchema.optional(),
}).strict().superRefine((cart, context) => {
  const seen = new Set<string>();
  cart.items.forEach((item, index) => {
    if (seen.has(item.lineRef)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'lineRef'],
        message: `duplicate cart line identity: ${item.lineRef}`,
      });
    }
    seen.add(item.lineRef);
  });
});

const MaximumDiscountAmountSchema = MoneySchema.extend({
  minorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const validateDistinctCodeLimit = (
  request: { codes?: string[] | undefined },
  context: z.core.$RefinementCtx<{ codes?: string[] | undefined }>,
) => {
  if (request.codes?.some(code => !PromoCodeSchema.safeParse(code).success)) return;

  try {
    normalizeDistinctPromoCodes(request.codes ?? []);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    context.addIssue({
      code: 'custom',
      path: ['codes'],
      message: error.message,
      input: request,
    });
  }
};

export const EvaluationRequestSchema = z.object({
  customerRef: z.string().min(1).optional(),
  codes: z.array(PromoCodeSchema).optional(),
  cart: CartSchema,
  context: AttributesSchema.optional(),
}).strict().superRefine(validateDistinctCodeLimit);

export const DecisionOutcomeSchema = z.enum([
  'qualified',
  'not_qualified',
  'unavailable',
  'invalid_code',
  'exhausted',
  'conflict',
]);

export const FixedOrderDiscountEffectSchema = z.object({
  type: z.literal('order_discount'),
  calculation: z.literal('fixed'),
  amount: MoneySchema,
}).strict();

export const PercentOrderDiscountEffectSchema = z.object({
  type: z.literal('order_discount'),
  calculation: z.literal('percent'),
  basisPoints: z.number().int().min(1).max(10_000),
  maximumDiscountAmount: MaximumDiscountAmountSchema.optional(),
}).strict();

export const OrderDiscountEffectSchema = z.discriminatedUnion('calculation', [
  FixedOrderDiscountEffectSchema,
  PercentOrderDiscountEffectSchema,
]);

export const FixedLineItemDiscountEffectSchema = z.object({
  type: z.literal('line_item_discount'),
  productRef: z.string().min(1),
  calculation: z.literal('fixed'),
  amount: MoneySchema,
}).strict();

export const PercentLineItemDiscountEffectSchema = z.object({
  type: z.literal('line_item_discount'),
  productRef: z.string().min(1),
  calculation: z.literal('percent'),
  basisPoints: z.number().int().min(1).max(10_000),
  maximumDiscountAmount: MaximumDiscountAmountSchema.optional(),
}).strict();

export const LineItemDiscountEffectSchema = z.discriminatedUnion('calculation', [
  FixedLineItemDiscountEffectSchema,
  PercentLineItemDiscountEffectSchema,
]);

export const FreeShippingEffectSchema = z.object({
  type: z.literal('free_shipping'),
}).strict();

export const WalletDebitEffectSchema = z.object({
  type: z.literal('wallet_debit'),
  amount: MoneySchema,
}).strict();

export const WalletCreditEffectSchema = z.object({
  type: z.literal('wallet_credit'),
  amount: MoneySchema,
}).strict();

export const PointsCreditEffectSchema = z.object({
  type: z.literal('points_credit'),
  points: z.number().int().positive(),
}).strict();

export const AttributionEffectSchema = z.object({
  type: z.literal('attribution'),
  subjectRef: z.string().min(1),
}).strict();

export const EffectSchema = z.union([
  OrderDiscountEffectSchema,
  LineItemDiscountEffectSchema,
  FreeShippingEffectSchema,
  WalletDebitEffectSchema,
  WalletCreditEffectSchema,
  PointsCreditEffectSchema,
  AttributionEffectSchema,
]);

export const ProgramTypeSchema = z.enum([
  'promo',
  'affiliate',
  'referral',
  'loyalty',
]);

export const ReasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

export const IncentiveDecisionSchema = z.object({
  programRef: z.string().min(1),
  programRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  programType: ProgramTypeSchema,
  outcome: DecisionOutcomeSchema,
  rewardRuleRef: z.string().min(1).optional(),
  effects: z.array(EffectSchema),
  reasonCodes: z.array(ReasonCodeSchema),
  message: z.string().min(1).optional(),
  commitRequired: z.boolean(),
  eligible: z.boolean().optional(),
}).strict().superRefine((decision, context) => {
  if (decision.eligible === undefined) return;

  const derivedEligibility = decision.outcome === 'qualified';
  if (decision.eligible !== derivedEligibility) {
    context.addIssue({
      code: 'custom',
      path: ['eligible'],
      message: 'eligible must match the authoritative outcome',
    });
  }
});

export const CodeEvaluationResultSchema = z.object({
  code: PromoCodeSchema,
  normalizedCode: NormalizedPromoCodeSchema,
  outcome: z.enum([
    'selected',
    'invalid_code',
    'not_qualified',
    'unavailable',
    'exhausted',
    'combination_rejected',
  ]),
  programRef: z.string().min(1).optional(),
  reasonCodes: z.array(ReasonCodeSchema),
}).strict();

const NonnegativeSafeIntegerSchema = z.number().int().nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const MerchandiseLineDiscountAllocationSchema = z.object({
  lineRef: z.string().min(1),
  discountMinorUnits: NonnegativeSafeIntegerSchema,
}).strict();

export const MerchandiseDiscountAllocationSchema = z.object({
  programRef: z.string().min(1),
  programRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  rewardRuleRef: z.string().min(1),
  discountMinorUnits: NonnegativeSafeIntegerSchema,
  lineAllocations: z.array(MerchandiseLineDiscountAllocationSchema).optional(),
}).strict();

export const MerchandisePriceBreakdownSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  originalMerchandiseSubtotal: NonnegativeSafeIntegerSchema,
  discountAllocations: z.array(MerchandiseDiscountAllocationSchema),
  totalDiscount: NonnegativeSafeIntegerSchema,
  discountedMerchandiseSubtotal: NonnegativeSafeIntegerSchema,
}).strict().superRefine((breakdown, context) => {
  const allocationTotal = breakdown.discountAllocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.discountMinorUnits),
    0n,
  );
  if (allocationTotal !== BigInt(breakdown.totalDiscount)) {
    context.addIssue({
      code: 'custom',
      path: ['totalDiscount'],
      message: 'totalDiscount must equal the sum of discount allocations',
    });
  }
  if (
    BigInt(breakdown.originalMerchandiseSubtotal) - BigInt(breakdown.totalDiscount)
    !== BigInt(breakdown.discountedMerchandiseSubtotal)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discountedMerchandiseSubtotal'],
      message: 'discounted subtotal must equal original subtotal minus total discount',
    });
  }

  const allocationKeys = new Set<string>();
  breakdown.discountAllocations.forEach((allocation, allocationIndex) => {
    const allocationKey = JSON.stringify([
      allocation.programRef,
      allocation.programRevision,
      allocation.rewardRuleRef,
    ]);
    if (allocationKeys.has(allocationKey)) {
      context.addIssue({
        code: 'custom',
        path: ['discountAllocations', allocationIndex],
        message: 'discount allocation identity must be unique',
      });
    }
    allocationKeys.add(allocationKey);

    const lineRefs = new Set<string>();
    let lineTotal = 0n;
    allocation.lineAllocations?.forEach((line, lineIndex) => {
      if (lineRefs.has(line.lineRef)) {
        context.addIssue({
          code: 'custom',
          path: ['discountAllocations', allocationIndex, 'lineAllocations', lineIndex, 'lineRef'],
          message: 'line allocation identity must be unique within a discount allocation',
        });
      }
      lineRefs.add(line.lineRef);
      lineTotal += BigInt(line.discountMinorUnits);
    });
    if (lineTotal > BigInt(allocation.discountMinorUnits)) {
      context.addIssue({
        code: 'custom',
        path: ['discountAllocations', allocationIndex, 'lineAllocations'],
        message: 'line allocations must not exceed their discount allocation',
      });
    }
  });
});

export const EvaluationResponseSchema = z.object({
  evaluationId: z.string().min(1),
  customerRef: z.string().min(1).optional(),
  customerVersion: z.number().int().positive().optional(),
  schemaVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
  decisions: z.array(IncentiveDecisionSchema),
  priceBreakdown: MerchandisePriceBreakdownSchema,
  codeResults: z.array(CodeEvaluationResultSchema).optional(),
}).strict();

export const RedemptionRequestSchema = z.object({
  evaluationId: z.string().min(1),
  externalOrderRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict();

export const RedemptionEntrySchema = z.object({
  programRef: z.string().min(1),
  programRevision: z.number().int().positive(),
  rewardRuleRef: z.string().min(1).optional(),
  effects: z.array(EffectSchema),
}).strict();

export const RedemptionResponseSchema = z.object({
  redemptionId: z.string().min(1),
  evaluationId: z.string().min(1),
  externalOrderRef: z.string().min(1),
  status: z.literal('committed'),
  entries: z.array(RedemptionEntrySchema),
  priceBreakdown: MerchandisePriceBreakdownSchema,
  idempotencyKey: z.string().min(1),
}).strict();

export type CartLineItem = z.infer<typeof CartLineItemSchema>;
export type Cart = z.infer<typeof CartSchema>;
export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type ProgramType = z.infer<typeof ProgramTypeSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type IncentiveDecision = z.infer<typeof IncentiveDecisionSchema>;
export type CodeEvaluationResult = z.infer<typeof CodeEvaluationResultSchema>;
export type MerchandiseLineDiscountAllocation = z.infer<
  typeof MerchandiseLineDiscountAllocationSchema
>;
export type MerchandiseDiscountAllocation = z.infer<
  typeof MerchandiseDiscountAllocationSchema
>;
export type MerchandisePriceBreakdown = z.infer<typeof MerchandisePriceBreakdownSchema>;
export type EvaluationResponse = z.infer<typeof EvaluationResponseSchema>;
export type RedemptionRequest = z.infer<typeof RedemptionRequestSchema>;
export type RedemptionEntry = z.infer<typeof RedemptionEntrySchema>;
export type RedemptionResponse = z.infer<typeof RedemptionResponseSchema>;
