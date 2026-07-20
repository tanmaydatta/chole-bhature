import {
  ApiCredentialCreateInputSchema,
  ApiCredentialCreateResultSchema,
  ApiCredentialViewSchema,
  CoreMerchantActivationResultSchema,
  CoreMerchantProvisionResultSchema,
  MerchantActivationRequestSchema,
  MerchantActivationResultSchema,
  MerchantProvisionRequestSchema,
  MerchantProvisionResultSchema,
  OperatorCallContextSchema,
  ProgramLifecycleSchema,
  ProgramListResponseSchema,
  ProgramPublicationResultSchema,
  PromoProgramSchema,
  SchemaDefinitionImpactPreviewSchema,
  SchemaDefinitionViewSchema,
  SchemaDefinitionsResponseSchema,
  SchemaPublicationResultSchema,
  VariableDefinitionSchema,
  type ApiCredentialCreateInput,
  type MerchantActivationRequest,
  type MerchantProvisionRequest,
  type OperatorCallContext,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { z } from 'zod';
import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app.js';
import { MerchantIdentityConflictError } from './errors/merchant-errors.js';
import type { Env } from './env.js';
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
  listSchemaDefinitions,
  previewSchemaDefinitionImpact,
  publishSchema,
  updateSchemaDefinition,
} from './routes/schemas.js';

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

export class CoreOperatorService extends WorkerEntrypoint<Env> {
  async provisionMerchant(context: OperatorCallContext, input: MerchantProvisionRequest) {
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
    return ApiCredentialCreateResultSchema.parse(await createCredential(
      this.env,
      OperatorCallContextSchema.parse(context),
      ApiCredentialCreateInputSchema.parse(input),
    ));
  }

  async listCredentials(context: OperatorCallContext) {
    return z.array(ApiCredentialViewSchema).parse(await listCredentials(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async revokeCredential(context: OperatorCallContext, credentialId: string) {
    return ApiCredentialViewSchema.parse(await revokeCredential(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(credentialId),
    ));
  }

  async listSchemaDefinitions(context: OperatorCallContext) {
    return SchemaDefinitionsResponseSchema.parse(await listSchemaDefinitions(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async createSchemaDefinition(context: OperatorCallContext, input: VariableDefinition) {
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
    return SchemaDefinitionViewSchema.parse(await updateSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
      VariableDefinitionSchema.parse(input),
    ));
  }

  async deleteSchemaDefinition(context: OperatorCallContext, definitionId: string) {
    await deleteSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
    );
  }

  async previewSchemaDefinitionImpact(context: OperatorCallContext, definitionId: string) {
    return SchemaDefinitionImpactPreviewSchema.parse(await previewSchemaDefinitionImpact(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
    ));
  }

  async deprecateSchemaDefinition(context: OperatorCallContext, definitionId: string) {
    await deprecateSchemaDefinition(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(definitionId),
    );
  }

  async publishSchema(context: OperatorCallContext) {
    return SchemaPublicationResultSchema.parse(await publishSchema(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async createProgramDraft(context: OperatorCallContext, input: PromoProgram) {
    return PromoProgramSchema.parse(await createProgramDraft(
      this.env,
      OperatorCallContextSchema.parse(context),
      PromoProgramSchema.parse(input),
    ));
  }

  async getProgram(context: OperatorCallContext, externalRef: string) {
    return PromoProgramSchema.parse(await getProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async listPrograms(context: OperatorCallContext) {
    return ProgramListResponseSchema.parse(await listPrograms(
      this.env,
      OperatorCallContextSchema.parse(context),
    ));
  }

  async updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: PromoProgram,
  ) {
    return PromoProgramSchema.parse(await updateProgramDraft(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
      PromoProgramSchema.parse(input),
    ));
  }

  async publishProgram(context: OperatorCallContext, externalRef: string) {
    return ProgramPublicationResultSchema.parse(await publishProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async pauseProgram(context: OperatorCallContext, externalRef: string) {
    return ProgramLifecycleSchema.parse(await pauseProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async resumeProgram(context: OperatorCallContext, externalRef: string) {
    return ProgramLifecycleSchema.parse(await resumeProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }

  async endProgram(context: OperatorCallContext, externalRef: string) {
    return ProgramLifecycleSchema.parse(await endProgram(
      this.env,
      OperatorCallContextSchema.parse(context),
      z.string().min(1).parse(externalRef),
    ));
  }
}

export default createApp();
