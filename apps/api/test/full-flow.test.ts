import {
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  buildOpenApiDocument,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

const secretHeaders = {
  authorization: 'Bearer secret-test',
  'content-type': 'application/json',
};

const customerTierDefinition = {
  key: 'customer.tier',
  label: 'Customer tier',
  source: 'customer',
  type: 'enum',
  required: true,
  enumValues: ['gold', 'silver'],
} as const satisfies VariableDefinition;

const contextChannelDefinition = {
  key: 'context.channel',
  label: 'Sales channel',
  source: 'context',
  type: 'enum',
  required: true,
  enumValues: ['web', 'mobile'],
} as const satisfies VariableDefinition;

const goldWebPromo = {
  id: 'gold-web-10',
  type: 'promo',
  name: 'Gold web offer',
  status: 'active',
  eligibility: {
    match: 'ALL',
    conditions: [
      {
        id: 'gold-tier',
        variable: 'customer.tier',
        operator: 'eq',
        value: 'gold',
      },
      {
        id: 'web-channel',
        variable: 'context.channel',
        operator: 'eq',
        value: 'web',
      },
    ],
  },
  reward: {
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 1_000 },
  },
  budget: { currency: 'GBP', minorUnits: 10_000 },
  usageCap: 10,
  perCustomerCap: 1,
  stackable: false,
  priority: 10,
  autoApply: true,
} as const satisfies PromoProgram;

async function resetData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM variable_definitions'),
    env.DB.prepare('DELETE FROM schema_versions'),
  ]);
}

async function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  token = 'secret-test',
): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('integration-ready runtime', () => {
  beforeEach(resetData);

  test('define → publish → customer → promo → evaluate → redeem', async () => {
    for (const definition of [customerTierDefinition, contextChannelDefinition]) {
      const response = await jsonRequest('POST', '/v1/schema/definitions', definition);
      expect(response.status).toBe(201);
    }

    const publication = await SELF.fetch('https://example.test/v1/schema/publish', {
      method: 'POST',
      headers: secretHeaders,
    });
    expect(publication.status).toBe(201);
    expect(await publication.json()).toMatchObject({
      version: 1,
      definitions: expect.arrayContaining([
        customerTierDefinition,
        contextChannelDefinition,
      ]),
    });

    const customer = await jsonRequest('PATCH', '/v1/customers/customer-1', {
      attributes: { tier: 'gold' },
    });
    expect(customer.status).toBe(200);
    expect(await customer.json()).toMatchObject({
      externalRef: 'customer-1',
      attributes: { tier: 'gold' },
      version: 1,
    });

    const program = await jsonRequest('POST', '/v1/programs', goldWebPromo);
    expect(program.status).toBe(201);

    const evaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'customer-1',
      cart: { currency: 'GBP', subtotal: 6_500, items: [] },
      context: { channel: 'web' },
    }, 'publishable-test');
    expect(evaluationResponse.status).toBe(200);
    const evaluation = EvaluationResponseSchema.parse(await evaluationResponse.json());
    expect(evaluation.decisions).toEqual([
      expect.objectContaining({
        programRef: goldWebPromo.id,
        outcome: 'qualified',
        eligible: true,
        commitRequired: true,
      }),
    ]);

    const redemptionResponse = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: evaluation.evaluationId,
      programRef: goldWebPromo.id,
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-attempt-1',
    });
    expect(redemptionResponse.status).toBe(200);
    const redemption = RedemptionResponseSchema.parse(await redemptionResponse.json());
    expect(redemption).toMatchObject({
      evaluationId: evaluation.evaluationId,
      programRef: goldWebPromo.id,
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-attempt-1',
      status: 'committed',
    });
  });

  test('serves the exact generated OpenAPI document for every runtime route', async () => {
    const response = await SELF.fetch('https://example.test/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).toBe(JSON.stringify(buildOpenApiDocument()));

    const document = buildOpenApiDocument();
    const expected = {
      'GET /v1/health': {
        security: 'public', success: ['200', 'HealthResponse'], errors: [],
      },
      'GET /v1/openapi.json': {
        security: 'public', success: ['200', 'OpenApiDocument'], errors: [],
      },
      'GET /v1/test-publishable': {
        security: 'publishable', success: ['200', 'AccessSummary'], errors: ['401', '503'],
      },
      'GET /v1/test-secret': {
        security: 'secret', success: ['200', 'AccessSummary'], errors: ['401', '403', '503'],
      },
      'GET /v1/schema/definitions': {
        security: 'secret', success: ['200', 'SchemaDefinitionsResponse'],
        errors: ['401', '403', '503'],
      },
      'POST /v1/schema/definitions': {
        security: 'secret', success: ['201', 'SchemaDefinitionView'],
        requestBody: 'VariableDefinition', errors: ['400', '401', '403', '409', '503'],
      },
      'PATCH /v1/schema/definitions/{id}': {
        security: 'secret', success: ['200', 'SchemaDefinitionView'],
        requestBody: 'VariableDefinition', parameters: ['SchemaDefinitionId'],
        errors: ['400', '401', '403', '404', '409', '503'],
      },
      'DELETE /v1/schema/definitions/{id}': {
        security: 'secret', success: ['204', null], parameters: ['SchemaDefinitionId'],
        errors: ['401', '403', '404', '409', '503'],
      },
      'POST /v1/schema/publish': {
        security: 'secret', success: ['201', 'PublishedSchemaResponse'],
        errors: ['401', '403', '409', '503'],
      },
      'GET /v1/schema/published': {
        security: 'publishable', success: ['200', 'PublishedSchemaResponse'],
        errors: ['401', '404', '503'],
      },
      'GET /v1/customers/{customerRef}': {
        security: 'secret', success: ['200', 'CustomerRecord'],
        parameters: ['CustomerRef'], errors: ['400', '401', '403', '404', '503'],
      },
      'PATCH /v1/customers/{customerRef}': {
        security: 'secret', success: ['200', 'CustomerRecord'],
        requestBody: 'CustomerPatchRequest', parameters: ['CustomerRef'],
        errors: ['400', '401', '403', '404', '409', '503'],
      },
      'GET /v1/programs': {
        security: 'secret', success: ['200', 'ProgramListResponse'],
        errors: ['401', '403', '503'],
      },
      'POST /v1/programs': {
        security: 'secret', success: ['201', 'PromoProgram'], requestBody: 'PromoProgram',
        errors: ['400', '401', '403', '409', '503'],
      },
      'GET /v1/programs/{externalRef}': {
        security: 'secret', success: ['200', 'PromoProgram'],
        parameters: ['ProgramExternalRef'], errors: ['401', '403', '404', '503'],
      },
      'PATCH /v1/programs/{externalRef}': {
        security: 'secret', success: ['200', 'PromoProgram'], requestBody: 'PromoProgram',
        parameters: ['ProgramExternalRef'], errors: ['400', '401', '403', '404', '409', '503'],
      },
      'POST /v1/evaluate': {
        security: 'publishable', success: ['200', 'EvaluationResponse'],
        requestBody: 'EvaluationRequest', errors: ['400', '401', '404', '503'],
      },
      'POST /v1/redemptions': {
        security: 'secret', success: ['200', 'RedemptionResponse'],
        requestBody: 'RedemptionRequest',
        errors: ['400', '401', '403', '404', '409', '410', '503'],
      },
    } as const;

    type HttpMethod = 'get' | 'post' | 'patch' | 'delete';
    type Operation = {
      security?: Array<Record<string, never[]>>;
      parameters?: Array<{ $ref?: string }>;
      requestBody?: {
        content?: { 'application/json'?: { schema?: { $ref?: string } } };
      };
      responses: Record<string, {
        content?: { 'application/json'?: { schema?: { $ref?: string } } };
        headers?: Record<string, { $ref?: string }>;
      }>;
    };
    const methods: HttpMethod[] = ['get', 'post', 'patch', 'delete'];
    const paths = document.paths as Record<string, Partial<Record<HttpMethod, Operation>>>;
    const actualMatrix = Object.entries(paths).flatMap(([path, pathItem]) => (
      methods.flatMap(method => pathItem[method] === undefined
        ? []
        : [`${method.toUpperCase()} ${path}`])
    ));
    expect(actualMatrix.sort()).toEqual(Object.keys(expected).sort());

    expect(document.components?.securitySchemes).toMatchObject({
      publishableBearer: { type: 'http', scheme: 'bearer' },
      secretBearer: { type: 'http', scheme: 'bearer' },
    });
    expect(document.components?.headers).toMatchObject({
      CorrelationId: {
        description: 'Request correlation identifier returned by the runtime',
        schema: { type: 'string', minLength: 1 },
      },
    });
    expect(document.components?.parameters).toMatchObject({
      SchemaDefinitionId: {
        name: 'id', in: 'path', required: true,
        schema: { type: 'string', minLength: 1 },
      },
      CustomerRef: {
        name: 'customerRef', in: 'path', required: true,
        schema: { type: 'string', minLength: 1 },
      },
      ProgramExternalRef: {
        name: 'externalRef', in: 'path', required: true,
        schema: { type: 'string', minLength: 1 },
      },
    });

    for (const [key, specification] of Object.entries(expected)) {
      const separator = key.indexOf(' ');
      const method = key.slice(0, separator).toLowerCase() as HttpMethod;
      const path = key.slice(separator + 1);
      const operation = paths[path]?.[method];
      expect(operation, key).toBeDefined();

      const expectedSecurity = specification.security === 'public'
        ? undefined
        : specification.security === 'secret'
          ? [{ secretBearer: [] }]
          : [{ publishableBearer: [] }, { secretBearer: [] }];
      expect(operation?.security, `${key} security`).toEqual(expectedSecurity);

      const expectedParameters = 'parameters' in specification
        ? specification.parameters.map(name => `#/components/parameters/${name}`)
        : [];
      expect(
        (operation?.parameters ?? []).map(parameter => parameter.$ref),
        `${key} parameters`,
      ).toEqual(expectedParameters);

      const expectedRequestBody = 'requestBody' in specification
        ? `#/components/schemas/${specification.requestBody}`
        : undefined;
      expect(
        operation?.requestBody?.content?.['application/json']?.schema?.$ref,
        `${key} request body`,
      ).toBe(expectedRequestBody);

      const [successStatus, successSchema] = specification.success;
      expect(Object.keys(operation?.responses ?? {}).sort(), `${key} response statuses`).toEqual(
        [successStatus, ...specification.errors].sort(),
      );
      expect(
        operation?.responses[successStatus]?.content?.['application/json']?.schema?.$ref,
        `${key} success schema`,
      ).toBe(successSchema === null ? undefined : `#/components/schemas/${successSchema}`);

      for (const status of specification.errors) {
        const error = operation?.responses[status];
        expect(
          error?.content?.['application/json']?.schema?.$ref,
          `${key} ${status} error schema`,
        ).toBe('#/components/schemas/ApiError');
        expect(error?.headers, `${key} ${status} response headers`).toEqual({
          'x-correlation-id': { $ref: '#/components/headers/CorrelationId' },
        });
      }
    }
  });
});
