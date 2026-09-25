import type {
  Cart,
  IncentiveDecision,
  MerchandiseDiscountAllocation,
  MerchandisePriceBreakdown,
} from '@incentives/contracts';

const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function safeMinorUnits(value: bigint): number {
  if (value < 0n || value > MAX_SAFE_MINOR_UNITS) {
    throw new RangeError('Discount exceeds the supported minor-unit range');
  }
  return Number(value);
}

function requireCurrency(currency: string, cartCurrency: string): void {
  if (currency !== cartCurrency) {
    throw new TypeError('Discount currency must match the cart currency');
  }
}

export function calculateMerchandisePriceBreakdown(
  cart: Cart,
  decisions: readonly IncentiveDecision[],
): MerchandisePriceBreakdown {
  const subtotal = BigInt(cart.subtotal);
  let remainingMerchandise = subtotal;
  const remainingLineValues = new Map(cart.items.map(item => [
    item.lineRef,
    BigInt(item.unitPrice) * BigInt(item.quantity),
  ]));
  const discountAllocations: MerchandiseDiscountAllocation[] = [];

  for (const decision of decisions) {
    if (
      decision.outcome !== 'qualified'
      || decision.rewardRuleRef === undefined
    ) continue;

    let decisionDiscount = 0n;
    const lineDiscounts = new Map<string, bigint>();
    let hasMonetaryEffect = false;

    for (const effect of decision.effects) {
      if (effect.type === 'free_shipping') continue;
      if (effect.type !== 'order_discount' && effect.type !== 'line_item_discount') {
        throw new TypeError(`Unsupported merchandise discount effect: ${effect.type}`);
      }
      hasMonetaryEffect = true;

      if (effect.type === 'order_discount') {
        let nominal: bigint;
        if (effect.calculation === 'fixed') {
          requireCurrency(effect.amount.currency, cart.currency);
          nominal = minimum(BigInt(effect.amount.minorUnits), subtotal);
        } else {
          nominal = subtotal * BigInt(effect.basisPoints) / 10_000n;
          if (effect.maximumDiscountAmount !== undefined) {
            requireCurrency(effect.maximumDiscountAmount.currency, cart.currency);
            nominal = minimum(nominal, BigInt(effect.maximumDiscountAmount.minorUnits));
          }
        }
        const allocated = minimum(nominal, remainingMerchandise);
        decisionDiscount += allocated;
        remainingMerchandise -= allocated;
        continue;
      }

      let remainingRewardMaximum = effect.calculation === 'percent'
        && effect.maximumDiscountAmount !== undefined
        ? BigInt(effect.maximumDiscountAmount.minorUnits)
        : MAX_SAFE_MINOR_UNITS;
      if (effect.calculation === 'fixed') {
        requireCurrency(effect.amount.currency, cart.currency);
      } else if (effect.maximumDiscountAmount !== undefined) {
        requireCurrency(effect.maximumDiscountAmount.currency, cart.currency);
      }

      for (const item of cart.items) {
        if (item.productRef !== effect.productRef) continue;
        const extendedLineValue = BigInt(item.unitPrice) * BigInt(item.quantity);
        const nominal = effect.calculation === 'fixed'
          ? minimum(BigInt(effect.amount.minorUnits) * BigInt(item.quantity), extendedLineValue)
          : extendedLineValue * BigInt(effect.basisPoints) / 10_000n;
        const remainingLineValue = remainingLineValues.get(item.lineRef) ?? 0n;
        const allocated = minimum(
          minimum(nominal, remainingRewardMaximum),
          minimum(remainingMerchandise, remainingLineValue),
        );
        if (allocated > 0n) {
          lineDiscounts.set(
            item.lineRef,
            (lineDiscounts.get(item.lineRef) ?? 0n) + allocated,
          );
        }
        decisionDiscount += allocated;
        remainingRewardMaximum -= allocated;
        remainingMerchandise -= allocated;
        remainingLineValues.set(item.lineRef, remainingLineValue - allocated);
      }
    }

    if (!hasMonetaryEffect) continue;
    discountAllocations.push({
      programRef: decision.programRef,
      programRevision: decision.programRevision,
      rewardRuleRef: decision.rewardRuleRef,
      discountMinorUnits: safeMinorUnits(decisionDiscount),
      ...(lineDiscounts.size === 0
        ? {}
        : {
          lineAllocations: [...lineDiscounts].map(([lineRef, amount]) => ({
            lineRef,
            discountMinorUnits: safeMinorUnits(amount),
          })),
        }),
    });
  }

  const totalDiscount = subtotal - remainingMerchandise;
  return {
    currency: cart.currency,
    originalMerchandiseSubtotal: cart.subtotal,
    discountAllocations,
    totalDiscount: safeMinorUnits(totalDiscount),
    discountedMerchandiseSubtotal: safeMinorUnits(remainingMerchandise),
  };
}
