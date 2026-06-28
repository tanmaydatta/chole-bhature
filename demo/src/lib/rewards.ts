import type { Reward } from './types';

export function rewardSummaryFor(r: Reward): string {
  switch (r.kind) {
    case 'percent': return `${r.value ?? 0}% off`;
    case 'fixed': return `$${r.value ?? 0} off`;
    case 'free_shipping': return 'Free shipping';
    case 'points': return `${r.value ?? 0}% back as points`;
    case 'credit': return `$${r.value ?? 0} credit`;
  }
}
