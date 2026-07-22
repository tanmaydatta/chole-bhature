import type {
  ApiCredentialCreateInput,
  CustomerPatchRequest,
  IdentityAcceptInvitationRequest,
  IdentityChangeMemberRoleRequest,
  IdentityCreateInvitationRequest,
  IdentityGetProvisioningRequest,
  IdentityListInvitationsRequest,
  IdentityListMembersRequest,
  IdentityRootBrowserRequest,
  IdentityRootProvisioningRequest,
  IdentityProvisionClientRequest,
  IdentityRemoveMemberRequest,
  IdentityResolveBrowserPrincipalRequest,
  IdentityRetryInvitationRequest,
  OperatorCallContext,
  OperatorPrincipal,
  OperatorProgramView,
  PermissionKey,
  PromoProgram,
  VariableDefinition,
} from '@incentives/contracts';

export interface RuntimeSchema<T = unknown> {
  parse(value: unknown): T;
}

export interface IdentityRpcService {
  resolveBrowserPrincipal(input: IdentityResolveBrowserPrincipalRequest): Promise<unknown>;
  listClients(input: IdentityRootBrowserRequest): Promise<unknown>;
  getProvisioningForRoot(input: IdentityRootProvisioningRequest): Promise<unknown>;
  listMembers(input: IdentityListMembersRequest): Promise<unknown>;
  listInvitations(input: IdentityListInvitationsRequest): Promise<unknown>;
  provisionClient(input: IdentityProvisionClientRequest): Promise<unknown>;
  getProvisioning(input: IdentityGetProvisioningRequest): Promise<unknown>;
  createInvitation(input: IdentityCreateInvitationRequest): Promise<unknown>;
  retryInvitation(input: IdentityRetryInvitationRequest): Promise<unknown>;
  acceptInvitation(input: IdentityAcceptInvitationRequest): Promise<unknown>;
  removeMember(input: IdentityRemoveMemberRequest): Promise<unknown>;
  changeMemberRole(input: IdentityChangeMemberRoleRequest): Promise<unknown>;
}

export interface CoreRpcService {
  createCredential(context: OperatorCallContext, input: ApiCredentialCreateInput): Promise<unknown>;
  listCredentials(context: OperatorCallContext): Promise<unknown>;
  revokeCredential(context: OperatorCallContext, credentialId: string): Promise<unknown>;
  listSchemaDefinitions(context: OperatorCallContext): Promise<unknown>;
  getPublishedSchema(context: OperatorCallContext): Promise<unknown>;
  createSchemaDefinition(context: OperatorCallContext, input: VariableDefinition): Promise<unknown>;
  updateSchemaDefinition(
    context: OperatorCallContext,
    definitionId: string,
    input: VariableDefinition,
  ): Promise<unknown>;
  deleteSchemaDefinition(context: OperatorCallContext, definitionId: string): Promise<unknown>;
  previewSchemaDefinitionImpact(
    context: OperatorCallContext,
    definitionId: string,
  ): Promise<unknown>;
  deprecateSchemaDefinition(context: OperatorCallContext, definitionId: string): Promise<unknown>;
  publishSchema(context: OperatorCallContext): Promise<unknown>;
  getCustomer(context: OperatorCallContext, customerRef: string): Promise<unknown>;
  upsertCustomer(
    context: OperatorCallContext,
    customerRef: string,
    input: CustomerPatchRequest,
  ): Promise<unknown>;
  listPrograms(context: OperatorCallContext): Promise<unknown>;
  createProgramDraft(context: OperatorCallContext, input: PromoProgram): Promise<OperatorProgramView>;
  getProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
  updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: PromoProgram,
  ): Promise<unknown>;
  publishProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
  pauseProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
  resumeProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
  endProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
}

export interface OperatorWebEnv {
  APP_ENV: 'local' | 'staging';
  PUBLIC_APP_ORIGIN: string;
  OPERATOR_SELECTION_SECRET: string;
  IDENTITY_AUTH: { fetch(request: Request): Promise<Response> };
  IDENTITY: IdentityRpcService;
  CORE: CoreRpcService;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export interface RouteContext {
  env: OperatorWebEnv;
  principal: OperatorPrincipal;
  operator: OperatorCallContext;
  params: Record<string, string>;
  body: unknown;
  correlationId: string;
}

export interface ProtectedRoute {
  method: string;
  pattern: RegExp;
  parameterNames?: readonly string[];
  permission: PermissionKey;
  downstream: 'identity' | 'core';
  bodySchema?: RuntimeSchema;
  responseSchema: RuntimeSchema;
  validateOutput?(value: unknown, context: RouteContext): void;
  invoke(context: RouteContext): Promise<unknown>;
  status?: number;
}

export function requiredParam(context: RouteContext, name: string): string {
  const value = context.params[name];
  if (value === undefined) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export const EmptyBodySchema: RuntimeSchema<Record<string, never>> = {
  parse(value) {
    if (value === undefined) return {};
    if (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && Object.keys(value).length === 0
    ) return {};
    throw new Error('Request body must be empty');
  },
};

export const NullSchema: RuntimeSchema<null> = {
  parse(value) {
    if (value !== null && value !== undefined) throw new Error('Expected an empty response');
    return null;
  },
};

export function arraySchema(item: RuntimeSchema): RuntimeSchema<unknown[]> {
  return {
    parse(value) {
      if (!Array.isArray(value)) throw new Error('Expected an array response');
      return value.map(entry => item.parse(entry));
    },
  };
}
