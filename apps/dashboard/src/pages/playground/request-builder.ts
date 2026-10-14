import { EvaluationRequestSchema, VariableDefinitionSchema, type EvaluationRequest, type VariableDefinition } from '@incentives/contracts';

export interface BasketLineInput {
  lineRef: string;
  productRef: string;
  quantity: string;
  unitPrice: string;
  extensions: Record<string, string>;
}
export interface PlaygroundInput {
  currency: string;
  customerRef: string;
  codes: string;
  lines: BasketLineInput[];
  context: Record<string, string>;
  cart: Record<string, string>;
}
function integer(value: string, label: string, positive = false): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${label} must be an integer in minor units where applicable.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'nonnegative'} safe integer.`);
  }
  return number;
}

function typedValue(definition: VariableDefinition, value: string): unknown {
  switch (definition.type) {
    case 'number': {
      const number = Number(value);
      if (value.trim() === '' || !Number.isFinite(number)) throw new Error(`${definition.label} must be a finite number.`);
      return number;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') throw new Error(`${definition.label} must be true or false.`);
      return value === 'true';
    case 'enum':
      if (!definition.enumValues?.includes(value)) throw new Error(`${definition.label} must use a published choice.`);
      return value;
    case 'date': {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error(`${definition.label} must be a valid YYYY-MM-DD date.`);
      }
      return value;
    }
    case 'string': return value;
  }
}

function extensions(source: 'context' | 'cart' | 'line_item', values: Record<string, string>, definitions: readonly VariableDefinition[]) {
  const fields = definitions.filter(definition => definition.source === source);
  const names = fields.map(definition => definition.key.slice(source.length + 1));
  if (Object.keys(values).some(key => !names.includes(key))) throw new Error(`Use only published ${source} fields.`);
  const result: Record<string, unknown> = {};
  for (const definition of fields) {
    const name = definition.key.slice(source.length + 1);
    const value = values[name] ?? '';
    if (value === '') {
      if (definition.required) throw new Error(`${definition.label} is required.`);
      continue;
    }
    result[name] = typedValue(definition, value);
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

export function buildEvaluationRequest(input: PlaygroundInput, definitions: readonly VariableDefinition[]): EvaluationRequest {
  const published = definitions.map(definition => VariableDefinitionSchema.parse(definition));
  const context = extensions('context', input.context, published);
  const attributes = extensions('cart', input.cart, published);
  const items = input.lines.map((line, index) => {
    const lineAttributes = extensions('line_item', line.extensions, published);
    return {
      lineRef: line.lineRef, productRef: line.productRef,
      quantity: integer(line.quantity, `Quantity ${index + 1}`, true),
      unitPrice: integer(line.unitPrice, `Unit price ${index + 1}`),
      ...(lineAttributes === undefined ? {} : { attributes: lineAttributes }),
    };
  });
  const subtotal = items.reduce((sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPrice), 0n);
  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Merchandise subtotal exceeds the safe minor-unit range.');
  const codes = input.codes.split(/[,\n]/u).map(code => code.trim()).filter(Boolean);
  const result = EvaluationRequestSchema.safeParse({
    ...(input.customerRef === '' ? {} : { customerRef: input.customerRef }),
    ...(codes.length === 0 ? {} : { codes }),
    cart: { currency: input.currency, subtotal: Number(subtotal), items,
      ...(attributes === undefined ? {} : { attributes }) },
    ...(context === undefined ? {} : { context }),
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${issue?.path.join('.') ?? 'Basket'}: ${issue?.message ?? 'Invalid evaluation request'}`);
  }
  return result.data;
}
