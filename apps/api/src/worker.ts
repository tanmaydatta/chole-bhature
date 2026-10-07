import {
  ApiCredentialCreateInputSchema,
  ApiCredentialCreateResultSchema,
  ApiCredentialViewSchema,
  CoreMerchantActivationResultSchema,
  CoreMerchantProvisionResultSchema,
  CustomerPatchRequestSchema,
  CustomerRecordSchema,
  ProductE2eCapabilitiesSchema,
  E2eTenantIdentitySchema,
  E2eInspectionQuerySchema,
  MerchantActivationRequestSchema,
  MerchantActivationResultSchema,
  MerchantProvisionRequestSchema,
  MerchantProvisionResultSchema,
  OperatorCallContextSchema,
  OperatorProgramListResponseSchema,
  OperatorProgramViewSchema,
  PublishedSchemaResponseSchema,
  ProgramLifecycleSchema,
  ProgramPublicationResultSchema,
  PromoProgramSchema,
  SchemaDefinitionImpactPreviewSchema,
  SchemaDefinitionViewSchema,
  SchemaDefinitionsResponseSchema,
  SchemaPublicationResultSchema,
  VariableDefinitionSchema,
  type ApiCredentialCreateInput,
  type CustomerPatchRequest,
  type MerchantActivationRequest,
  type MerchantProvisionRequest,
  type OperatorCallContext,
  type E2eTenantIdentity,
  type E2eInspectionQuery,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { z } from 'zod';
import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app.js';
import { assertCiStack } from './ci-stack.js';
import { productE2eCapabilities } from './services/e2e-capabilities.js';
import { MerchantIdentityConflictError } from './errors/merchant-errors.js';
import { requireOperatorContext } from './auth/operator-context.js';
import type { Env } from './env.js';
import { createRepositories } from './repositories/d1-repositories.js';
import {
  createCredential,
  listCredentials,
  revokeCredential,
} from './routes/credentials.js';
import { activateMerchant, provisionMerchant } from './routes/internal-merchants.js';
import {
  createProgramDraft,
  endProgram,
  getProgram,
  listPrograms,
  pauseProgram,
  publishProgram,
  resumeProgram,
  updateProgramDraft,
} from './routes/programs.js';
import {
  createSchemaDefinition,
  deleteSchemaDefinition,
  deprecateSchemaDefinition,
  getPublishedSchema,
  listSchemaDefinitions,
  previewSchemaDefinitionImpact,
  publishSchema,
  updateSchemaDefinition,
} from './routes/schemas.js';
import {
  createCustomerService,
  createOperatorCustomerMutationService,
} from './services/customer-service.js';
import { createProductE2eLifecycle } from './services/e2e-lifecycle.js';
import { inspectProductE2eRun } from './services/e2e-inspection.js';

function coreMerchantFailure(error: unknown) {
  if (error instanceof MerchantIdentityConflictError) {
    return {
      ok: false as const,
      error: {
        code: 'CONFLICT' as const,
        message: 'Merchant provisioning identity conflicts',
        retryable: false,
      },
    };
  }
  return {
    ok: false as const,
    error: {
      code: 'UNAVAILABLE' as const,
      message: 'Core merchant operation is temporarily unavailable',
      retryable: true,
    },
  };
}

const app = createApp();

export class CoreOperatorService extends WorkerEntrypoint<Env> {
  async getE2eCapabilities(context: { actorUserId: string;
    actorKind: 'root' | 'member'; correlationId: string }) {
    assertCiStack(this.env);
    if (context.actorKind !== 'root' || !context.actorUserId || !context.correlationId) {
      throw new Error('E2E capability inspection requires root authority');
    }
    return ProductE2eCapabilitiesSchema.parse(await productE2eCapabilities(this.env));
  }

  async inspectE2eRun(
    context: OperatorCallContext,
    identity: E2eTenantIdentity,
    query: E2eInspectionQuery,
  ) {
    assertCiStack(this.env);
    const operator = requireOperatorContext(
      OperatorCallContextSchema.parse(context), 'credentials:manage',
    );
    const input = E2eTenantIdentitySchema.parse(identity);
    if (operator.actorKind !== 'root' || operator.merchantId !== input.merchantId) {
      throw new Error('E2E inspection requires matching root merchant authority');
    }
    return inspectProductE2eRun(this.env, input, E2eInspectionQuerySchema.parse(query));
  }

  async previewE2eRun(context: OperatorCallContext, identity: E2eTenantIdentity) {
    assertCiStack(this.env);
    const operator = requireOperatorContext(
      OperatorCallContextSchema.parse(context), 'credentials:manage',
    );
    const input = E2eTenantIdentitySchema.parse(identity);
    if (operator.actorKind !== 'root' || operator.merchantId !== input.merchantId) {
      throw new Error('E2E lifecycle requires matching root merchant authority');
    }
    return createProductE2eLifecycle(this.env).preview(input);
  }

  async disposeE2eRun(context: OperatorCallContext, identity: E2eTenantIdentity) {
    assertCiStack(this.env);
    const operator = requireOperatorContext(
      OperatorCallContextSchema.parse(context), 'credentials:manage',
    );
    const input = E2eTenantIdentitySchema.parse(identity);
    if (operator.actorKind !== 'root' || operator.merchantId !== input.merchantId) {
      throw new Error('E2E lifecycle requires matching root merchant authority');
    }
    return createProductE2eLifecycle(this.env).dispose(
      input, operator.actorUserId, operator.correlationId,
    );
  }

  async provisionMerchant(context: OperatorCallContext, input: MerchantProvisionRequest) {
    assertCiStack(this.env);
    const parsedContext = OperatorCallContextSchema.parse(context);
    const parsedInput = MerchantProvisionRequestSchema.parse(input);
    try {
      return CoreMerchantProvisionResultSchema.parse({
        ok: true,
        value: MerchantProvisionResultSchema.parse(await provisionMerchant(
          this.env,
          parsedContext,
          parsedInput,
        )),
      });
    } catch (error) {
      return CoreMerchantProvisionResultSchema.parse(coreMerchantFailure(error));
    }
  }

  async activateMerchant(context: OperatorCallContext, input: MerchantActivationRequest) {
    assertCiStack(this.env);
    const parsedContext = OperatorCallContextSchema.parse(context);
    const parsedInput = MerchantActivationRequestSchema.parse(input);
    try {
      return CoreMerchantActivationResultSchema.parse({
        ok: true,
        value: MerchantActivationResultSchema.parse(await activateMerchant(
          this.env,
          parsedContext,
          parsedInput,
        )),
      });
    } catch (error) {
      return CoreMerchantActivationResultSchema.parse(coreMerchantFailure(error));
    }
  }

  async createCredential(context: OperatorCallContext, input: ApiCredentialCreateInput) {
    assertCiStack(this.env);
    return ApiCredentialCreateResultSchema.parse(await createCredential(
      this.env,
      OperatorCallContextSchema.parse(context),
      ApiCredentialCreateInputSchema.parse(input),
    ));
  }

  async listCredentials(context: OperatorCallContext) {
    assertCiStack(this.env);
    return z.array(ApiCredentialViewSchema).parse(await listCredentials(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async revokeCredential(context: OperatorCallContext, credentialId: string) {
    assertCiStack(this.env);
    return ApiCredentialViewSchema.parse(await revokeCredential(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(credentialId),
    ));
  }

  async getCustomer(context: OperatorCallContext, customerRef: string) {
    assertCiStack(this.env);
    const operator = requireOperatorContext(
      OperatorCallContextSchema.parse(context),
      'customers:read',
    );
    return CustomerRecordSchema.parse(await createCustomerService(
      createRepositories(this.env),
    ).get(operator.merchantId, z.string().min(1).parse(customerRef)));
  }

  async upsertCustomer(
    context: OperatorCallContext,
    customerRef: string,
    input: CustomerPatchRequest,
  ) {
    assertCiStack(this.env);
    return CustomerRecordSchema.parse(await createOperatorCustomerMutationService(
      createRepositories(this.env),
    ).upsert(
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(customerRef),
      CustomerPatchRequestSchema.parse(input),
    ));
  }

  async listSchemaDefinitions(context: OperatorCallContext) {
    assertCiStack(this.env);
    return SchemaDefinitionsResponseSchema.parse(await listSchemaDefinitions(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async getPublishedSchema(context: OperatorCallContext) {
    assertCiStack(this.env);
    return PublishedSchemaResponseSchema.parse(await getPublishedSchema(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async createSchemaDefinition(context: OperatorCallContext, input: VariableDefinition) {
    assertCiStack(this.env);
    return SchemaDefinitionViewSchema.parse(await createSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      VariableDefinitionSchema.parse(input),
    ));
  }

  async updateSchemaDefinition(
    context: OperatorCallContext,
    definitionId: string,
    input: VariableDefinition,
  ) {
    assertCiStack(this.env);
    return SchemaDefinitionViewSchema.parse(await updateSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
      VariableDefinitionSchema.parse(input),
    ));
  }

  async deleteSchemaDefinition(context: OperatorCallContext, definitionId: string) {
    assertCiStack(this.env);
    await deleteSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
    );
  }

  async previewSchemaDefinitionImpact(context: OperatorCallContext, definitionId: string) {
    assertCiStack(this.env);
    return SchemaDefinitionImpactPreviewSchema.parse(await previewSchemaDefinitionImpact(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
    ));
  }

  async deprecateSchemaDefinition(context: OperatorCallContext, definitionId: string) {
    assertCiStack(this.env);
    await deprecateSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
    );
  }

  async publishSchema(context: OperatorCallContext) {
    assertCiStack(this.env);
    return SchemaPublicationResultSchema.parse(await publishSchema(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async createProgramDraft(context: OperatorCallContext, input: PromoProgram) {
    assertCiStack(this.env);
    return OperatorProgramViewSchema.parse(await createProgramDraft(
      this.env,
      OperatorCallContextSchema.parse(context),
      PromoProgramSchema.parse(input),
    ));
  }

  async getProgram(context: OperatorCallContext, externalRef: string) {
    assertCiStack(this.env);
    return OperatorProgramViewSchema.parse(await getProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async listPrograms(context: OperatorCallContext) {
    assertCiStack(this.env);
    return OperatorProgramListResponseSchema.parse(await listPrograms(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: PromoProgram,
  ) {
    assertCiStack(this.env);
    return OperatorProgramViewSchema.parse(await updateProgramDraft(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
      PromoProgramSchema.parse(input),
    ));
  }

  async publishProgram(context: OperatorCallContext, externalRef: string) {
    assertCiStack(this.env);
    return ProgramPublicationResultSchema.parse(await publishProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async pauseProgram(context: OperatorCallContext, externalRef: string) {
    assertCiStack(this.env);
    return ProgramLifecycleSchema.parse(await pauseProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async resumeProgram(context: OperatorCallContext, externalRef: string) {
    assertCiStack(this.env);
    return ProgramLifecycleSchema.parse(await resumeProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async endProgram(context: OperatorCallContext, externalRef: string) {
    assertCiStack(this.env);
    return ProgramLifecycleSchema.parse(await endProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }
}

export default {
  fetch(request, env, context) {
    assertCiStack(env);
    return app.fetch(request, env, context);
  },
} satisfies ExportedHandler<Env>;
