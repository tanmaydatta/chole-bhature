import { z } from './zod.js';
import {
  CartLineItemSchema,
  CartSchema,
  EvaluationRequestSchema,
} from './evaluation.js';

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

const PublishedVariableDefinitionsSchema = z.array(VariableDefinitionSchema).superRefine(
  (definitions, context) => {
    const seenKeys = new Set<string>();
    definitions.forEach((definition, index) => {
      if (seenKeys.has(definition.key)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `duplicate variable key: ${definition.key}`,
        });
      }
      seenKeys.add(definition.key);
    });
  },
);

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
  const parsedDefinitions = PublishedVariableDefinitionsSchema.parse(definitions);

  function extensionSchemaFor(source: 'context' | 'cart' | 'line_item') {
    const sourceShape: Record<string, z.ZodType> = {};
    let sourceIsRequired = false;
    for (const definition of parsedDefinitions) {
      if (definition.source !== source) continue;

      const fieldName = definition.key.slice(source.length + 1);
      const fieldSchema = schemaForDefinition(definition);
      sourceShape[fieldName] = definition.required ? fieldSchema : fieldSchema.optional();
      sourceIsRequired ||= definition.required;
    }

    return {
      required: sourceIsRequired,
      schema: z.object(sourceShape).strict(),
    };
  }

  const contextExtensions = extensionSchemaFor('context');
  const cartExtensions = extensionSchemaFor('cart');
  const lineItemExtensions = extensionSchemaFor('line_item');

  const lineItemSchema = CartLineItemSchema.extend({
    attributes: lineItemExtensions.required
      ? lineItemExtensions.schema
      : lineItemExtensions.schema.optional(),
  });
  const cartSchema = CartSchema.extend({
    items: z.array(lineItemSchema),
    attributes: cartExtensions.required
      ? cartExtensions.schema
      : cartExtensions.schema.optional(),
  });
  const evaluationRequestSchema = EvaluationRequestSchema.extend({
    cart: cartSchema,
    context: contextExtensions.required
      ? contextExtensions.schema
      : contextExtensions.schema.optional(),
  });

  return z.toJSONSchema(evaluationRequestSchema, { target: 'draft-2020-12' });
}
