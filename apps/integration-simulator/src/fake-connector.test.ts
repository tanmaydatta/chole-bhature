import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { runConnectorConformanceSuite } from '@incentives/connector-kit';
import { IncentiveDecisionSchema } from '@incentives/contracts';
import { createFakeConnector, mapPricing } from './fake-connector.js';

const decision = IncentiveDecisionSchema.parse({ programRef: 'fixture', programRevision: 2, programType: 'promo',
  outcome: 'qualified', rewardRuleRef: 'fixed', effects: [{ type: 'order_discount', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 100 } }],
  reasonCodes: [], commitRequired: true });
describe('native fake connector conformance', () => {
  // Break caught: dropping native identities/customer attributes, claiming unsupported effects, or committing after capture.
  test('passes existing conformance across normalization, effects, source verification and checkout ordering', async () => {
    const key = 'ephemeral-fake-conformance-key'; const connector = createFakeConnector(key);
    const cart = { currency: 'GBP', total_pence: 1_000, items: [{ line_id: ' line ', sku: ' sku ', count: 1, unit_pence: 1_000 }] };
    const trace: string[] = [];
    const signed = createHmac('sha256', key).update('native request').digest('hex');
    const result = await runConnectorConformanceSuite(connector, {
      customerInput: { shopper_id: ' shopper ', profile: { sentinel: 'customer-only-value' } }, cartInput: cart,
      orderInput: { ...cart, order_id: ' order ', retry_key: ' retry ', shopper_id: ' shopper ' },
      expectedCustomerRef: ' shopper ', expectedCustomerAttributes: { sentinel: 'customer-only-value' }, customerOnlyAttributeSentinels: ['customer-only-value'],
      expectedOrderRef: ' order ', expectedOrderCustomerRef: ' shopper ', expectedIdempotencyKey: ' retry ',
      expectedCartLineRefs: [{ lineRef: ' line ', productRef: ' sku ' }], expectedOrderLineRefs: [{ lineRef: ' line ', productRef: ' sku ' }],
      validRequest: new Request('https://fake.test', { method: 'POST', body: 'native request', headers: { 'x-fake-signature': signed } }),
      invalidRequest: new Request('https://fake.test', { method: 'POST', body: 'altered request', headers: { 'x-fake-signature': signed } }),
      trace, evaluate: async () => decision,
      assertMappedDecision(source, mapped) {
        assert.equal(mapped.length, source.effects.length);
        const effect = source.effects[0];
        if (source.effects.length > 1) return; // Supported mixed probes are individually checked below.
        if (effect?.type === 'free_shipping') assert.deepEqual(mapped, [{ kind: 'free_shipping' }]);
        else if (effect?.type === 'order_discount') assert.deepEqual(mapped, effect.calculation === 'fixed'
          ? [{ kind: 'order_discount', calculation: 'fixed', currency: 'GBP', pence: 100 }]
          : [{ kind: 'order_discount', calculation: 'percent', basis_points: 1_000 }]);
        else if (effect?.type === 'line_item_discount') assert.deepEqual(mapped, effect.calculation === 'fixed'
          ? [{ kind: 'line_item_discount', sku: 'connector-conformance-product', calculation: 'fixed', currency: 'GBP', pence: 100 }]
          : [{ kind: 'line_item_discount', sku: 'connector-conformance-product', calculation: 'percent', basis_points: 1_000 }]);
      },
      apply: async () => {}, commit: async order => { expect(order.total).toBe(1_000); },
      capturePayment: async () => { expect(trace).toEqual(['evaluate', 'map', 'apply', 'commit', 'capture']); },
    });
    expect(result).toEqual({ passed: true });
  });
  test('preserves capped percentage and shipping effects without calculating merchandise saving', () => {
    const connector = createFakeConnector('fake-key');
    expect(connector.mapDecision({ ...decision, effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
      maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 } }, { type: 'free_shipping' }] })).toEqual([
      { kind: 'order_discount', calculation: 'percent', basis_points: 2_500, currency: 'GBP', maximum_pence: 1_500 }, { kind: 'free_shipping' },
    ]);
    expect(mapPricing({ currency: 'GBP', originalMerchandiseSubtotal: 1_234, discountAllocations: [], totalDiscount: 0, discountedMerchandiseSubtotal: 1_234 })).toEqual({
      currency: 'GBP', original_total_pence: 1_234, allocations: [], discount_pence: 0, total_pence: 1_234,
    });
  });
});
