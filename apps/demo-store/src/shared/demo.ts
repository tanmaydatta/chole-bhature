import type {
  CandidateOffer,
  Cart,
  EvaluationRequest,
  EvaluationResponse,
  IncentiveDecision,
} from '@incentives/contracts';
import {
  calculateMerchandisePriceBreakdown,
  selectCodedDecisionCombination,
  type ConflictCandidate,
} from '@incentives/engine';

export type DemoCustomerMode = 'new' | 'regular' | 'vip';

export interface DemoCustomer {
  mode: DemoCustomerMode;
  ref: string;
  label: string;
  description: string;
  vip: boolean;
  ordersCount: number;
}

export const DEMO_CUSTOMERS: Record<DemoCustomerMode, DemoCustomer> = {
  new: {
    mode: 'new',
    ref: 'demo_customer_new',
    label: 'New customer',
    description: 'First order',
    vip: false,
    ordersCount: 0,
  },
  regular: {
    mode: 'regular',
    ref: 'demo_customer_regular',
    label: 'Regular',
    description: '3 orders',
    vip: false,
    ordersCount: 3,
  },
  vip: {
    mode: 'vip',
    ref: 'demo_customer_vip',
    label: 'VIP',
    description: 'VIP tag',
    vip: true,
    ordersCount: 8,
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
export const MAX_LINE_QUANTITY = 20;
export const DEMO_DELIVERY_FEE_MINOR = 3_900;

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

export class InvalidCartError extends Error {}

export interface CartLineInput {
  itemId: string;
  quantity: number;
}

export function cartFromItems(items: readonly CartLineInput[]): Cart {
  if (items.length === 0) throw new InvalidCartError('Cart is empty');

  const seen = new Set<string>();
  const lines = items.map(item => {
    const menu = menuById(item.itemId);
    if (!menu) throw new InvalidCartError(`Unknown menu item: ${item.itemId}`);
    if (seen.has(item.itemId)) throw new InvalidCartError(`Duplicate menu item: ${item.itemId}`);
    seen.add(item.itemId);
    if (
      !Number.isInteger(item.quantity)
      || item.quantity < 1
      || item.quantity > MAX_LINE_QUANTITY
    ) {
      throw new InvalidCartError(`Invalid quantity for ${item.itemId}`);
    }
    return {
      lineRef: menu.id,
      productRef: menu.productRef,
      variantRef: `${menu.id}-regular`,
      quantity: item.quantity,
      unitPrice: menu.priceMinor,
    };
  });

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
    includeCandidateOffers: true,
    ttlSeconds: 3_600,
  };
}

type Effects = IncentiveDecision['effects'];

interface OfferDefinition {
  programRef: string;
  name: string;
  autoApply: boolean;
  code?: string;
  /** Core sorts descending: highest priority qualified auto offer wins. */
  priority: number;
  stackable: boolean;
  qualified: (cart: Cart, customer: DemoCustomer) => boolean;
  effects: Effects;
  progressTarget?: number;
  locked?: (customer: DemoCustomer) => boolean;
}

export const AUTO_OFFERS: readonly OfferDefinition[] = [
  {
    // ₹200 beats the 20% cap of ₹150 once the basket reaches ₹999.
    programRef: 'big-basket',
    name: 'Big basket ₹200 off',
    autoApply: true,
    priority: 110,
    stackable: false,
    qualified: cart => cart.subtotal >= 99_900,
    effects: [{
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: CURRENCY, minorUnits: 20_000 },
    }],
    progressTarget: 99_900,
  },
  {
    programRef: 'feast-20',
    name: 'Feast 20% off',
    autoApply: true,
    priority: 100,
    stackable: false,
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
    programRef: 'vip-15',
    name: 'VIP 15% off',
    autoApply: true,
    priority: 90,
    stackable: false,
    qualified: (_cart, customer) => customer.vip,
    effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 1_500 }],
    locked: customer => !customer.vip,
  },
  {
    programRef: 'paneer-15',
    name: '15% off Paneer Tikka',
    autoApply: true,
    priority: 80,
    stackable: false,
    qualified: cart => cart.items.some(item => item.productRef === 'paneer-tikka'),
    effects: [{
      type: 'line_item_discount',
      productRef: 'paneer-tikka',
      calculation: 'percent',
      basisPoints: 1_500,
    }],
  },
  {
    programRef: 'free-delivery',
    name: 'Free delivery',
    autoApply: true,
    priority: 10,
    stackable: false,
    qualified: cart => cart.subtotal >= 19_900,
    effects: [{ type: 'free_shipping' }],
    progressTarget: 19_900,
  },
];

export const CODE_OFFERS: readonly OfferDefinition[] = [
  {
    programRef: 'welcome-50',
    name: 'Welcome ₹50 off',
    autoApply: false,
    code: 'WELCOME50',
    priority: 50,
    stackable: true,
    qualified: (_cart, customer) => customer.ordersCount === 0,
    effects: [{
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: CURRENCY, minorUnits: 5_000 },
    }],
  },
  {
    programRef: 'feast-10-code',
    name: 'Feast 10% code',
    autoApply: false,
    code: 'FEAST10',
    priority: 40,
    stackable: true,
    qualified: () => true,
    effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 1_000 }],
  },
];

/** Shared with the UI so offer names never fall back to raw program refs. */
export const OFFER_NAMES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    [...AUTO_OFFERS, ...CODE_OFFERS].map(offer => [offer.programRef, offer.name]),
  ),
);

const ALL_OFFERS = [...AUTO_OFFERS, ...CODE_OFFERS];

function offerByRef(programRef: string): OfferDefinition | undefined {
  return ALL_OFFERS.find(offer => offer.programRef === programRef);
}

function compareOfferRank(left: OfferDefinition, right: OfferDefinition): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.programRef < right.programRef) return -1;
  if (left.programRef > right.programRef) return 1;
  return 0;
}

function decisionFor(offer: OfferDefinition): IncentiveDecision {
  return {
    programRef: offer.programRef,
    programRevision: 1,
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef: `${offer.programRef}-rule`,
    effects: offer.effects,
    reasonCodes: ['QUALIFIED'],
    commitRequired: true,
  };
}

function conflictCandidate(offer: OfferDefinition): ConflictCandidate {
  return {
    ...decisionFor(offer),
    programType: 'promo',
    priority: offer.priority,
    stackable: offer.stackable,
  };
}

function stripRanking(candidate: ConflictCandidate): IncentiveDecision {
  const {
    priority: _priority,
    stackable: _stackable,
    ...decision
  } = candidate;
  return decision;
}

function discountFor(cart: Cart, effects: Effects): number {
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
  return AUTO_OFFERS.map(offer => {
    if (offer.qualified(cart, customer)) {
      return {
        programRef: offer.programRef,
        name: offer.name,
        qualified: true,
        estimatedDiscountMinorUnits: discountFor(cart, offer.effects),
      };
    }
    if (offer.locked?.(customer) ?? false) {
      return {
        programRef: offer.programRef,
        name: offer.name,
        qualified: false,
        estimatedDiscountMinorUnits: 0,
      };
    }
    if (offer.progressTarget !== undefined && cart.subtotal < offer.progressTarget) {
      const targetCart: Cart = { ...cart, subtotal: offer.progressTarget };
      return {
        programRef: offer.programRef,
        name: offer.name,
        qualified: false,
        estimatedDiscountMinorUnits: discountFor(targetCart, offer.effects),
        progress: {
          current: cart.subtotal,
          target: offer.progressTarget,
          shortfall: offer.progressTarget - cart.subtotal,
        },
      };
    }
    return {
      programRef: offer.programRef,
      name: offer.name,
      qualified: false,
      estimatedDiscountMinorUnits: 0,
    };
  });
}

interface CodeOutcome {
  code: string;
  normalizedCode: string;
  outcome: 'selected' | 'invalid_code' | 'not_qualified' | 'combination_rejected';
  programRef?: string;
  reasonCodes: string[];
}

export function evaluateDemo(input: {
  cart: Cart;
  customer: DemoCustomer;
  codes?: readonly string[];
}): EvaluationResponse {
  const { cart, customer } = input;
  const codes = [...new Set(
    (input.codes ?? []).map(code => code.trim().toUpperCase()).filter(Boolean),
  )];
  const candidateOffersForCart = candidateOffers(cart, customer);

  let decisions: IncentiveDecision[] = [];
  let codeResults: CodeOutcome[] = [];

  if (codes.length === 0) {
    // Core automatic mode: exactly one qualified auto-apply offer, highest priority first.
    const winner = AUTO_OFFERS
      .filter(offer => offer.qualified(cart, customer))
      .sort(compareOfferRank)[0];
    if (winner) decisions = [decisionFor(winner)];
  } else {
    // Core coded mode: only coded programs compete; auto offers are paused.
    const evaluated = codes.map(code => {
      const offer = CODE_OFFERS.find(candidate => candidate.code === code);
      if (!offer) return { code, offer: null, qualified: false };
      return { code, offer, qualified: offer.qualified(cart, customer) };
    });
    const qualified = evaluated.flatMap(entry => (
      entry.qualified && entry.offer ? [entry.offer] : []
    ));
    const selection = selectCodedDecisionCombination(
      qualified.map(conflictCandidate),
    );
    const rejected = new Set(selection.rejectedProgramRefs);
    decisions = selection.decisions.map(stripRanking);
    codeResults = evaluated.map(entry => {
      if (entry.offer === null) {
        return {
          code: entry.code,
          normalizedCode: entry.code,
          outcome: 'invalid_code',
          reasonCodes: ['INVALID_PROMO_CODE'],
        };
      }
      if (!entry.qualified) {
        return {
          code: entry.code,
          normalizedCode: entry.code,
          outcome: 'not_qualified',
          programRef: entry.offer.programRef,
          reasonCodes: ['CUSTOMER_NOT_QUALIFIED'],
        };
      }
      if (rejected.has(entry.offer.programRef)) {
        return {
          code: entry.code,
          normalizedCode: entry.code,
          outcome: 'combination_rejected',
          programRef: entry.offer.programRef,
          reasonCodes: ['COMBINATION_REJECTED'],
        };
      }
      return {
        code: entry.code,
        normalizedCode: entry.code,
        outcome: 'selected',
        programRef: entry.offer.programRef,
        reasonCodes: ['QUALIFIED'],
      };
    });
  }

  return {
    evaluationId: `demo_eval_${crypto.randomUUID()}`,
    customerRef: customer.ref,
    schemaVersion: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    decisions,
    priceBreakdown: calculateMerchandisePriceBreakdown(cart, decisions),
    codeResults,
    candidateOffers: candidateOffersForCart,
  };
}

/**
 * Delivery is only waived when the platform returned a qualified `free_shipping`
 * decision. A code replaces auto offers, so applying a code can bring the fee back.
 */
export function deliveryFeeMinor(evaluation: EvaluationResponse): number {
  const freeShipping = evaluation.decisions.some(decision => (
    decision.outcome === 'qualified'
    && decision.effects.some(effect => effect.type === 'free_shipping')
  ));
  return freeShipping ? 0 : DEMO_DELIVERY_FEE_MINOR;
}

export function offerName(programRef: string): string {
  return OFFER_NAMES[programRef] ?? offerByRef(programRef)?.name ?? programRef;
}

export const DEMO_CODE_HINTS = [
  { code: 'WELCOME50', label: 'New customers · ₹50 off' },
  { code: 'FEAST10', label: '10% off, replaces auto offers' },
] as const;
