import { describe, expect, it } from 'vitest';
import {
  PromoProgramSchema,
  VariableDefinitionSchema,
  type Cart,
} from '@incentives/contracts';
import fixture from '../seed/fixture.json';
import {
  AUTO_OFFERS,
  CODE_OFFERS,
  DEMO_CUSTOMERS,
  OFFER_NAMES,
  cartFromItems,
  type DemoCustomerMode,
} from '../src/shared/demo.js';

const ALL_OFFERS = [...AUTO_OFFERS, ...CODE_OFFERS];

const EXPECTED_ELIGIBILITY: Record<string, {
  variable: string;
  operator: string;
  value: unknown;
}> = {
  'big-basket': { variable: 'cart.subtotal', operator: 'gte', value: 99_900 },
  'feast-20': { variable: 'cart.subtotal', operator: 'gte', value: 49_900 },
  'vip-15': { variable: 'customer.is_vip', operator: 'eq', value: true },
  'paneer-15': { variable: 'line_item.product_ref', operator: 'eq', value: 'paneer-tikka' },
  'free-delivery': { variable: 'cart.subtotal', operator: 'gte', value: 19_900 },
  'welcome-50': { variable: 'customer.orders_count', operator: 'eq', value: 0 },
  'feast-10-code': { variable: 'cart.subtotal', operator: 'gte', value: 0 },
};

const CUSTOMER_MODE_BY_REF: Record<string, DemoCustomerMode> = {
  demo_customer_new: 'new',
  demo_customer_regular: 'regular',
  demo_customer_vip: 'vip',
};

function emptyCart(subtotal: number): Cart {
  return { currency: 'INR', subtotal, items: [] };
}

function localOffer(programRef: string) {
  const offer = ALL_OFFERS.find(candidate => candidate.programRef === programRef);
  if (!offer) throw new Error(`Missing local offer ${programRef}`);
  return offer;
}

describe('demo seed fixture', () => {
  it('contains valid variable definitions', () => {
    for (const variable of fixture.variables) {
      const parsed = VariableDefinitionSchema.safeParse(variable);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('contains valid promo programs', () => {
    for (const program of fixture.programs) {
      const parsed = PromoProgramSchema.safeParse(program);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('matches the offer table the local evaluator uses', () => {
    expect(fixture.programs.map(program => program.id).sort())
      .toEqual(Object.keys(OFFER_NAMES).sort());

    for (const program of fixture.programs) {
      const offer = localOffer(program.id);

      expect(program.priority).toBe(offer.priority);
      expect(program.autoApply).toBe(offer.autoApply);
      expect(program.stackable).toBe(offer.stackable);
      expect((program as { code?: string }).code).toBe(offer.code);

      // Effects come from the fixture, so a basis-point or cap change cannot
      // silently diverge from the seeded tenant.
      expect(program.rewardRules).toHaveLength(1);
      expect(offer.effects).toEqual([program.rewardRules[0]?.reward]);

      // Eligibility is compared field-by-field, then exercised at the boundary.
      expect(program.eligibility.match).toBe('ALL');
      expect(program.eligibility.conditions).toHaveLength(1);
      expect(program.eligibility.conditions[0]).toMatchObject(
        EXPECTED_ELIGIBILITY[program.id] ?? {},
      );
    }
  });

  it('keeps threshold offers aligned with the local predicates', () => {
    const thresholds: Array<[string, number]> = [
      ['big-basket', 99_900],
      ['feast-20', 49_900],
      ['free-delivery', 19_900],
    ];
    for (const [programRef, target] of thresholds) {
      const offer = localOffer(programRef);
      expect(offer.progressTarget).toBe(target);
      expect(offer.qualified(emptyCart(target - 1), DEMO_CUSTOMERS.new)).toBe(false);
      expect(offer.qualified(emptyCart(target), DEMO_CUSTOMERS.new)).toBe(true);
    }
  });

  it('keeps customer and line-item targeting aligned with the local predicates', () => {
    const vip = localOffer('vip-15');
    expect(vip.qualified(emptyCart(1), DEMO_CUSTOMERS.vip)).toBe(true);
    expect(vip.qualified(emptyCart(1), DEMO_CUSTOMERS.regular)).toBe(false);

    const paneer = localOffer('paneer-15');
    expect(paneer.qualified(
      cartFromItems([{ itemId: 'paneer-tikka', quantity: 1 }]),
      DEMO_CUSTOMERS.new,
    )).toBe(true);
    expect(paneer.qualified(
      cartFromItems([{ itemId: 'chole-bhature', quantity: 1 }]),
      DEMO_CUSTOMERS.new,
    )).toBe(false);

    const welcome = localOffer('welcome-50');
    expect(welcome.qualified(emptyCart(1), DEMO_CUSTOMERS.new)).toBe(true);
    expect(welcome.qualified(emptyCart(1), DEMO_CUSTOMERS.regular)).toBe(false);
  });

  it('seeds the three demo customer profiles referenced by the storefront', () => {
    expect(fixture.customers.map(customer => customer.ref).sort()).toEqual([
      'demo_customer_new',
      'demo_customer_regular',
      'demo_customer_vip',
    ]);

    for (const customer of fixture.customers) {
      const mode = CUSTOMER_MODE_BY_REF[customer.ref];
      expect(mode, customer.ref).toBeDefined();
      const local = DEMO_CUSTOMERS[mode as DemoCustomerMode];
      expect(customer.attributes.orders_count).toBe(local.ordersCount);
      expect(customer.attributes.is_vip).toBe(local.vip);
    }
  });
});
