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
// The runtime schema validates one level; deeper nesting is validated
// by `conditionGroupIsAuthorable()` in the dashboard which traverses recursively.
export interface ConditionGroup {
  match: 'ALL' | 'ANY';
  conditions: Condition[];
  groups?: ConditionGroup[] | undefined;
}

const _ConditionGroupShape = {
  match: z.enum(['ALL', 'ANY']),
  conditions: z.array(ConditionSchema),
};

// Use `any` for the schema variable to satisfy the recursive type reference,
// then cast to ZodType<ConditionGroup>. This is a known pattern for recursive
// Zod schemas when strict mode prevents z.lazy() type inference.
const _ConditionGroupSchemaRaw: any = z.object({
  ..._ConditionGroupShape,
  groups: z.lazy(() => _ConditionGroupSchemaRaw.array()).optional(),
}).strict();

export const ConditionGroupSchema: z.ZodType<ConditionGroup> = _ConditionGroupSchemaRaw;
