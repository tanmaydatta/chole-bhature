import { describe, expect, test } from 'vitest';

import {
  CustomerSnapshotSchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
  VariableDefinitionSchema,
  buildPublishedEvaluationJsonSchema,
} from './index.js';
import {
  canonicalCustomer,
  canonicalDecision,
  canonicalEvaluationRequest,
  canonicalVariableDefinitions,
} from '../test-fixtures/documentation-examples.js';

describe('core contract documentation examples', () => {
  test('remain valid against the public canonical schemas', () => {
    expect(CustomerSnapshotSchema.parse(canonicalCustomer)).toEqual(canonicalCustomer);
    expect(EvaluationRequestSchema.parse(canonicalEvaluationRequest)).toEqual(
      canonicalEvaluationRequest,
    );
    expect(IncentiveDecisionSchema.parse(canonicalDecision)).toEqual(canonicalDecision);
    expect(canonicalVariableDefinitions.map(definition => (
      VariableDefinitionSchema.parse(definition)
    ))).toEqual(canonicalVariableDefinitions);
  });

  test('produce a strict published request schema from the documented definitions', () => {
    const schema = buildPublishedEvaluationJsonSchema(canonicalVariableDefinitions);

    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['cart', 'context'],
    });
  });
});
