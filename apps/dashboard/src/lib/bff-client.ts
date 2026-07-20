import {
  ApiCredentialCreateResultSchema,
  ApiCredentialViewSchema,
  ApiErrorSchema,
  ClientProvisioningViewSchema,
  IdentityClientsResponseSchema,
  InvitationViewSchema,
  MembershipViewSchema,
  OperatorClientProvisionRequestSchema,
  OperatorCredentialCreateRequestSchema,
  OperatorInvitationAcceptRequestSchema,
  OperatorInvitationCreateRequestSchema,
  OperatorMemberRoleRequestSchema,
  OperatorMerchantSelectionRequestSchema,
  OperatorSessionViewSchema,
  OperatorTeamResponseSchema,
  CustomerRecordSchema,
  OperatorCustomerPatchRequestSchema,
  OperatorProgramDraftRequestSchema,
  OperatorProgramListResponseSchema,
  OperatorProgramViewSchema,
  OperatorSchemaDefinitionRequestSchema,
  ProgramLifecycleSchema,
  ProgramPublicationResultSchema,
  PublishedSchemaResponseSchema,
  SchemaDefinitionImpactPreviewSchema,
  SchemaDefinitionViewSchema,
  SchemaDefinitionsResponseSchema,
  SchemaPublicationResultSchema,
  type ApiCredentialCreateInput,
  type ApiCredentialCreateResult,
  type ApiCredentialView,
  type ClientProvisioningView,
  type FixedOperatorRole,
  type InvitationView,
  type MembershipView,
  type OperatorSessionView,
  type OperatorTeamResponse,
  type CustomerPatchRequest,
  type CustomerRecord,
  type OperatorProgramListResponse,
  type OperatorProgramView,
  type ProgramLifecycle,
  type ProgramPublicationResult,
  type PromoProgram,
  type PublishedSchemaResponse,
  type SchemaDefinitionImpactPreview,
  type SchemaDefinitionView,
  type SchemaDefinitionsResponse,
  type SchemaPublicationResult,
  type VariableDefinition,
} from '@incentives/contracts';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RuntimeSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const AuthActionResponseSchema: RuntimeSchema<Record<string, boolean>> = {
  safeParse(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { success: false };
    }
    const entries = Object.entries(value);
    if (
      entries.length !== 1
      || !['ok', 'status', 'success'].includes(entries[0]?.[0] ?? '')
      || typeof entries[0]?.[1] !== 'boolean'
    ) return { success: false };
    return { success: true, data: value as Record<string, boolean> };
  },
};

const EmptyResponseSchema: RuntimeSchema<null> = {
  safeParse(value) {
    return value === null ? { success: true, data: null } : { success: false };
  },
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function base64url(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/u.test(value);
}

function descriptor(value: unknown): boolean {
  return record(value)
    && onlyKeys(value, ['id', 'type', 'transports'])
    && base64url(value.id)
    && value.type === 'public-key'
    && (value.transports === undefined || (
      Array.isArray(value.transports)
      && value.transports.every(item => typeof item === 'string')
    ));
}

const AuthenticationOptionsSchema: RuntimeSchema<PublicKeyCredentialRequestOptionsJSON> = {
  safeParse(value) {
    if (
      !record(value)
      || !onlyKeys(value, [
        'challenge', 'timeout', 'rpId', 'allowCredentials', 'userVerification',
        'hints', 'extensions',
      ])
      || !base64url(value.challenge)
      || (value.timeout !== undefined && typeof value.timeout !== 'number')
      || (value.rpId !== undefined && typeof value.rpId !== 'string')
      || (value.allowCredentials !== undefined && (
        !Array.isArray(value.allowCredentials)
        || !value.allowCredentials.every(descriptor)
      ))
      || (value.userVerification !== undefined && ![
        'required', 'preferred', 'discouraged',
      ].includes(String(value.userVerification)))
      || (value.hints !== undefined && !Array.isArray(value.hints))
      || (value.extensions !== undefined && !record(value.extensions))
    ) return { success: false };
    return { success: true, data: value as unknown as PublicKeyCredentialRequestOptionsJSON };
  },
};

const RegistrationOptionsSchema: RuntimeSchema<PublicKeyCredentialCreationOptionsJSON> = {
  safeParse(value) {
    if (
      !record(value)
      || !onlyKeys(value, [
        'rp', 'user', 'challenge', 'pubKeyCredParams', 'timeout', 'excludeCredentials',
        'authenticatorSelection', 'hints', 'attestation', 'attestationFormats', 'extensions',
      ])
      || !base64url(value.challenge)
      || !record(value.rp)
      || !onlyKeys(value.rp, ['id', 'name'])
      || typeof value.rp.name !== 'string'
      || (value.rp.id !== undefined && typeof value.rp.id !== 'string')
      || !record(value.user)
      || !onlyKeys(value.user, ['id', 'name', 'displayName'])
      || !base64url(value.user.id)
      || typeof value.user.name !== 'string'
      || typeof value.user.displayName !== 'string'
      || !Array.isArray(value.pubKeyCredParams)
      || !value.pubKeyCredParams.every(item => record(item)
        && onlyKeys(item, ['type', 'alg'])
        && item.type === 'public-key'
        && typeof item.alg === 'number')
      || (value.timeout !== undefined && typeof value.timeout !== 'number')
      || (value.excludeCredentials !== undefined && (
        !Array.isArray(value.excludeCredentials)
        || !value.excludeCredentials.every(descriptor)
      ))
      || (value.authenticatorSelection !== undefined && !record(value.authenticatorSelection))
      || (value.hints !== undefined && !Array.isArray(value.hints))
      || (value.attestation !== undefined && typeof value.attestation !== 'string')
      || (value.attestationFormats !== undefined && !Array.isArray(value.attestationFormats))
      || (value.extensions !== undefined && !record(value.extensions))
    ) return { success: false };
    return { success: true, data: value as unknown as PublicKeyCredentialCreationOptionsJSON };
  },
};

export interface RootRecoveryGrant {
  grant: string;
  expiresAt: number;
}

const RootRecoveryGrantSchema: RuntimeSchema<RootRecoveryGrant> = {
  safeParse(value) {
    if (
      !record(value)
      || !onlyKeys(value, ['grant', 'expiresAt'])
      || typeof value.grant !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/u.test(value.grant)
      || typeof value.expiresAt !== 'number'
      || !Number.isFinite(value.expiresAt)
    ) return { success: false };
    return { success: true, data: { grant: value.grant, expiresAt: value.expiresAt } };
  },
};

export interface RootRecoveryHandoff {
  userId: string;
  codes: string[];
}

const RecoveryCodesSchema: RuntimeSchema<RootRecoveryHandoff> = {
  safeParse(value) {
    if (
      !record(value)
      || !onlyKeys(value, ['userId', 'codes'])
      || typeof value.userId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.userId)
      || !Array.isArray(value.codes)
      || value.codes.length !== 8
      || !value.codes.every(code => typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(code))
      || new Set(value.codes).size !== value.codes.length
    ) return { success: false };
    return {
      success: true,
      data: { userId: value.userId, codes: value.codes as string[] },
    };
  },
};

export class BffClientError extends Error {
  readonly name = 'BffClientError';
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly correlationId: string;

  constructor(
    status: number,
    code: string,
    message: string,
    retryable: boolean,
    correlationId: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.correlationId = correlationId;
  }
}

function invalidResponse(response: Response): BffClientError {
  return new BffClientError(
    502,
    'INVALID_RESPONSE',
    'The operator service returned an invalid response',
    true,
    response.headers.get('x-correlation-id') ?? 'unavailable',
  );
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse(response);
  }
}

async function send<T>(
  fetcher: Fetcher,
  path: string,
  schema: RuntimeSchema<T>,
  options: { method?: string; body?: unknown; empty?: boolean } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch {
    throw new BffClientError(
      0, 'NETWORK_ERROR', 'The operator service is temporarily unavailable', true, 'unavailable',
    );
  }
  if (!response.ok) {
    const raw = await decodeJson(response);
    const parsed = ApiErrorSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse(response);
    throw new BffClientError(
      response.status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.retryable,
      parsed.data.error.correlationId,
    );
  }
  const raw = options.empty || response.status === 204 ? null : await decodeJson(response);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidResponse(response);
  return parsed.data;
}

function encoded(id: string): string {
  return encodeURIComponent(id);
}

export interface BffClient {
  session(): Promise<OperatorSessionView>;
  requestMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  passkeyAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyPasskeyAuthentication(response: AuthenticationResponseJSON): Promise<void>;
  beginRootRecovery(userId: string, code: string): Promise<RootRecoveryGrant>;
  exchangeRootRecovery(grant: string): Promise<void>;
  passkeyRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyPasskeyRegistration(response: RegistrationResponseJSON, name: string): Promise<void>;
  rotateRootRecoveryCodes(): Promise<RootRecoveryHandoff>;
  acceptInvitation(token: string, email: string): Promise<MembershipView>;
  clients(): Promise<ClientProvisioningView[]>;
  provisioning(provisioningId: string): Promise<ClientProvisioningView>;
  provisionClient(name: string, idempotencyKey: string): Promise<ClientProvisioningView>;
  retryProvisioning(provisioningId: string): Promise<ClientProvisioningView>;
  selectMerchant(merchantId: string): Promise<void>;
  team(): Promise<OperatorTeamResponse>;
  createInvitation(email: string, role: FixedOperatorRole): Promise<InvitationView>;
  retryInvitation(invitationId: string): Promise<InvitationView>;
  changeMemberRole(membershipId: string, role: FixedOperatorRole): Promise<MembershipView>;
  removeMember(membershipId: string): Promise<MembershipView>;
  credentials(): Promise<ApiCredentialView[]>;
  createCredential(input: ApiCredentialCreateInput): Promise<ApiCredentialCreateResult>;
  revokeCredential(credentialId: string): Promise<ApiCredentialView>;
  schemaDefinitions(): Promise<SchemaDefinitionsResponse>;
  publishedSchema(): Promise<PublishedSchemaResponse>;
  createSchemaDefinition(input: VariableDefinition): Promise<SchemaDefinitionView>;
  updateSchemaDefinition(id: string, input: VariableDefinition): Promise<SchemaDefinitionView>;
  deleteSchemaDefinition(id: string): Promise<void>;
  deprecateSchemaDefinition(id: string): Promise<void>;
  schemaDefinitionImpact(id: string): Promise<SchemaDefinitionImpactPreview>;
  publishSchema(): Promise<SchemaPublicationResult>;
  customer(externalRef: string): Promise<CustomerRecord>;
  patchCustomer(externalRef: string, input: CustomerPatchRequest): Promise<CustomerRecord>;
  programs(): Promise<OperatorProgramListResponse>;
  program(externalRef: string): Promise<OperatorProgramView>;
  createProgram(input: PromoProgram): Promise<OperatorProgramView>;
  updateProgram(externalRef: string, input: PromoProgram): Promise<OperatorProgramView>;
  publishProgram(externalRef: string): Promise<ProgramPublicationResult>;
  pauseProgram(externalRef: string): Promise<ProgramLifecycle>;
  resumeProgram(externalRef: string): Promise<ProgramLifecycle>;
  endProgram(externalRef: string): Promise<ProgramLifecycle>;
}

export function createBffClient(
  fetcher: Fetcher = (input, init) => globalThis.fetch(input, init),
): BffClient {
  return {
    session: () => send(fetcher, '/operator/v1/session', OperatorSessionViewSchema),
    async requestMagicLink(email) {
      await send(fetcher, '/auth/sign-in/magic-link', AuthActionResponseSchema, {
        method: 'POST', body: { email, callbackURL: '/' },
      });
    },
    async signOut() {
      await send(fetcher, '/auth/sign-out', AuthActionResponseSchema, {
        method: 'POST', body: {},
      });
    },
    passkeyAuthenticationOptions: () => send(
      fetcher, '/auth/passkey/generate-authenticate-options', AuthenticationOptionsSchema,
    ),
    async verifyPasskeyAuthentication(response) {
      await send(fetcher, '/auth/passkey/verify-authentication', AuthActionResponseSchema, {
        method: 'POST', body: { response },
      });
    },
    beginRootRecovery(userId, code) {
      return send(fetcher, '/auth/root/recovery', RootRecoveryGrantSchema, {
        method: 'POST', body: { userId, code },
      });
    },
    async exchangeRootRecovery(grant) {
      await send(fetcher, '/auth/root/recovery/exchange', AuthActionResponseSchema, {
        method: 'POST', body: { grant },
      });
    },
    passkeyRegistrationOptions: () => send(
      fetcher, '/auth/passkey/generate-register-options', RegistrationOptionsSchema,
    ),
    async verifyPasskeyRegistration(response, name) {
      await send(fetcher, '/auth/passkey/verify-registration', AuthActionResponseSchema, {
        method: 'POST', body: { response, name },
      });
    },
    rotateRootRecoveryCodes: () => send(
      fetcher, '/auth/root/recovery/rotate-codes', RecoveryCodesSchema,
      { method: 'POST', body: {} },
    ),
    acceptInvitation(token, email) {
      const body = OperatorInvitationAcceptRequestSchema.parse({ token, email });
      return send(fetcher, '/operator/v1/invitations/accept', MembershipViewSchema, {
        method: 'POST', body,
      });
    },
    async clients() {
      return (await send(
        fetcher, '/operator/v1/platform/clients', IdentityClientsResponseSchema,
      )).clients;
    },
    provisioning(provisioningId) {
      return send(
        fetcher,
        `/operator/v1/platform/provisionings/${encoded(provisioningId)}`,
        ClientProvisioningViewSchema,
      );
    },
    provisionClient(name, idempotencyKey) {
      const body = OperatorClientProvisionRequestSchema.parse({ name, idempotencyKey });
      return send(fetcher, '/operator/v1/platform/clients', ClientProvisioningViewSchema, {
        method: 'POST', body,
      });
    },
    retryProvisioning(provisioningId) {
      return send(
        fetcher,
        `/operator/v1/platform/provisionings/${encoded(provisioningId)}/retry`,
        ClientProvisioningViewSchema,
        { method: 'POST', body: {} },
      );
    },
    async selectMerchant(merchantId) {
      const body = OperatorMerchantSelectionRequestSchema.parse({ merchantId });
      await send(fetcher, '/operator/v1/platform/merchant-selection', EmptyResponseSchema, {
        method: 'POST', body, empty: true,
      });
    },
    team: () => send(fetcher, '/operator/v1/team', OperatorTeamResponseSchema),
    createInvitation(email, role) {
      const body = OperatorInvitationCreateRequestSchema.parse({ email, role });
      return send(fetcher, '/operator/v1/team/invitations', InvitationViewSchema, {
        method: 'POST', body,
      });
    },
    retryInvitation(invitationId) {
      return send(
        fetcher,
        `/operator/v1/team/invitations/${encoded(invitationId)}/retry`,
        InvitationViewSchema,
        { method: 'POST', body: {} },
      );
    },
    changeMemberRole(membershipId, role) {
      const body = OperatorMemberRoleRequestSchema.parse({ role });
      return send(
        fetcher, `/operator/v1/team/members/${encoded(membershipId)}`,
        MembershipViewSchema, { method: 'PATCH', body },
      );
    },
    removeMember(membershipId) {
      return send(
        fetcher, `/operator/v1/team/members/${encoded(membershipId)}`,
        MembershipViewSchema, { method: 'DELETE' },
      );
    },
    credentials: () => send(
      fetcher, '/operator/v1/credentials', ApiCredentialViewSchema.array(),
    ),
    createCredential(input) {
      const body = OperatorCredentialCreateRequestSchema.parse(input);
      return send(fetcher, '/operator/v1/credentials', ApiCredentialCreateResultSchema, {
        method: 'POST', body,
      });
    },
    revokeCredential(credentialId) {
      return send(
        fetcher, `/operator/v1/credentials/${encoded(credentialId)}`,
        ApiCredentialViewSchema, { method: 'DELETE' },
      );
    },
    schemaDefinitions: () => send(
      fetcher, '/operator/v1/schema/definitions', SchemaDefinitionsResponseSchema,
    ),
    publishedSchema: () => send(
      fetcher, '/operator/v1/schema/published', PublishedSchemaResponseSchema,
    ),
    createSchemaDefinition(input) {
      const body = OperatorSchemaDefinitionRequestSchema.parse(input);
      return send(fetcher, '/operator/v1/schema/definitions', SchemaDefinitionViewSchema, {
        method: 'POST', body,
      });
    },
    updateSchemaDefinition(id, input) {
      const body = OperatorSchemaDefinitionRequestSchema.parse(input);
      return send(
        fetcher, `/operator/v1/schema/definitions/${encoded(id)}`,
        SchemaDefinitionViewSchema, { method: 'PUT', body },
      );
    },
    async deleteSchemaDefinition(id) {
      await send(
        fetcher, `/operator/v1/schema/definitions/${encoded(id)}`,
        EmptyResponseSchema, { method: 'DELETE', empty: true },
      );
    },
    async deprecateSchemaDefinition(id) {
      await send(
        fetcher, `/operator/v1/schema/definitions/${encoded(id)}/deprecate`,
        EmptyResponseSchema, { method: 'POST', body: {}, empty: true },
      );
    },
    schemaDefinitionImpact(id) {
      return send(
        fetcher, `/operator/v1/schema/definitions/${encoded(id)}/impact`,
        SchemaDefinitionImpactPreviewSchema,
      );
    },
    publishSchema: () => send(
      fetcher, '/operator/v1/schema/publish', SchemaPublicationResultSchema,
      { method: 'POST', body: {} },
    ),
    customer(externalRef) {
      return send(fetcher, `/operator/v1/customers/${encoded(externalRef)}`, CustomerRecordSchema);
    },
    patchCustomer(externalRef, input) {
      const body = OperatorCustomerPatchRequestSchema.parse(input);
      return send(
        fetcher, `/operator/v1/customers/${encoded(externalRef)}`, CustomerRecordSchema,
        { method: 'PATCH', body },
      );
    },
    programs: () => send(fetcher, '/operator/v1/programs', OperatorProgramListResponseSchema),
    program(externalRef) {
      return send(fetcher, `/operator/v1/programs/${encoded(externalRef)}`, OperatorProgramViewSchema);
    },
    createProgram(input) {
      const body = OperatorProgramDraftRequestSchema.parse(input);
      return send(fetcher, '/operator/v1/programs', OperatorProgramViewSchema, {
        method: 'POST', body,
      });
    },
    updateProgram(externalRef, input) {
      const body = OperatorProgramDraftRequestSchema.parse(input);
      return send(fetcher, `/operator/v1/programs/${encoded(externalRef)}`, OperatorProgramViewSchema, {
        method: 'PUT', body,
      });
    },
    publishProgram(externalRef) {
      return send(
        fetcher, `/operator/v1/programs/${encoded(externalRef)}/publish`,
        ProgramPublicationResultSchema, { method: 'POST', body: {} },
      );
    },
    pauseProgram(externalRef) {
      return send(
        fetcher, `/operator/v1/programs/${encoded(externalRef)}/pause`,
        ProgramLifecycleSchema, { method: 'POST', body: {} },
      );
    },
    resumeProgram(externalRef) {
      return send(
        fetcher, `/operator/v1/programs/${encoded(externalRef)}/resume`,
        ProgramLifecycleSchema, { method: 'POST', body: {} },
      );
    },
    endProgram(externalRef) {
      return send(
        fetcher, `/operator/v1/programs/${encoded(externalRef)}/end`,
        ProgramLifecycleSchema, { method: 'POST', body: {} },
      );
    },
  };
}

export const bffClient = createBffClient();
