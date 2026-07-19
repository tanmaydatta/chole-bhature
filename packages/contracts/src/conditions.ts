import { z } from './zod.js';

export const ConditionOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'between',
  'is',
]);

export const ConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

export const ConditionSchema = z.object({
  id: z.string().min(1),
  variable: z.string().regex(/^(customer|context|cart|line_item|event|system)\.[a-z][a-z0-9_]*$/),
  operator: ConditionOperatorSchema,
  value: ConditionValueSchema,
  message: z.string().max(500).optional(),
}).strict();

const NestedConditionGroupSchema = z.object({
  match: z.enum(['ALL', 'ANY']),
  conditions: z.array(ConditionSchema),
}).strict();

export const ConditionGroupSchema = z.object({
  match: z.enum(['ALL', 'ANY']),
  conditions: z.array(ConditionSchema),
  groups: z.array(NestedConditionGroupSchema).optional(),
}).strict().superRefine((group, context) => {
  const seenIds = new Set<string>();
  const conditions = [
    ...group.conditions.map((condition, index) => ({
      condition,
      path: ['conditions', index, 'id'] as Array<string | number>,
    })),
    ...(group.groups ?? []).flatMap((nested, groupIndex) => (
      nested.conditions.map((condition, conditionIndex) => ({
        condition,
        path: ['groups', groupIndex, 'conditions', conditionIndex, 'id'] as Array<string | number>,
      }))
    )),
  ];

  for (const { condition, path } of conditions) {
    if (seenIds.has(condition.id)) {
      context.addIssue({
        code: 'custom',
        path,
        message: `duplicate condition id: ${condition.id}`,
      });
    }
    seenIds.add(condition.id);
  }
});

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;
export type ConditionValue = z.infer<typeof ConditionValueSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ConditionGroup = z.infer<typeof ConditionGroupSchema>;
