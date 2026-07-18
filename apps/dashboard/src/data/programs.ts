import type { ConditionGroup, Program, Reward } from '../lib/types';

// Each program of a given type carries the SAME set of config keys that the
// matching create flow's buildProgram() writes, so the detail page and
// edit-prefill read identical keys for seeded and flow-created programs:
//   promo:     code, autoApply, stackable, eligibility, discount, budget,
//              perCustomer, startDate, endDate
//   affiliate: codeCount, usesPerCode, eligibility, discount, budget, perCustomer,
//              startDate, endDate
//   referral:  priority, referrerReward, refereeReward, appliesTo, eligibility,
//              budget, perCustomer, startDate, endDate
//   loyalty:   triggerEvent, reward, eligibility

export const PROGRAMS: Program[] = [
  // Promo — active, enriched with eligibility + discount + limits
  {
    id: 'promo-1',
    name: 'SUMMER15',
    type: 'promo',
    status: 'active',
    rewardSummary: '15% off',
    redemptions: 3204,
    subtitle: 'Orders over $50',
    code: 'SUMMER15',
    autoApply: false,
    stackable: false,
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'c1', variable: 'basket_value', operator: 'gte', value: '50' },
      ],
    } satisfies ConditionGroup,
    discount: { kind: 'percent', value: 15 } satisfies Reward,
    budget: 10000,
    perCustomer: 1,
    startDate: '2026-06-01',
    endDate: '2026-08-31',
  },
  // Promo — paused
  {
    id: 'promo-2',
    name: 'WELCOME10',
    type: 'promo',
    status: 'paused',
    rewardSummary: '$10 off',
    redemptions: 223,
    subtitle: 'First order only',
    code: 'WELCOME10',
    autoApply: false,
    stackable: false,
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'c2', variable: 'first_purchase', operator: 'is', value: 'true' },
      ],
    } satisfies ConditionGroup,
    discount: { kind: 'fixed', value: 10 } satisfies Reward,
    budget: 2000,
    perCustomer: 1,
    startDate: '2026-01-01',
    endDate: undefined,
  },
  // Promo — DRAFT
  {
    id: 'promo-draft-1',
    name: 'Draft Summer Sale',
    type: 'promo',
    status: 'draft',
    rewardSummary: '20% off',
    redemptions: 0,
    subtitle: '2 conditions',
    code: 'DRAFTSUMMER20',
    autoApply: false,
    stackable: false,
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'dc1', variable: 'basket_value', operator: 'gte', value: '75' },
        { id: 'dc2', variable: 'customer_country', operator: 'eq', value: 'US' },
      ],
    } satisfies ConditionGroup,
    discount: { kind: 'percent', value: 20 } satisfies Reward,
    budget: 5000,
    perCustomer: 2,
    startDate: '2026-07-01',
    endDate: '2026-09-30',
  },

  // Affiliate — active, enriched with eligibility + discount
  {
    id: 'aff-1',
    name: 'ACME-EMPLOYEES',
    type: 'affiliate',
    status: 'active',
    rewardSummary: '$25 off',
    redemptions: 318,
    subtitle: '500 unique codes',
    codeCount: 500,
    usesPerCode: 1,
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'a1', variable: 'customer_tier', operator: 'in', value: ['gold', 'silver'] },
      ],
    } satisfies ConditionGroup,
    discount: { kind: 'fixed', value: 25 } satisfies Reward,
    budget: 20000,
    perCustomer: 1,
    startDate: '2026-03-01',
    endDate: undefined,
  },
  // Affiliate — DRAFT
  {
    id: 'aff-draft-1',
    name: 'Draft Partner Codes',
    type: 'affiliate',
    status: 'draft',
    rewardSummary: '10% off',
    redemptions: 0,
    subtitle: '250 unique codes',
    codeCount: 250,
    usesPerCode: 5,
    eligibility: {
      match: 'ANY',
      conditions: [
        { id: 'adc1', variable: 'lifetime_orders', operator: 'gte', value: '5' },
      ],
    } satisfies ConditionGroup,
    discount: { kind: 'percent', value: 10 } satisfies Reward,
    budget: 8000,
    perCustomer: 3,
    startDate: '2026-08-01',
    endDate: '2026-12-31',
  },

  // Referral — active (all customers)
  {
    id: 'ref-1',
    name: 'Give $10, Get $10',
    type: 'referral',
    status: 'active',
    rewardSummary: '$10 / $10',
    redemptions: 1902,
    subtitle: 'All customers',
    priority: 3,
    referrerReward: { kind: 'credit', value: 10 } satisfies Reward,
    refereeReward: { kind: 'fixed', value: 10 } satisfies Reward,
    appliesTo: 'all customers',
    eligibility: {
      match: 'ALL',
      conditions: [],
    } satisfies ConditionGroup,
    budget: undefined,
    perCustomer: undefined,
    startDate: undefined,
    endDate: undefined,
  },
  // Referral — active (gold tier)
  {
    id: 'ref-2',
    name: 'VIP Referral',
    type: 'referral',
    status: 'active',
    rewardSummary: '$25 / 20%',
    redemptions: 0,
    subtitle: 'Applies to gold tier',
    priority: 1,
    referrerReward: { kind: 'credit', value: 25 } satisfies Reward,
    refereeReward: { kind: 'percent', value: 20 } satisfies Reward,
    appliesTo: '1 condition(s)',
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'r2c1', variable: 'customer_tier', operator: 'eq', value: 'gold' },
      ],
    } satisfies ConditionGroup,
    budget: undefined,
    perCustomer: undefined,
    startDate: undefined,
    endDate: undefined,
  },
  // Referral — scheduled
  {
    id: 'ref-3',
    name: 'Holiday Referral',
    type: 'referral',
    status: 'scheduled',
    rewardSummary: '$15 / $15',
    redemptions: 0,
    subtitle: 'Applies today in Dec',
    priority: 2,
    referrerReward: { kind: 'credit', value: 15 } satisfies Reward,
    refereeReward: { kind: 'fixed', value: 15 } satisfies Reward,
    appliesTo: '1 condition(s)',
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'r3c1', variable: 'today', operator: 'between', value: ['2026-12-01', '2026-12-31'] },
      ],
    } satisfies ConditionGroup,
    budget: undefined,
    perCustomer: undefined,
    startDate: '2026-12-01',
    endDate: '2026-12-31',
  },
  // Referral — DRAFT
  {
    id: 'ref-draft-1',
    name: 'Draft VIP Referral',
    type: 'referral',
    status: 'draft',
    rewardSummary: '$50 / 25%',
    redemptions: 0,
    subtitle: 'Priority 4 · 1 condition(s)',
    priority: 4,
    referrerReward: { kind: 'credit', value: 50 } satisfies Reward,
    refereeReward: { kind: 'percent', value: 25 } satisfies Reward,
    appliesTo: '1 condition(s)',
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'rdc1', variable: 'lifetime_orders', operator: 'gte', value: '10' },
      ],
    } satisfies ConditionGroup,
    budget: 15000,
    perCustomer: 5,
    startDate: undefined,
    endDate: undefined,
  },

  // Loyalty — active, enriched with eligibility
  {
    id: 'loy-1',
    name: 'Order Rewards',
    type: 'loyalty',
    status: 'active',
    rewardSummary: '5% back as points',
    redemptions: 2765,
    subtitle: 'on order_completed',
    triggerEvent: 'order_completed',
    reward: { kind: 'points', value: 5 } satisfies Reward,
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'l1c1', variable: 'basket_value', operator: 'gte', value: '20' },
      ],
    } satisfies ConditionGroup,
  },
  // Loyalty — DRAFT
  {
    id: 'loy-draft-1',
    name: 'Draft Signup Reward',
    type: 'loyalty',
    status: 'draft',
    rewardSummary: '100 points',
    redemptions: 0,
    subtitle: 'on signup_completed',
    triggerEvent: 'signup_completed',
    reward: { kind: 'points', value: 100 } satisfies Reward,
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'ldc1', variable: 'customer_country', operator: 'eq', value: 'US' },
      ],
    } satisfies ConditionGroup,
  },
];
