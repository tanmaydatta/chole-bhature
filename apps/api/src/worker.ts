import type { OperatorCallContext } from '@incentives/contracts';
import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app.js';
import type { Env } from './env.js';
import {
  createCredential,
  listCredentials,
  revokeCredential,
} from './routes/credentials.js';
import { provisionMerchant } from './routes/internal-merchants.js';
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

export class CoreOperatorService extends WorkerEntrypoint<Env> {
  provisionMerchant(context: OperatorCallContext, input: Parameters<typeof provisionMerchant>[2]) {
    return provisionMerchant(this.env, context, input);
  }

  createCredential(context: OperatorCallContext, input: unknown) {
    return createCredential(this.env, context, input);
  }

  listCredentials(context: OperatorCallContext) {
    return listCredentials(this.env, context);
  }

  revokeCredential(context: OperatorCallContext, credentialId: string) {
    return revokeCredential(this.env, context, credentialId);
  }

  listSchemaDefinitions(context: OperatorCallContext) {
    return listSchemaDefinitions(this.env, context);
  }

  createSchemaDefinition(context: OperatorCallContext, input: unknown) {
    return createSchemaDefinition(this.env, context, input);
  }

  updateSchemaDefinition(
    context: OperatorCallContext,
    definitionId: string,
    input: unknown,
  ) {
    return updateSchemaDefinition(this.env, context, definitionId, input);
  }

  deleteSchemaDefinition(context: OperatorCallContext, definitionId: string) {
    return deleteSchemaDefinition(this.env, context, definitionId);
  }

  previewSchemaDefinitionImpact(context: OperatorCallContext, definitionId: string) {
    return previewSchemaDefinitionImpact(this.env, context, definitionId);
  }

  deprecateSchemaDefinition(context: OperatorCallContext, definitionId: string) {
    return deprecateSchemaDefinition(this.env, context, definitionId);
  }

  publishSchema(context: OperatorCallContext) {
    return publishSchema(this.env, context);
  }

  createProgramDraft(context: OperatorCallContext, input: unknown) {
    return createProgramDraft(this.env, context, input);
  }

  getProgram(context: OperatorCallContext, externalRef: string) {
    return getProgram(this.env, context, externalRef);
  }

  listPrograms(context: OperatorCallContext) {
    return listPrograms(this.env, context);
  }

  updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: unknown,
  ) {
    return updateProgramDraft(this.env, context, externalRef, input);
  }

  publishProgram(context: OperatorCallContext, externalRef: string) {
    return publishProgram(this.env, context, externalRef);
  }

  pauseProgram(context: OperatorCallContext, externalRef: string) {
    return pauseProgram(this.env, context, externalRef);
  }

  resumeProgram(context: OperatorCallContext, externalRef: string) {
    return resumeProgram(this.env, context, externalRef);
  }

  endProgram(context: OperatorCallContext, externalRef: string) {
    return endProgram(this.env, context, externalRef);
  }
}

export default createApp();
