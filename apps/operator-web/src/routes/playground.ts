import { EvaluationRequestSchema, EvaluationResponseSchema } from '@incentives/contracts';

import type { ProtectedRoute } from './types.js';

export const playgroundRoutes: readonly ProtectedRoute[] = [{
  method: 'POST', pattern: /^\/operator\/v1\/playground\/evaluate$/u,
  permission: 'evaluations:run', downstream: 'core',
  bodySchema: EvaluationRequestSchema, responseSchema: EvaluationResponseSchema,
  invoke: context => context.env.CORE.evaluate(
    context.operator, EvaluationRequestSchema.parse(context.body),
  ),
  validateOutput(value, context) {
    const output = EvaluationResponseSchema.parse(value);
    const input = EvaluationRequestSchema.parse(context.body);
    if (output.customerRef !== input.customerRef
      || output.priceBreakdown.currency !== input.cart.currency
      || output.priceBreakdown.originalMerchandiseSubtotal !== input.cart.subtotal) {
      throw new Error('Evaluation response did not match its request');
    }
  },
}];
