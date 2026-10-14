import { createHmac, timingSafeEqual } from 'node:crypto';
import { CartSnapshotSchema, CustomerSnapshotSchema, IncentiveDecisionSchema, MerchandisePriceBreakdownSchema,
  OrderSnapshotSchema, type IncentiveDecision, type MerchandisePriceBreakdown } from '@incentives/contracts';
import { UnsupportedConnectorCapabilityError, type CommerceConnector } from '@incentives/connector-kit';

export interface NativeCustomer { shopper_id: string; profile: Record<string, unknown> }
export interface NativeLine { line_id: string; sku: string; count: number; unit_pence: number }
export interface NativeCart { currency: string; total_pence: number; items: NativeLine[] }
export interface NativeOrder extends NativeCart { order_id: string; retry_key: string; shopper_id?: string }
export type NativeAdjustment = { kind: 'order_discount' | 'line_item_discount'; calculation: 'fixed' | 'percent';
  sku?: string; pence?: number; currency?: string; basis_points?: number; maximum_pence?: number } | { kind: 'free_shipping' };
export interface NativePricing { currency: string; original_total_pence: number; discount_pence: number; total_pence: number;
  allocations: { promo_id: string; revision: number; rule_id: string; pence: number; line_allocations?: { line_id: string; pence: number }[] }[] }
function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid native money'); return value;
}
function lines(cart: NativeCart) {
  return cart.items.map(line => ({ lineRef: line.line_id, productRef: line.sku, quantity: line.count, unitPrice: money(line.unit_pence) }));
}
function mapDecision(input: IncentiveDecision): NativeAdjustment[] {
  return IncentiveDecisionSchema.parse(input).effects.map(effect => {
    if (effect.type === 'free_shipping') return { kind: 'free_shipping' };
    if (effect.type !== 'order_discount' && effect.type !== 'line_item_discount') throw new UnsupportedConnectorCapabilityError(effect.type);
    const common = { kind: effect.type, ...(effect.type === 'line_item_discount' ? { sku: effect.productRef } : {}) };
    return effect.calculation === 'fixed'
      ? { ...common, calculation: 'fixed', currency: effect.amount.currency, pence: effect.amount.minorUnits }
      : { ...common, calculation: 'percent', basis_points: effect.basisPoints,
        ...(effect.maximumDiscountAmount === undefined ? {} : { currency: effect.maximumDiscountAmount.currency, maximum_pence: effect.maximumDiscountAmount.minorUnits }) };
  });
}
export function createFakeConnector(verificationKey: string): CommerceConnector<NativeCustomer, NativeCart, NativeOrder, NativeAdjustment[]> {
  if (!verificationKey) throw Error('Missing fake source verification key');
  return {
    capabilities: () => ({ automaticDiscounts: true, discountCodes: true, lineItemAdjustments: true,
      checkoutBlocking: true, customerAttributes: true, orderWebhooks: true, walletRedemption: false }),
    normalizeCustomer: customer => CustomerSnapshotSchema.parse({ externalRef: customer.shopper_id, attributes: customer.profile }),
    normalizeCart: cart => CartSnapshotSchema.parse({ currency: cart.currency, subtotal: money(cart.total_pence), items: lines(cart) }),
    normalizeOrder: order => OrderSnapshotSchema.parse({ externalRef: order.order_id, idempotencyKey: order.retry_key,
      currency: order.currency, total: money(order.total_pence), items: lines(order), ...(order.shopper_id === undefined ? {} : { customerRef: order.shopper_id }) }),
    mapDecision,
    async verifyIncomingRequest(request) {
      const supplied = request.headers.get('x-fake-signature');
      if (!supplied || !/^[a-f0-9]{64}$/u.test(supplied)) return { verified: false };
      const expected = createHmac('sha256', verificationKey).update(await request.text()).digest();
      return { verified: timingSafeEqual(expected, Buffer.from(supplied, 'hex')) };
    },
  };
}
// Representation only: canonical server amounts/allocations are copied, never recalculated from effects.
export function mapPricing(input: MerchandisePriceBreakdown): NativePricing {
  const price = MerchandisePriceBreakdownSchema.parse(input);
  return { currency: price.currency, original_total_pence: price.originalMerchandiseSubtotal,
    discount_pence: price.totalDiscount, total_pence: price.discountedMerchandiseSubtotal,
    allocations: price.discountAllocations.map(allocation => ({ promo_id: allocation.programRef,
      revision: allocation.programRevision, rule_id: allocation.rewardRuleRef, pence: allocation.discountMinorUnits,
      ...(allocation.lineAllocations === undefined ? {} : { line_allocations: allocation.lineAllocations.map(line => ({ line_id: line.lineRef, pence: line.discountMinorUnits })) }) })) };
}
