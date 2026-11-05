import { describe, expect, it } from 'vitest';
import type { ConditionGroup } from '@incentives/contracts';
import type { Variable } from '../../lib/types';
import {
  conditionGroupToRuleGroup,
  ruleGroupToConditionGroup,
  variablesToFields,
} from './rqb-adapter';
import type { RuleGroupType } from 'react-querybuilder';

const SAMPLE_VARIABLES: Variable[] = [
  {
    name: 'cart.subtotal',
    type: 'number',
    origin: 'dynamic',
    defaultMessage: 'Subtotal must meet minimum.',
  },
  {
    name: 'customer.tier',
    type: 'enum',
    origin: 'user',
    enumValues: ['gold', 'silver', 'bronze'],
  },
  {
    name: 'customer.is_vip',
    type: 'boolean',
    origin: 'user',
  },
  {
    name: 'system.budget',
    type: 'number',
    origin: 'system',
  },
  {
    name: 'context.channel',
    type: 'string',
    origin: 'dynamic',
  },
];

describe('rqb-adapter', () => {
  describe('conditionGroupToRuleGroup', () => {
    it('converts ALL to and, ANY to or', () => {
      const allGroup: ConditionGroup = { match: 'ALL', conditions: [] };
      const anyGroup: ConditionGroup = { match: 'ANY', conditions: [] };

      expect(conditionGroupToRuleGroup(allGroup).combinator).toBe('and');
      expect(conditionGroupToRuleGroup(anyGroup).combinator).toBe('or');
    });

    it('maps leaf conditions and nested groups with stable IDs and message fields', () => {
      const group: ConditionGroup = {
        match: 'ALL',
        conditions: [
          {
            id: 'cond-1',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 50,
            message: 'Spend {{ 50 - cart.subtotal }} more',
          },
        ],
        groups: [
          {
            match: 'ANY',
            conditions: [
              {
                id: 'cond-2',
                variable: 'customer.tier',
                operator: 'eq',
                value: 'gold',
              },
            ],
          },
        ],
      };

      const result = conditionGroupToRuleGroup(group);
      expect(result.combinator).toBe('and');
      expect(result.rules).toHaveLength(2);

      // Leaf rule
      const rule = result.rules[0] as any;
      expect(rule.id).toBe('cond-1');
      expect(rule.field).toBe('cart.subtotal');
      expect(rule.operator).toBe('gte');
      expect(rule.value).toBe(50);
      expect(rule.message).toBe('Spend {{ 50 - cart.subtotal }} more');

      // Sub-group
      const subGroup = result.rules[1] as RuleGroupType;
      expect(subGroup.combinator).toBe('or');
      expect(subGroup.rules).toHaveLength(1);
      const subRule = subGroup.rules[0] as any;
      expect(subRule.id).toBe('cond-2');
      expect(subRule.field).toBe('customer.tier');
    });
  });

  describe('ruleGroupToConditionGroup', () => {
    it('maps and to ALL, or to ANY', () => {
      const andRg: RuleGroupType = { combinator: 'and', rules: [] };
      const orRg: RuleGroupType = { combinator: 'or', rules: [] };

      expect(ruleGroupToConditionGroup(andRg).match).toBe('ALL');
      expect(ruleGroupToConditionGroup(orRg).match).toBe('ANY');
    });

    it('partitions rules into leaf conditions and nested groups', () => {
      const rg: RuleGroupType = {
        combinator: 'and',
        rules: [
          {
            id: 'r-1',
            field: 'customer.tier',
            operator: 'eq',
            value: 'silver',
          },
          {
            combinator: 'or',
            rules: [
              {
                id: 'r-2',
                field: 'system.budget',
                operator: 'gt',
                value: 100,
              },
            ],
          },
        ],
      };

      const group = ruleGroupToConditionGroup(rg, SAMPLE_VARIABLES);
      expect(group.match).toBe('ALL');
      expect(group.conditions).toHaveLength(1);
      expect(group.conditions[0]).toEqual({
        id: 'r-1',
        variable: 'customer.tier',
        operator: 'eq',
        value: 'silver',
      });

      expect(group.groups).toHaveLength(1);
      expect(group.groups?.[0]?.match).toBe('ANY');
      expect(group.groups?.[0]?.conditions).toHaveLength(1);
      expect(group.groups?.[0]?.conditions[0]?.id).toBe('r-2');
    });

    it('does not emit empty groups array on nested groups so that strict Zod schemas pass', () => {
      const rg: RuleGroupType = {
        combinator: 'and',
        rules: [
          {
            combinator: 'or',
            rules: [
              {
                id: 'r-1',
                field: 'customer.tier',
                operator: 'eq',
                value: 'silver',
              },
            ],
          },
        ],
      };

      const group = ruleGroupToConditionGroup(rg, SAMPLE_VARIABLES);
      expect(group.groups?.[0]).not.toHaveProperty('groups');
    });

    it('coerces numeric strings to numbers for number-typed variables', () => {
      const rg: RuleGroupType = {
        combinator: 'and',
        rules: [
          {
            id: 'num-1',
            field: 'cart.subtotal',
            operator: 'gte',
            value: '125.5',
          },
        ],
      };

      const group = ruleGroupToConditionGroup(rg, SAMPLE_VARIABLES);
      expect(group.conditions[0].value).toBe(125.5);
    });

    it('coerces between and in values according to variable types', () => {
      const rg: RuleGroupType = {
        combinator: 'and',
        rules: [
          {
            id: 'between-1',
            field: 'cart.subtotal',
            operator: 'between',
            value: ['10', '20'],
          },
          {
            id: 'in-1',
            field: 'customer.tier',
            operator: 'in',
            value: ['gold', 'silver'],
          },
        ],
      };

      const group = ruleGroupToConditionGroup(rg, SAMPLE_VARIABLES);
      expect(group.conditions[0].value).toEqual([10, 20]);
      expect(group.conditions[1].value).toEqual(['gold', 'silver']);
    });
  });

  describe('variablesToFields', () => {
    it('creates fields with origin metadata, type mapping, and permitted operators', () => {
      const fields = variablesToFields(SAMPLE_VARIABLES);
      expect(fields).toHaveLength(SAMPLE_VARIABLES.length);

      const cartField = fields.find((f) => f.name === 'cart.subtotal');
      expect(cartField).toBeDefined();
      expect(cartField?.label).toBe('cart.subtotal');
      expect(cartField?.inputType).toBe('number');
      expect((cartField as any)?.origin).toBe('dynamic');

      const tierField = fields.find((f) => f.name === 'customer.tier');
      expect(tierField).toBeDefined();
      expect(tierField?.values).toEqual([
        { name: 'gold', label: 'gold' },
        { name: 'silver', label: 'silver' },
        { name: 'bronze', label: 'bronze' },
      ]);
    });
  });
});
