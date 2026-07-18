import type { VariableDefinition } from '@incentives/contracts';
import { z } from 'zod';

import { NotFoundError } from '../errors.js';
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
