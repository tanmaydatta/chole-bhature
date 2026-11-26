import { describe, expect, it } from 'vitest';
import { PromoProgramSchema, VariableDefinitionSchema } from '@incentives/contracts';
import fixture from '../seed/fixture.json';
import {
  AUTO_OFFERS,
  CODE_OFFERS,
  OFFER_NAMES,
} from '../src/shared/demo.js';

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
      const offer = [...AUTO_OFFERS, ...CODE_OFFERS]
        .find(candidate => candidate.programRef === program.id);
      expect(offer, program.id).toBeDefined();
      expect(program.priority).toBe(offer?.priority);
      expect(program.autoApply).toBe(offer?.autoApply);
      expect((program as { code?: string }).code).toBe(offer?.code);
    }
  });

  it('seeds the three demo customer profiles referenced by the storefront', () => {
    expect(fixture.customers.map(customer => customer.ref).sort()).toEqual([
      'demo_customer_new',
      'demo_customer_regular',
      'demo_customer_vip',
    ]);
  });
});
