import {
  CustomerRecordSchema,
  OperatorCustomerPatchRequestSchema,
} from '@incentives/contracts';

import { requiredParam, type ProtectedRoute } from './types.js';

export const customerRoutes: readonly ProtectedRoute[] = [
  {
    method: 'GET', pattern: /^\/operator\/v1\/customers\/([^/]+)$/u,
    parameterNames: ['customerRef'], permission: 'customers:read',
    downstream: 'core',
    responseSchema: CustomerRecordSchema,
    invoke: context => context.env.CORE.getCustomer(
      context.operator, requiredParam(context, 'customerRef'),
    ),
    validateOutput(value, context) {
      if (CustomerRecordSchema.parse(value).externalRef !== requiredParam(context, 'customerRef')) {
        throw new Error('Customer response did not match its request');
      }
    },
  },
  {
    method: 'PATCH', pattern: /^\/operator\/v1\/customers\/([^/]+)$/u,
    parameterNames: ['customerRef'], permission: 'customers:manage',
    downstream: 'core',
    bodySchema: OperatorCustomerPatchRequestSchema, responseSchema: CustomerRecordSchema,
    invoke: context => context.env.CORE.upsertCustomer(
      context.operator,
      requiredParam(context, 'customerRef'),
      OperatorCustomerPatchRequestSchema.parse(context.body),
    ),
    validateOutput(value, context) {
      if (CustomerRecordSchema.parse(value).externalRef !== requiredParam(context, 'customerRef')) {
        throw new Error('Customer response did not match its request');
      }
    },
  },
];
