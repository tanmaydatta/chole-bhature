import type { Variable } from '../lib/types';

export const VARIABLES: Variable[] = [
  // User attributes
  { name: 'customer_country', type: 'string', origin: 'user', defaultMessage: "This code isn't available in your region." },
  { name: 'customer_tier', type: 'enum', origin: 'user', enumValues: ['gold', 'silver', 'bronze'] },
  { name: 'first_purchase', type: 'boolean', origin: 'user', defaultMessage: 'This code is for first-time customers only.' },
  { name: 'lifetime_orders', type: 'number', origin: 'user' },
  // Dynamic
  { name: 'basket_value', type: 'number', origin: 'dynamic', defaultMessage: "Your basket doesn't meet the minimum." },
  { name: 'items_in_basket', type: 'number', origin: 'dynamic' },
  { name: 'category', type: 'string', origin: 'dynamic' },
  // System read-only
  { name: 'budget_remaining', type: 'number', origin: 'system', readOnly: true, defaultMessage: 'This offer has ended — check back soon!' },
  { name: 'redemptions_total', type: 'number', origin: 'system', readOnly: true, defaultMessage: 'This offer has reached its limit.' },
  { name: 'customer_uses_count', type: 'number', origin: 'system', readOnly: true, defaultMessage: "You've already used this offer." },
  { name: 'today', type: 'date', origin: 'system', readOnly: true },
];
