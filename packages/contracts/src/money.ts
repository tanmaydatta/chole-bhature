import { z } from './zod.js';

export const MoneySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  minorUnits: z.number().int(),
}).strict();

export type Money = z.infer<typeof MoneySchema>;
