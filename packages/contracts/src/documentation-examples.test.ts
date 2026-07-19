import { describe, expect, test } from 'vitest';

import {
  ApiErrorSchema,
  CustomerPatchRequestSchema,
  CustomerSnapshotSchema,
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  IncentiveDecisionSchema,
  PromoProgramSchema,
  RedemptionRequestSchema,
  RedemptionResponseSchema,
  VariableDefinitionSchema,
  buildPublishedEvaluationJsonSchema,
} from './index.js';
import {
  canonicalApiError,
  canonicalCommittedRedemption,
  canonicalCustomer,
  canonicalCustomerPatch,
  canonicalDecision,
  canonicalEvaluationRequest,
  canonicalFallbackResponse,
  canonicalFirstMatchResponse,
  canonicalNoMatchResponse,
  canonicalRedemptionRequest,
  canonicalTwoTierEvaluationRequest,
  canonicalTwoTierPromo,
  canonicalVariableDefinitions,
  canonicalVersionedCustomerPatch,
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

  test('validates every runtime API JSON example against its public schema', () => {
    expect(CustomerPatchRequestSchema.parse(canonicalCustomerPatch))
      .toEqual(canonicalCustomerPatch);
    expect(CustomerPatchRequestSchema.parse(canonicalVersionedCustomerPatch))
      .toEqual(canonicalVersionedCustomerPatch);
    expect(PromoProgramSchema.parse(canonicalTwoTierPromo)).toEqual(canonicalTwoTierPromo);
    expect(EvaluationRequestSchema.parse(canonicalTwoTierEvaluationRequest))
      .toEqual(canonicalTwoTierEvaluationRequest);
    expect(EvaluationResponseSchema.parse(canonicalFirstMatchResponse))
      .toEqual(canonicalFirstMatchResponse);
    expect(EvaluationResponseSchema.parse(canonicalFallbackResponse))
      .toEqual(canonicalFallbackResponse);
    expect(EvaluationResponseSchema.parse(canonicalNoMatchResponse))
      .toEqual(canonicalNoMatchResponse);
    expect(RedemptionRequestSchema.parse(canonicalRedemptionRequest))
      .toEqual(canonicalRedemptionRequest);
    expect(RedemptionResponseSchema.parse(canonicalCommittedRedemption))
      .toEqual(canonicalCommittedRedemption);
    expect(ApiErrorSchema.parse(canonicalApiError)).toEqual(canonicalApiError);
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
