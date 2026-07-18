import { z } from './zod.js';

export const VariableSourceSchema = z.enum([
  'customer',
  'context',
  'cart',
  'line_item',
  'event',
  'system',
]);

export const VariableTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'date',
]);

export const VariableDefinitionSchema = z.object({
  key: z.string().regex(/^(customer|context|cart|line_item|event|system)\.[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  source: VariableSourceSchema,
  type: VariableTypeSchema,
  required: z.boolean(),
  enumValues: z.array(z.string().min(1)).min(1).optional(),
  description: z.string().max(500).optional(),
  defaultErrorMessage: z.string().max(500).optional(),
}).strict().superRefine((definition, context) => {
  if (definition.key.split('.')[0] !== definition.source) {
    context.addIssue({
      code: 'custom',
      path: ['key'],
      message: 'key namespace must match source',
    });
  }
  if (definition.type === 'enum' && !definition.enumValues) {
    context.addIssue({
      code: 'custom',
      path: ['enumValues'],
      message: 'enum fields require enumValues',
    });
  }
  if (definition.type !== 'enum' && definition.enumValues) {
    context.addIssue({
      code: 'custom',
      path: ['enumValues'],
      message: 'enumValues are only valid for enum fields',
    });
  }
});

export type VariableSource = z.infer<typeof VariableSourceSchema>;
export type VariableType = z.infer<typeof VariableTypeSchema>;
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;

const extensionSources = ['context', 'cart', 'line_item'] as const;

function schemaForDefinition(definition: VariableDefinition): z.ZodType {
  switch (definition.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'enum':
      return z.enum(definition.enumValues as [string, ...string[]]);
    case 'date':
      return z.iso.date();
  }
}

export function buildPublishedEvaluationJsonSchema(
  definitions: readonly VariableDefinition[],
): Record<string, unknown> {
  const parsedDefinitions = z.array(VariableDefinitionSchema).parse(definitions);
  const rootShape: Record<string, z.ZodType> = {};

  for (const source of extensionSources) {
    const sourceShape: Record<string, z.ZodType> = {};
    let sourceIsRequired = false;
    for (const definition of parsedDefinitions) {
      if (definition.source !== source) continue;

      const fieldName = definition.key.slice(source.length + 1);
      const fieldSchema = schemaForDefinition(definition);
      sourceShape[fieldName] = definition.required ? fieldSchema : fieldSchema.optional();
      sourceIsRequired ||= definition.required;
    }
    const sourceSchema = z.object(sourceShape).strict();
    rootShape[source] = sourceIsRequired ? sourceSchema : sourceSchema.optional();
  }

  return z.toJSONSchema(z.object(rootShape).strict(), { target: 'draft-2020-12' });
}
