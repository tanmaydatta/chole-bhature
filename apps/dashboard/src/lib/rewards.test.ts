import { describe, it, expect } from 'vitest';
import { rewardSummaryFor } from './rewards';

describe('rewardSummaryFor', () => {
  it('formats percent rewards', () => {
    expect(rewardSummaryFor({ kind: 'percent', value: 15 })).toBe('15% off');
  });

  it('formats fixed rewards', () => {
    expect(rewardSummaryFor({ kind: 'fixed', value: 10 })).toBe('$10 off');
  });

  it('formats free shipping', () => {
    expect(rewardSummaryFor({ kind: 'free_shipping' })).toBe('Free shipping');
  });

  it('formats points rewards', () => {
    expect(rewardSummaryFor({ kind: 'points', value: 5 })).toBe('5% back as points');
  });

  it('formats credit rewards', () => {
    expect(rewardSummaryFor({ kind: 'credit', value: 20 })).toBe('$20 credit');
  });

  it('defaults missing value to 0', () => {
    expect(rewardSummaryFor({ kind: 'percent' })).toBe('0% off');
  });
});
