import { MoneySchema } from './money.js';
import { z } from './zod.js';

const AttributesSchema = z.record(z.string(), z.unknown());

export const CartLineItemSchema = z.object({
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
}).strict();

export const EvaluationRequestSchema = z.object({
  customerRef: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  cart: CartSchema,
  context: AttributesSchema.optional(),
}).strict();

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

export const IncentiveDecisionSchema = z.object({
  programRef: z.string().min(1),
  programType: ProgramTypeSchema,
  outcome: DecisionOutcomeSchema,
  rewardRuleRef: z.string().min(1).optional(),
  effects: z.array(EffectSchema),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
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

export const EvaluationResponseSchema = z.object({
  evaluationId: z.string().min(1),
  customerRef: z.string().min(1).optional(),
  customerVersion: z.number().int().positive().optional(),
  schemaVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
  decisions: z.array(IncentiveDecisionSchema),
}).strict();

const RedemptionRequestFields = {
  evaluationId: z.string().min(1),
  programRef: z.string().min(1),
};

export const RedemptionRequestSchema = z.union([
  z.object({
    ...RedemptionRequestFields,
    externalOrderRef: z.string().min(1),
    idempotencyKey: z.string().min(1).optional(),
  }).strict(),
  z.object({
    ...RedemptionRequestFields,
    externalOrderRef: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
  }).strict(),
]);

const RedemptionResponseFields = {
  redemptionId: z.string().min(1),
  evaluationId: z.string().min(1),
  programRef: z.string().min(1),
  rewardRuleRef: z.string().min(1).optional(),
  status: z.literal('committed'),
  effects: z.array(EffectSchema),
};

export const RedemptionResponseSchema = z.union([
  z.object({
    ...RedemptionResponseFields,
    externalOrderRef: z.string().min(1),
    idempotencyKey: z.string().min(1).optional(),
  }).strict(),
  z.object({
    ...RedemptionResponseFields,
    externalOrderRef: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
  }).strict(),
]);

export type CartLineItem = z.infer<typeof CartLineItemSchema>;
export type Cart = z.infer<typeof CartSchema>;
export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type ProgramType = z.infer<typeof ProgramTypeSchema>;
export type IncentiveDecision = z.infer<typeof IncentiveDecisionSchema>;
export type EvaluationResponse = z.infer<typeof EvaluationResponseSchema>;
export type RedemptionRequest = z.infer<typeof RedemptionRequestSchema>;
export type RedemptionResponse = z.infer<typeof RedemptionResponseSchema>;
