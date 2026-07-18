import { CartLineItemSchema, CartSchema } from './evaluation.js';
import { z } from './zod.js';

const AttributesSchema = z.record(z.string(), z.unknown());
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

export const CustomerSnapshotSchema = z.object({
  externalRef: z.string().min(1),
  attributes: AttributesSchema,
}).strict();

export const CartSnapshotSchema = CartSchema;

export const OrderSnapshotSchema = z.object({
  externalRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  currency: CurrencySchema,
  total: z.number().int().nonnegative(),
  customerRef: z.string().min(1).optional(),
  items: z.array(CartLineItemSchema),
}).strict();

export type CustomerSnapshot = z.infer<typeof CustomerSnapshotSchema>;
export type CartSnapshot = z.infer<typeof CartSnapshotSchema>;
export type OrderSnapshot = z.infer<typeof OrderSnapshotSchema>;
