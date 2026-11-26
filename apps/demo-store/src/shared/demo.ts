import type {
  CandidateOffer,
  Cart,
  EvaluationRequest,
  EvaluationResponse,
  IncentiveDecision,
} from '@incentives/contracts';
import { calculateMerchandisePriceBreakdown } from '@incentives/engine';

export type DemoCustomerMode = 'new' | 'regular' | 'vip';

export interface DemoCustomer {
  mode: DemoCustomerMode;
  ref: string;
  label: string;
  description: string;
  tags: string;
  ordersCount: number;
  totalSpent: number;
}

export const DEMO_CUSTOMERS: Record<DemoCustomerMode, DemoCustomer> = {
  new: {
    mode: 'new',
    ref: 'demo_customer_new',
    label: 'New customer',
    description: 'First order · no tags',
    tags: '',
    ordersCount: 0,
    totalSpent: 0,
  },
  regular: {
    mode: 'regular',
    ref: 'demo_customer_regular',
    label: 'Regular',
    description: '3 orders · ₹4,500 lifetime',
    tags: '',
    ordersCount: 3,
    totalSpent: 450_000,
  },
  vip: {
    mode: 'vip',
    ref: 'demo_customer_vip',
    label: 'VIP',
    description: '8 orders · vip tag',
    tags: 'vip',
    ordersCount: 8,
    totalSpent: 1_200_000,
  },
};

export interface MenuItem {
  id: string;
  productRef: string;
  name: string;
  description: string;
  priceMinor: number;
  category: string;
  emoji: string;
  tag?: string;
}

export const CURRENCY = 'INR';

export const MENU: MenuItem[] = [
  {
    id: 'chole-bhature',
    productRef: 'chole-bhature',
    name: 'Classic Chole Bhature',
    description: 'Slow-cooked chole, two fluffy bhature, pickled onion.',
    priceMinor: 14_900,
    category: 'Signature',
    emoji: '🫓',
    tag: 'Bestseller',
  },
  {
    id: 'paneer-tikka',
    productRef: 'paneer-tikka',
    name: 'Paneer Tikka',
    description: 'Charred paneer, smoked spices, mint chutney.',
    priceMinor: 24_900,
    category: 'Starters',
    emoji: '🧀',
    tag: '15% off today',
  },
  {
    id: 'dal-makhani',
    productRef: 'dal-makhani',
    name: 'Dal Makhani',
    description: 'Black lentils simmered overnight with butter.',
    priceMinor: 19_900,
    category: 'Mains',
    emoji: '🥘',
  },
  {
    id: 'butter-naan',
    productRef: 'butter-naan',
    name: 'Butter Naan',
    description: 'Tandoor-fresh naan brushed with white butter.',
    priceMinor: 4_900,
    category: 'Breads',
    emoji: '🥖',
  },
  {
    id: 'masala-chai',
    productRef: 'masala-chai',
    name: 'Masala Chai',
    description: 'Cardamom, ginger, and a proper cup of chai.',
    priceMinor: 3_900,
    category: 'Drinks',
    emoji: '☕',
  },
  {
    id: 'gulab-jamun',
    productRef: 'gulab-jamun',
    name: 'Gulab Jamun',
    description: 'Two warm gulab jamun in cardamom syrup.',
    priceMinor: 7_900,
    category: 'Desserts',
    emoji: '🍮',
  },
  {
    id: 'lassi',
    productRef: 'lassi',
    name: 'Sweet Lassi',
    description: 'Thick curd, sugar, a pinch of cardamom.',
    priceMinor: 5_900,
    category: 'Drinks',
    emoji: '🥛',
  },
  {
    id: 'samosa',
    productRef: 'samosa',
    name: 'Punjabi Samosa',
    description: 'Two crisp samosas with tamarind chutney.',
    priceMinor: 6_900,
    category: 'Starters',
    emoji: '🥟',
  },
];

export function menuById(id: string): MenuItem | undefined {
  return MENU.find(item => item.id === id);
}

export function cartFromItems(
  items: readonly { itemId: string; quantity: number }[],
): Cart {
  const lines = items
    .map(item => {
      const menu = menuById(item.itemId);
      if (!menu || item.quantity <= 0) return null;
      return {
        lineRef: menu.id,
        productRef: menu.productRef,
        variantRef: `${menu.id}-regular`,
        quantity: item.quantity,
        unitPrice: menu.priceMinor,
      };
    })
    .filter((line): line is NonNullable<typeof line> => line !== null);

  return {
    currency: CURRENCY,
    subtotal: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    items: lines,
  };
}

export function requestFor(
  cart: Cart,
  customer: DemoCustomer,
  codes: readonly string[] = [],
): EvaluationRequest {
  return {
    cart,
    customerRef: customer.ref,
    codes: codes.filter(code => code.trim().length > 0),
    context: { channel: 'demo_store' },
    includeCandidateOffers: true,
    ttlSeconds: 3_600,
  };
}

interface OfferDefinition {
  programRef: string;
  name: string;
  code?: string;
  priority: number;
  qualified: (cart: Cart, customer: DemoCustomer) => boolean;
  effects: IncentiveDecision['effects'];
  progressTarget?: number;
  locked?: (customer: DemoCustomer) => boolean;
}

const AUTO_OFFERS: readonly OfferDefinition[] = [
  {
    programRef: 'vip-15',
    name: 'VIP 15% off',
    priority: 5,
    qualified: (_cart, customer) => customer.tags.split(',').includes('vip'),
    effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 1_500 }],
    locked: customer => !customer.tags.split(',').includes('vip'),
  },
  {
    programRef: 'feast-20',
    name: 'Feast 20% off',
    priority: 10,
    qualified: cart => cart.subtotal >= 49_900,
    effects: [{
      type: 'order_discount',
      calculation: 'percent',
      basisPoints: 2_000,
      maximumDiscountAmount: { currency: CURRENCY, minorUnits: 15_000 },
    }],
    progressTarget: 49_900,
  },
  {
    programRef: 'big-basket',
    name: 'Big basket ₹200 off',
    priority: 15,
    qualified: cart => cart.subtotal >= 99_900,
    effects: [{ type: 'order_discount', calculation: 'fixed', amount: { currency: CURRENCY, minorUnits: 20_000 } }],
    progressTarget: 99_900,
  },
  {
    programRef: 'free-delivery',
    name: 'Free delivery',
    priority: 20,
    qualified: cart => cart.subtotal >= 19_900,
    effects: [{ type: 'free_shipping' }],
    progressTarget: 19_900,
  },
  {
    programRef: 'paneer-15',
    name: '15% off Paneer Tikka',
    priority: 30,
    qualified: cart => cart.items.some(item => item.productRef === 'paneer-tikka'),
    effects: [{
      type: 'line_item_discount',
      productRef: 'paneer-tikka',
      calculation: 'percent',
      basisPoints: 1_500,
    }],
  },
];

const CODE_OFFERS: readonly OfferDefinition[] = [
  {
    programRef: 'welcome-50',
    name: 'Welcome ₹50 off',
    code: 'WELCOME50',
    priority: 1,
    qualified: (_cart, customer) => customer.ordersCount === 0,
    effects: [{ type: 'order_discount', calculation: 'fixed', amount: { currency: CURRENCY, minorUnits: 5_000 } }],
  },
  {
    programRef: 'feast-10-code',
    name: 'Feast 10% code',
    code: 'FEAST10',
    priority: 2,
    qualified: () => true,
    effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 1_000 }],
  },
];

function decisionFor(
  offer: OfferDefinition,
  rewardRuleRef: string,
): IncentiveDecision {
  return {
    programRef: offer.programRef,
    programRevision: 1,
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef,
    effects: offer.effects,
    reasonCodes: ['QUALIFIED'],
    commitRequired: true,
  };
}

function discountFor(
  cart: Cart,
  effects: IncentiveDecision['effects'],
): number {
  const decision: IncentiveDecision = {
    programRef: 'estimate',
    programRevision: 1,
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef: 'estimate-rule',
    effects,
    reasonCodes: ['QUALIFIED'],
    commitRequired: true,
  };
  try {
    return calculateMerchandisePriceBreakdown(cart, [decision]).totalDiscount;
  } catch {
    return 0;
  }
}

function candidateOffers(cart: Cart, customer: DemoCustomer): CandidateOffer[] {
  const offers: CandidateOffer[] = [];
  for (const offer of AUTO_OFFERS) {
    const qualified = offer.qualified(cart, customer);
    const locked = offer.locked?.(customer) ?? false;
    if (qualified) {
      offers.push({
        programRef: offer.programRef,
        name: offer.name,
        qualified: true,
        estimatedDiscountMinorUnits: discountFor(cart, offer.effects),
      });
      continue;
    }
    if (locked) {
      offers.push({
        programRef: offer.programRef,
        name: offer.name,
        qualified: false,
        estimatedDiscountMinorUnits: 0,
      });
      continue;
    }
    if (offer.progressTarget !== undefined && cart.subtotal < offer.progressTarget) {
      const targetCart: Cart = { ...cart, subtotal: offer.progressTarget };
      offers.push({
        programRef: offer.programRef,
        name: offer.name,
        qualified: false,
        estimatedDiscountMinorUnits: discountFor(targetCart, offer.effects),
        progress: {
          current: cart.subtotal,
          target: offer.progressTarget,
          shortfall: offer.progressTarget - cart.subtotal,
        },
      });
      continue;
    }
    offers.push({
      programRef: offer.programRef,
      name: offer.name,
      qualified: false,
      estimatedDiscountMinorUnits: 0,
    });
  }
  return offers;
}

export function evaluateDemo(input: {
  cart: Cart;
  customer: DemoCustomer;
  codes?: readonly string[];
}): EvaluationResponse {
  const { cart, customer } = input;
  const codes = (input.codes ?? []).map(code => code.trim().toUpperCase()).filter(Boolean);
  const decisions: IncentiveDecision[] = [];

  for (const offer of AUTO_OFFERS) {
    if (!offer.qualified(cart, customer)) continue;
    decisions.push(decisionFor(offer, `${offer.programRef}-rule`));
  }

  const codeResults: NonNullable<EvaluationResponse['codeResults']> = [];
  for (const code of codes) {
    const offer = CODE_OFFERS.find(candidate => candidate.code === code);
    if (!offer) {
      codeResults.push({
        code,
        normalizedCode: code,
        outcome: 'invalid_code',
        reasonCodes: ['INVALID_PROMO_CODE'],
      });
      continue;
    }
    if (!offer.qualified(cart, customer)) {
      codeResults.push({
        code,
        normalizedCode: code,
        outcome: 'not_qualified',
        programRef: offer.programRef,
        reasonCodes: ['CUSTOMER_NOT_QUALIFIED'],
      });
      continue;
    }
    decisions.push(decisionFor(offer, `${offer.programRef}-rule`));
    codeResults.push({
      code,
      normalizedCode: code,
      outcome: 'selected',
      programRef: offer.programRef,
      reasonCodes: ['QUALIFIED'],
    });
  }

  const deduped = decisions.filter(
    (decision, index, all) => all.findIndex(candidate => candidate.programRef === decision.programRef) === index,
  );
  const priceBreakdown = calculateMerchandisePriceBreakdown(cart, deduped);
  return {
    evaluationId: `demo_eval_${crypto.randomUUID()}`,
    customerRef: customer.ref,
    schemaVersion: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    decisions: deduped,
    priceBreakdown,
    ...(codeResults.length > 0 ? { codeResults } : {}),
    candidateOffers: candidateOffers(cart, customer),
  };
}

export function deliveryFeeMinor(
  cart: Cart,
  evaluation: EvaluationResponse,
): number {
  const free = evaluation.decisions.some(decision =>
    decision.outcome === 'qualified'
    && decision.effects.some(effect => effect.type === 'free_shipping'),
  );
  if (free) return 0;
  return cart.subtotal >= 19_900 ? 0 : 3_900;
}

export const DEMO_CODE_HINTS = [
  { code: 'WELCOME50', label: 'New customers · ₹50 off' },
  { code: 'FEAST10', label: '10% off any order' },
] as const;
