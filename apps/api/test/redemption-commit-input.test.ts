import { describe, expect, it } from 'vitest';
import { parseRedemptionCommitInput } from '../src/services/redemption-input.js';

describe('parseRedemptionCommitInput', () => {
  it('strips merchantId before strict RedemptionRequest validation', () => {
    expect(
      parseRedemptionCommitInput({
        merchantId: 'merchant-1',
        evaluationId: 'eval-1',
        externalOrderRef: 'gid://shopify/Order/1',
        idempotencyKey: 'shopify_1',
        postCaptureReconciliation: true,
      }),
    ).toEqual({
      merchantId: 'merchant-1',
      input: {
        evaluationId: 'eval-1',
        externalOrderRef: 'gid://shopify/Order/1',
        idempotencyKey: 'shopify_1',
        postCaptureReconciliation: true,
      },
    });
  });

  it('rejects a missing merchantId', () => {
    expect(() => parseRedemptionCommitInput({
      evaluationId: 'eval-1',
      externalOrderRef: 'gid://shopify/Order/1',
      idempotencyKey: 'shopify_1',
    })).toThrow();
  });

  it('rejects unknown fields in the redemption request', () => {
    expect(() => parseRedemptionCommitInput({
      merchantId: 'merchant-1',
      evaluationId: 'eval-1',
      externalOrderRef: 'gid://shopify/Order/1',
      idempotencyKey: 'shopify_1',
      unexpected: true,
    })).toThrow();
  });
});
