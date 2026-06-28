import type { Program } from '../lib/types';

export const PROGRAMS: Program[] = [
  // Promo
  { id: 'promo-1', name: 'SUMMER15', type: 'promo', status: 'active', rewardSummary: '15% off', redemptions: 3204, subtitle: 'Orders over $50', code: 'SUMMER15', autoApply: false, stackable: false },
  { id: 'promo-2', name: 'WELCOME10', type: 'promo', status: 'paused', rewardSummary: '$10 off', redemptions: 223, subtitle: 'First order only', code: 'WELCOME10', autoApply: false, stackable: false },
  // Affiliate
  { id: 'aff-1', name: 'ACME-EMPLOYEES', type: 'affiliate', status: 'active', rewardSummary: '$25 off', redemptions: 318, subtitle: '500 unique codes', codeCount: 500 },
  // Referral
  { id: 'ref-1', name: 'Give $10, Get $10', type: 'referral', status: 'active', rewardSummary: '$10 / $10', redemptions: 1902, subtitle: 'Priority 1 · all customers', priority: 3, referrerReward: '$10 credit', refereeReward: '$10 off', appliesTo: 'all customers' },
  { id: 'ref-2', name: 'VIP Referral', type: 'referral', status: 'active', rewardSummary: '$25 / 20%', redemptions: 0, subtitle: 'Applies to gold tier', priority: 1, referrerReward: '$25 credit', refereeReward: '20% off', appliesTo: 'customer_tier is gold' },
  { id: 'ref-3', name: 'Holiday Referral', type: 'referral', status: 'scheduled', rewardSummary: '$15 / $15', redemptions: 0, subtitle: 'Applies today in Dec', priority: 2, referrerReward: '$15 credit', refereeReward: '$15 off', appliesTo: 'today in Dec' },
  // Loyalty
  { id: 'loy-1', name: 'Order Rewards', type: 'loyalty', status: 'active', rewardSummary: '5% back as points', redemptions: 2765, subtitle: 'on order_completed', triggerEvent: 'order_completed' },
];
