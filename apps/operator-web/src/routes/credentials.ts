import {
  ApiCredentialCreateResultSchema,
  ApiCredentialViewSchema,
  OperatorCredentialCreateRequestSchema,
} from '@incentives/contracts';

import { arraySchema, requiredParam, type ProtectedRoute } from './types.js';

export const credentialRoutes: readonly ProtectedRoute[] = [
  {
    method: 'GET', pattern: /^\/operator\/v1\/credentials$/u,
    permission: 'credentials:read', responseSchema: arraySchema(ApiCredentialViewSchema),
    downstream: 'core',
    invoke: context => context.env.CORE.listCredentials(context.operator),
    validateOutput(value, context) {
      const credentials = ApiCredentialViewSchema.array().parse(value);
      if (credentials.some(item => item.merchantId !== context.operator.merchantId)) {
        throw new Error('Credential response crossed the merchant boundary');
      }
    },
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/credentials$/u,
    permission: 'credentials:manage', bodySchema: OperatorCredentialCreateRequestSchema,
    downstream: 'core',
    responseSchema: ApiCredentialCreateResultSchema, status: 201,
    invoke: context => context.env.CORE.createCredential(
      context.operator, OperatorCredentialCreateRequestSchema.parse(context.body),
    ),
    validateOutput(value, context) {
      const result = ApiCredentialCreateResultSchema.parse(value);
      if (result.credential.merchantId !== context.operator.merchantId) {
        throw new Error('Credential response crossed the merchant boundary');
      }
    },
  },
  {
    method: 'DELETE', pattern: /^\/operator\/v1\/credentials\/([^/]+)$/u,
    parameterNames: ['credentialId'], permission: 'credentials:manage',
    downstream: 'core',
    responseSchema: ApiCredentialViewSchema,
    invoke: context => context.env.CORE.revokeCredential(
      context.operator, requiredParam(context, 'credentialId'),
    ),
    validateOutput(value, context) {
      const credential = ApiCredentialViewSchema.parse(value);
      if (
        credential.merchantId !== context.operator.merchantId
        || credential.id !== requiredParam(context, 'credentialId')
      ) throw new Error('Credential response did not match its request');
    },
  },
];
