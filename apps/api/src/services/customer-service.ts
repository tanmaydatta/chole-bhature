import {
  AuditEntrySchema,
  OperatorCallContextSchema,
  type OperatorCallContext,
  type VariableDefinition,
} from '@incentives/contracts';
import { z } from 'zod';

import { NotFoundError } from '../errors.js';
import { requireOperatorContext } from '../auth/operator-context.js';
import type { Repositories } from '../repositories/types.js';

const CustomerRefSchema = z.string().min(1);
const ExpectedVersionSchema = z.number().int().positive();

function valueSchema(definition: VariableDefinition): z.ZodType {
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

function customerAttributesSchema(definitions: readonly VariableDefinition[]) {
  const shape: Record<string, z.ZodType> = {};

  for (const definition of definitions) {
    if (definition.source !== 'customer') continue;
    const field = definition.key.slice('customer.'.length);
    const schema = valueSchema(definition);
    shape[field] = definition.required ? schema : schema.optional();
  }

  return z.object(shape).strict();
}

export function validateCustomerAttributes(
  attributes: unknown,
  definitions: readonly VariableDefinition[],
): Record<string, unknown> {
  return customerAttributesSchema(definitions).parse(attributes);
}

export function createCustomerService(repositories: Repositories) {
  return {
    async get(merchantId: string, customerRef: string) {
      const externalRef = CustomerRefSchema.parse(customerRef);
      const customer = await repositories.customers.get(merchantId, externalRef);
      if (customer === null) {
        throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');
      }
      return customer;
    },

    async upsert(merchantId: string, customerRef: string, input: unknown) {
      const externalRef = CustomerRefSchema.parse(customerRef);
      const published = await repositories.schemas.getLatestVersion(merchantId, 'published');
      if (published === null) {
        throw new NotFoundError('No schema has been published', 'SCHEMA_NOT_PUBLISHED');
      }

      const request = z.object({
        attributes: customerAttributesSchema(published.definitions),
        expectedVersion: ExpectedVersionSchema.optional(),
      }).strict().parse(input);

      return repositories.customers.upsert({
        merchantId,
        externalRef,
        attributes: request.attributes,
        ...(request.expectedVersion === undefined
          ? {}
          : { expectedVersion: request.expectedVersion }),
      });
    },
  };
}

type OperatorCustomerRepositories = Pick<Repositories, 'customers' | 'schemas'>;

async function operatorCustomerMutation(
  repositories: OperatorCustomerRepositories,
  merchantId: string,
  customerRef: string,
  input: unknown,
) {
  const externalRef = CustomerRefSchema.parse(customerRef);
  const published = await repositories.schemas.getLatestVersion(merchantId, 'published');
  if (published === null) {
    throw new NotFoundError('No schema has been published', 'SCHEMA_NOT_PUBLISHED');
  }
  const request = z.object({
    attributes: customerAttributesSchema(published.definitions),
    expectedVersion: ExpectedVersionSchema.optional(),
  }).strict().parse(input);
  return {
    merchantId,
    externalRef,
    attributes: request.attributes,
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
  };
}

export function createOperatorCustomerMutationService(
  repositories: OperatorCustomerRepositories,
) {
  return {
    async upsert(context: OperatorCallContext, customerRef: string, input: unknown) {
      const operator = requireOperatorContext(
        OperatorCallContextSchema.parse(context),
        'customers:manage',
      );
      const mutation = await operatorCustomerMutation(
        repositories,
        operator.merchantId,
        customerRef,
        input,
      );
      const audit = AuditEntrySchema.parse({
        id: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        actorKind: operator.actorKind,
        actorId: operator.actorUserId,
        merchantId: operator.merchantId,
        action: 'customer.upserted',
        targetType: 'customer',
        targetId: mutation.externalRef,
        outcome: 'succeeded',
        correlationId: operator.correlationId,
      });
      return repositories.customers.upsertWithAudit(mutation, audit);
    },
  };
}
