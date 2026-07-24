import { z } from './zod.js';

export const PromoCodeSchema = z.string().superRefine((value, context) => {
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 128) {
    context.addIssue({
      code: 'custom',
      message: 'Promo code must contain 1 to 128 Unicode code points',
    });
  }
});

export const NormalizedPromoCodeSchema = PromoCodeSchema.transform(
  value => value.trim().toUpperCase(),
);

export interface NormalizedPromoCode {
  display: string;
  normalized: string;
}

export function normalizePromoCode(value: string): NormalizedPromoCode {
  const display = PromoCodeSchema.parse(value).trim();
  return {
    display,
    normalized: display.toUpperCase(),
  };
}

export function normalizeDistinctPromoCodes(
  values: readonly string[],
): NormalizedPromoCode[] {
  const distinct = new Map<string, NormalizedPromoCode>();
  for (const value of values) {
    const code = normalizePromoCode(value);
    if (!distinct.has(code.normalized)) distinct.set(code.normalized, code);
  }
  if (distinct.size > 10) {
    throw new RangeError('At most 10 distinct promo codes may be evaluated');
  }
  return [...distinct.values()];
}
