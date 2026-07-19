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
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      '/v1/customers/{customerRef}',
      '/v1/evaluate',
      '/v1/health',
      '/v1/openapi.json',
      '/v1/programs',
      '/v1/programs/{externalRef}',
      '/v1/redemptions',
      '/v1/schema/definitions',
      '/v1/schema/definitions/{id}',
      '/v1/schema/publish',
      '/v1/schema/published',
      '/v1/test-publishable',
      '/v1/test-secret',
    ]);

    expect(document.components?.securitySchemes).toMatchObject({
      publishableBearer: { type: 'http', scheme: 'bearer' },
      secretBearer: { type: 'http', scheme: 'bearer' },
    });

    const protectedOperations = [
      document.paths?.['/v1/schema/definitions']?.get,
      document.paths?.['/v1/schema/definitions']?.post,
      document.paths?.['/v1/schema/definitions/{id}']?.patch,
      document.paths?.['/v1/schema/definitions/{id}']?.delete,
      document.paths?.['/v1/schema/publish']?.post,
      document.paths?.['/v1/schema/published']?.get,
      document.paths?.['/v1/customers/{customerRef}']?.get,
      document.paths?.['/v1/customers/{customerRef}']?.patch,
      document.paths?.['/v1/programs']?.get,
      document.paths?.['/v1/programs']?.post,
      document.paths?.['/v1/programs/{externalRef}']?.get,
      document.paths?.['/v1/programs/{externalRef}']?.patch,
      document.paths?.['/v1/evaluate']?.post,
      document.paths?.['/v1/redemptions']?.post,
    ];
    for (const operation of protectedOperations) {
      expect(operation?.responses).toHaveProperty('401');
      expect(operation?.responses?.['401']).toHaveProperty(
        'content.application/json.schema.$ref',
        '#/components/schemas/ApiError',
      );
    }

    const secretOperations = [
      document.paths?.['/v1/schema/definitions']?.get,
      document.paths?.['/v1/schema/definitions']?.post,
      document.paths?.['/v1/schema/definitions/{id}']?.patch,
      document.paths?.['/v1/schema/definitions/{id}']?.delete,
      document.paths?.['/v1/schema/publish']?.post,
      document.paths?.['/v1/customers/{customerRef}']?.get,
      document.paths?.['/v1/customers/{customerRef}']?.patch,
      document.paths?.['/v1/programs']?.get,
      document.paths?.['/v1/programs']?.post,
      document.paths?.['/v1/programs/{externalRef}']?.get,
      document.paths?.['/v1/programs/{externalRef}']?.patch,
      document.paths?.['/v1/redemptions']?.post,
    ];
    for (const operation of secretOperations) {
      expect(operation?.security).toEqual([{ secretBearer: [] }]);
      expect(operation?.responses).toHaveProperty('403');
    }
    for (const operation of [
      document.paths?.['/v1/schema/published']?.get,
      document.paths?.['/v1/evaluate']?.post,
    ]) {
      expect(operation?.security).toEqual([
        { publishableBearer: [] },
        { secretBearer: [] },
      ]);
      expect(operation?.responses).not.toHaveProperty('403');
    }

    for (const operation of protectedOperations) {
      expect(operation?.responses).toHaveProperty('503');
    }

    expect(document.paths?.['/v1/redemptions']?.post?.responses).toMatchObject({
      400: {},
      403: {},
      404: {},
      409: {},
      410: {},
      503: {},
    });
    expect(document.paths?.['/v1/evaluate']?.post?.responses).toMatchObject({
      400: {},
      404: {},
      503: {},
    });
  });
});
