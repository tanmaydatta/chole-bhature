import type { EventDef } from '../lib/types';

export const EVENTS: EventDef[] = [
  {
    name: 'order_completed',
    description: 'Sent when a customer completes an order',
    live: true,
    usedIn: 3,
    fields: [
      { name: 'order_id', type: 'string', required: true },
      { name: 'order_value', type: 'number', required: true },
      { name: 'currency', type: 'string', required: true },
      { name: 'items_in_basket', type: 'number', required: false },
      { name: 'category', type: 'string', required: false },
      { name: 'payment_method', type: 'string', required: false },
    ],
    sample: {
      order_id: '"ord_8842"',
      order_value: '128.50',
      currency: '"USD"',
      items_in_basket: '3',
      category: '"electronics"',
      payment_method: '"card"',
    },
  },
  {
    name: 'review_submitted',
    description: 'Sent when a customer submits a product review',
    live: true,
    usedIn: 1,
    fields: [
      { name: 'review_id', type: 'string', required: true },
      { name: 'rating', type: 'number', required: true },
      { name: 'product_id', type: 'string', required: true },
      { name: 'has_photo', type: 'boolean', required: false },
    ],
    sample: {
      review_id: '"rev_201"',
      rating: '5',
      product_id: '"prod_77"',
      has_photo: 'true',
    },
  },
  {
    name: 'subscription_renewed',
    description: 'Sent when a subscription is renewed',
    live: false,
    usedIn: 0,
    fields: [
      { name: 'subscription_id', type: 'string', required: true },
      { name: 'plan', type: 'string', required: true },
      { name: 'term_months', type: 'number', required: true },
      { name: 'mrr', type: 'number', required: false },
    ],
    sample: {
      subscription_id: '"sub_55"',
      plan: '"pro"',
      term_months: '12',
      mrr: '29.00',
    },
  },
  {
    name: 'signup_completed',
    description: 'Sent when a new customer completes sign-up',
    live: false,
    usedIn: 0,
    fields: [
      { name: 'signup_source', type: 'string', required: false },
      { name: 'referral_code', type: 'string', required: false },
    ],
    sample: {
      signup_source: '"organic"',
      referral_code: '"REF123"',
    },
  },
];
