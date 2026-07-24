import { z } from './zod.js';

const UNICODE_CONTROL_CHARACTER = /\p{Cc}/u;

function normalizedPromoCode(value: string): string {
  return value.trim().toUpperCase();
}

export const PromoCodeSchema = z.string().superRefine((value, context) => {
  const normalized = normalizedPromoCode(value);
  const length = [...normalized].length;
  if (length < 1 || length > 128) {
    context.addIssue({
      code: 'custom',
      message: 'Promo code must contain 1 to 128 Unicode code points',
    });
  }
  if (UNICODE_CONTROL_CHARACTER.test(normalized)) {
    context.addIssue({
      code: 'custom',
      message: 'Promo code must not contain Unicode control characters',
    });
  }
});

export const NormalizedPromoCodeSchema = PromoCodeSchema.transform(
  normalizedPromoCode,
);

export interface NormalizedPromoCode {
  display: string;
  normalized: string;
}

export function normalizePromoCode(value: string): NormalizedPromoCode {
  const display = PromoCodeSchema.parse(value).trim();
  return {
    display,
    normalized: normalizedPromoCode(display),
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
