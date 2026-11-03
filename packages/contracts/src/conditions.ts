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

export type Condition = z.infer<typeof ConditionSchema>;

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;
export type ConditionValue = z.infer<typeof ConditionValueSchema>;

// Recursive interface: groups can themselves contain groups at unlimited depth.
// The runtime schema validates one level of nesting; deeper nesting is validated
// by `conditionGroupIsAuthorable()` in the dashboard which traverses recursively.
export interface ConditionGroup {
  match: 'ALL' | 'ANY';
  conditions: Condition[];
  groups?: ConditionGroup[] | undefined;
}

const ConditionGroupBase = z.object({
  match: z.enum(['ALL', 'ANY']),
  conditions: z.array(ConditionSchema),
}).strict();

function checkDuplicateConditionIds(
  data: ConditionGroup,
  _ctx: z.RefinementCtx,
): void {
  const conditions = data.conditions;
  const nestedGroups = data.groups ?? [];
  const seen = new Set<string>();

  for (const c of conditions) {
    if (seen.has(c.id)) {
      _ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate condition id: ${c.id}`,
        path: ['conditions', conditions.indexOf(c), 'id'],
      });
    }
    seen.add(c.id);
  }

  for (const ng of nestedGroups) {
    for (const c of ng.conditions) {
      if (seen.has(c.id)) {
        _ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate condition id: ${c.id}`,
          path: ['groups', nestedGroups.indexOf(ng), 'conditions', ng.conditions.indexOf(c), 'id'],
        });
      }
      seen.add(c.id);
    }
  }
}

// Export a flat schema as ZodType<ConditionGroup>. The interface handles the
// recursive type; the schema handles one level of runtime validation.
const _flatSchema = ConditionGroupBase.extend({
  groups: z.array(ConditionGroupBase).optional(),
}) as z.ZodType<ConditionGroup>;

export const ConditionGroupSchema: z.ZodType<ConditionGroup> =
  _flatSchema.superRefine(checkDuplicateConditionIds);
