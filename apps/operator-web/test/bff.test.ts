import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as contracts from '@incentives/contracts';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ROLE_PERMISSIONS } from '../../identity/src/authorization/registry.js';
import {
  ContextValidationError,
  ForbiddenError,
  NotFoundError,
  SchemaConflictError,
  VersionConflictError,
} from '../../api/src/errors.js';
import {
  OptimisticVersionConflictError,
  ProgramConflictError,
  SchemaRevisionConflictError,
} from '../../api/src/repositories/types.js';

type Principal = {
  userId: string;
  sessionId: string;
  authenticationMethods: string[];
  authenticatedAt: string;
  platformRole?: 'root';
  organizationId?: string;
  merchantId?: string;
  membershipId?: string;
  permissions: string[];
};

type WorkerFactory = () => {
  fetch(request: Request, env: TestEnv): Promise<Response>;
};

type RpcMock = ReturnType<typeof vi.fn>;

interface TestEnv {
  APP_ENV: 'local' | 'staging';
  PUBLIC_APP_ORIGIN: string;
  OPERATOR_SELECTION_SECRET: string;
  IDENTITY_AUTH: { fetch: RpcMock };
  IDENTITY: {
    resolveBrowserPrincipal: RpcMock;
    listClients: RpcMock;
    getProvisioningForRoot: RpcMock;
    listMembers: RpcMock;
    listInvitations: RpcMock;
    provisionClient: RpcMock;
    getProvisioning: RpcMock;
    createInvitation: RpcMock;
    retryInvitation: RpcMock;
    acceptInvitation: RpcMock;
    removeMember: RpcMock;
    changeMemberRole: RpcMock;
  };
  CORE: Record<string, RpcMock>;
  ASSETS: { fetch: RpcMock };
}

const correlationId = 'corr-browser-0001';
const authenticatedAt = '2026-07-20T10:00:00.000Z';
const sessionCookie = 'incentives-local.session_token=opaque-session-token';

const admin: Principal = {
  userId: 'user-admin',
  sessionId: 'session-admin',
  authenticationMethods: ['magic-link'],
  authenticatedAt,
  organizationId: 'org-a',
  merchantId: 'merchant-a',
  membershipId: 'membership-admin',
  permissions: [
    ...ROLE_PERMISSIONS.admin,
  ],
};

const operator: Principal = {
  ...admin,
  userId: 'user-operator',
  sessionId: 'session-operator',
  membershipId: 'membership-operator',
  permissions: [...ROLE_PERMISSIONS.operator],
};

const viewer: Principal = {
  ...admin,
  userId: 'user-viewer',
  sessionId: 'session-viewer',
  membershipId: 'membership-viewer',
  permissions: [...ROLE_PERMISSIONS.viewer],
};

const root: Principal = {
  userId: 'user-root',
  sessionId: 'session-root',
  authenticationMethods: ['passkey'],
  authenticatedAt,
  platformRole: 'root',
  permissions: [],
};

const rootForMerchant: Principal = {
  ...root,
  merchantId: 'merchant-a',
  organizationId: 'org-a',
};

const apiError = (
  code: string,
  message: string,
  retryable = false,
  id = correlationId,
) => ({ error: { code, message, correlationId: id, retryable } });

function rpc(value: unknown): RpcMock {
  return vi.fn(async () => structuredClone(value));
}

function createEnv(principal: Principal | ReturnType<typeof apiError> = admin): TestEnv {
  return {
    APP_ENV: 'local',
    PUBLIC_APP_ORIGIN: 'https://operator.example.test',
    OPERATOR_SELECTION_SECRET:
      'operator-selection-test-secret-with-at-least-thirty-two-characters',
    IDENTITY_AUTH: {
      fetch: vi.fn(async () => Response.json({ ok: true }, {
        headers: {
          'set-cookie': 'incentives-local.session_token=identity-token; HttpOnly; SameSite=Lax',
          'x-correlation-id': correlationId,
        },
      })),
    },
    IDENTITY: {
      resolveBrowserPrincipal: rpc(principal),
      listClients: rpc({ clients: [] }),
      getProvisioningForRoot: rpc({
        provisioningId: 'provisioning-a', merchantId: 'merchant-a',
        organizationId: 'org-a', name: 'Merchant A', status: 'active',
        failedStep: null, retryable: false,
      }),
      listMembers: rpc({ members: [] }),
      listInvitations: rpc({ invitations: [] }),
      provisionClient: rpc({
        provisioningId: 'provisioning-generated', merchantId: 'merchant-generated',
        organizationId: 'org-generated', name: 'Generated client', status: 'active',
        failedStep: null, retryable: false,
      }),
      getProvisioning: rpc({
        provisioningId: 'provisioning-a', merchantId: 'merchant-a',
        organizationId: 'org-a', name: 'Merchant A', status: 'active',
        failedStep: null, retryable: false,
      }),
      createInvitation: rpc({
        id: 'invitation-a', organizationId: 'org-a', email: 'new@example.com',
        role: 'viewer', status: 'sent', expiresAt: '2026-07-21T10:00:00.000Z',
      }),
      retryInvitation: rpc({
        id: 'invitation-a', organizationId: 'org-a', email: 'new@example.com',
        role: 'viewer', status: 'sent', expiresAt: '2026-07-21T10:00:00.000Z',
      }),
      acceptInvitation: rpc({
        id: 'membership-new', organizationId: 'org-a', userId: 'user-new',
        role: 'viewer', status: 'active',
      }),
      removeMember: rpc({
        id: 'membership-viewer', organizationId: 'org-a', userId: 'user-viewer',
        role: 'viewer', status: 'removed',
      }),
      changeMemberRole: rpc({
        id: 'membership-viewer', organizationId: 'org-a', userId: 'user-viewer',
        role: 'operator', status: 'active',
      }),
    },
    CORE: {
      createCredential: rpc({
        credential: {
          id: 'credential-a', name: 'Local key', merchantId: 'merchant-a',
          environment: 'local', scopes: ['schema:read'],
          createdAt: authenticatedAt, createdBy: 'user-admin', status: 'active',
          suffix: 'abcd', kind: 'secret',
        },
        token: `sk_${'a'.repeat(32)}`,
      }),
      listCredentials: rpc([]),
      revokeCredential: rpc({
        id: 'credential-a', name: 'Local key', merchantId: 'merchant-a',
        environment: 'local', scopes: ['schema:read'], createdAt: authenticatedAt,
        createdBy: 'user-admin', status: 'revoked', suffix: 'abcd', kind: 'secret',
      }),
      listSchemaDefinitions: rpc({ definitions: [] }),
      createSchemaDefinition: rpc({
        id: 'definition-a', readOnly: false, referenced: false,
        definition: { key: 'customer.tier', source: 'customer', type: 'string', required: false },
      }),
      updateSchemaDefinition: rpc({
        id: 'definition-a', readOnly: false, referenced: false,
        definition: { key: 'customer.tier', source: 'customer', type: 'string', required: false },
      }),
      deleteSchemaDefinition: rpc(null),
      previewSchemaDefinitionImpact: rpc({
        publishedVersions: [], referencedProgramRefs: [], storedCustomerCount: 0,
        incompatibleCustomerCount: 0, warnings: [],
      }),
      deprecateSchemaDefinition: rpc(null),
      publishSchema: rpc({
        version: 1, publishedAt: authenticatedAt, definitions: [],
        jsonSchema: {}, sample: {}, warnings: [],
      }),
      getPublishedSchema: rpc({
        version: 1, publishedAt: authenticatedAt, definitions: [],
        jsonSchema: {}, sample: {},
      }),
      getCustomer: rpc({
        externalRef: 'customer-a', attributes: {}, version: 1, updatedAt: authenticatedAt,
      }),
      upsertCustomer: rpc({
        externalRef: 'customer-a', attributes: {}, version: 1, updatedAt: authenticatedAt,
      }),
      listPrograms: rpc({ programs: [] }),
      createProgramDraft: rpc(null),
      getProgram: rpc(null),
      updateProgramDraft: rpc(null),
      publishProgram: rpc(null),
      pauseProgram: rpc(null),
      resumeProgram: rpc(null),
      endProgram: rpc(null),
    },
    ASSETS: {
      fetch: vi.fn(async (request: Request) => new Response(
        new URL(request.url).pathname === '/assets/app.js' ? 'asset-js' : '<main>dashboard</main>',
        { headers: { 'content-type': 'text/html' } },
      )),
    },
  };
}

async function loadFactory(): Promise<WorkerFactory | undefined> {
  try {
    const module = await import('../src/worker.js') as { createOperatorWebWorker?: WorkerFactory };
    return module.createOperatorWebWorker;
  } catch (error) {
    if (
      error instanceof Error
      && (error.message.includes('src/worker') || error.message.includes('Cannot find module'))
    ) return undefined;
    throw error;
  }
}

async function worker() {
  const factory = await loadFactory();
  expect(factory, 'Operator Web worker factory must exist').toBeTypeOf('function');
  return factory?.();
}

function request(
  pathname: string,
  init: RequestInit = {},
  cookie = sessionCookie,
): Request {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  if (!headers.has('x-correlation-id')) headers.set('x-correlation-id', correlationId);
  if (init.method !== undefined && !['GET', 'HEAD'].includes(init.method)) {
    if (!headers.has('origin')) headers.set('origin', 'https://operator.example.test');
    if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin');
  }
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`https://operator.example.test${pathname}`, { ...init, headers });
}

async function json(response: Response | undefined): Promise<unknown> {
  expect(response).toBeInstanceOf(Response);
  return response?.json();
}

async function selectMerchant(handler: Awaited<ReturnType<typeof worker>>, env: TestEnv) {
  env.IDENTITY.resolveBrowserPrincipal
    .mockResolvedValueOnce(root)
    .mockResolvedValueOnce(rootForMerchant);
  const response = await handler?.fetch(request('/operator/v1/platform/merchant-selection', {
    method: 'POST', body: JSON.stringify({ merchantId: 'merchant-a' }),
  }), env);
  expect(response?.status).toBe(204);
  const setCookie = response?.headers.get('set-cookie');
  const selection = setCookie?.split(';', 1)[0];
  expect(selection).toMatch(
    env.APP_ENV === 'staging'
      ? /^__Host-incentives-operator-selection=/
      : /^incentives-operator-selection=/,
  );
  return `${sessionCookie}; ${setCookie}`;
}

beforeEach(() => vi.restoreAllMocks());

describe('canonical Operator Web contracts', () => {
  test.each([
    'OperatorSessionViewSchema',
    'OperatorMerchantSelectionRequestSchema',
    'OperatorClientProvisionRequestSchema',
    'OperatorTeamResponseSchema',
    'OperatorInvitationCreateRequestSchema',
    'OperatorCredentialCreateRequestSchema',
    'OperatorCustomerPatchRequestSchema',
    'IdentityResolveBrowserPrincipalRequestSchema',
    'IdentityRootBrowserRequestSchema',
    'IdentityRootProvisioningRequestSchema',
    'IdentityClientsResponseSchema',
    'IdentityMembersResponseSchema',
    'IdentityInvitationsResponseSchema',
  ])('exports the canonical %s', name => {
    expect(Reflect.get(contracts, name), `${name} must be canonical`).toBeDefined();
  });

  test('keeps authoritative browser context out of strict BFF bodies', () => {
    const schema = Reflect.get(contracts, 'OperatorCustomerPatchRequestSchema') as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.safeParse({ attributes: {}, expectedVersion: 1 }).success).toBe(true);
    for (const field of ['merchantId', 'actorUserId', 'permission', 'platformRole']) {
      expect(schema.safeParse({ attributes: {}, [field]: 'forged' }).success).toBe(false);
    }
  });

  test('requires a bounded idempotency key and rejects browser-generated provisioning ids', () => {
    const schema = Reflect.get(contracts, 'OperatorClientProvisionRequestSchema') as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.safeParse({ name: 'Client', idempotencyKey: 'onboarding-request-1' }).success)
      .toBe(true);
    expect(schema.safeParse({ name: 'Client' }).success).toBe(false);
    expect(schema.safeParse({
      name: 'Client', idempotencyKey: 'onboarding-request-1', merchantId: 'forged',
    }).success).toBe(false);
    expect(schema.safeParse({
      name: 'Client', idempotencyKey: 'onboarding-request-1', provisioningId: 'forged',
    }).success).toBe(false);
  });
});

describe('live session and tenant boundary', () => {
  test.each([
    ['POST', '/operator/v1/invitations/accept'],
    ['POST', '/operator/v1/platform/merchant-selection'],
    ['POST', '/operator/v1/platform/clients'],
    ['POST', '/operator/v1/platform/provisionings/provisioning-a/retry'],
    ['POST', '/operator/v1/team/invitations'],
    ['PATCH', '/operator/v1/team/members/membership-a'],
    ['DELETE', '/operator/v1/credentials/credential-a'],
    ['POST', '/operator/v1/schema/definitions'],
    ['PUT', '/operator/v1/customers/customer-a'],
    ['POST', '/operator/v1/programs'],
  ])('rejects %s %s without exact same-origin browser provenance before auth or parsing', async (
    method,
    pathname,
  ) => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(request(pathname, {
      method,
      headers: {
        origin: 'https://same-site-attacker.example.test',
        'sec-fetch-site': 'same-origin',
      },
      body: '{}',
    }), env);

    expect(response?.status).toBe(403);
    expect(await json(response)).toEqual(apiError('FORBIDDEN', 'Operation is not permitted'));
    expect(env.IDENTITY.resolveBrowserPrincipal).not.toHaveBeenCalled();
    expect(Object.values(env.CORE).every(mock => mock.mock.calls.length === 0)).toBe(true);
  });

  test('rejects an operator mutation whose fetch metadata says cross-site', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(request('/operator/v1/team/invitations', {
      method: 'POST',
      headers: { origin: env.PUBLIC_APP_ORIGIN, 'sec-fetch-site': 'cross-site' },
      body: '{}',
    }), env);
    expect(response?.status).toBe(403);
    expect(env.IDENTITY.resolveBrowserPrincipal).not.toHaveBeenCalled();
  });

  test('requires Origin on every unsafe operator request', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(request('/operator/v1/team/invitations', {
      method: 'POST', headers: { origin: '' }, body: '{}',
    }), env);
    expect(response?.status).toBe(403);
    expect(env.IDENTITY.resolveBrowserPrincipal).not.toHaveBeenCalled();
  });

  test('returns an exact canonical 401 when no live session exists', async () => {
    const handler = await worker();
    const env = createEnv(apiError('UNAUTHORIZED', 'Authentication is required'));

    const response = await handler?.fetch(request('/operator/v1/credentials', {}, ''), env);

    expect(response?.status).toBe(401);
    expect(await json(response)).toEqual(apiError('UNAUTHORIZED', 'Authentication is required'));
    expect(env.CORE.listCredentials).not.toHaveBeenCalled();
  });

  test('returns an exact canonical 403 for a missing route-specific permission', async () => {
    const handler = await worker();
    const env = createEnv(viewer);

    const response = await handler?.fetch(request('/operator/v1/credentials', {
      method: 'POST',
      body: JSON.stringify({
        name: 'forbidden', environment: 'local', scopes: ['schema:read'], kind: 'secret',
      }),
    }), env);

    expect(response?.status).toBe(403);
    expect(await json(response)).toEqual(apiError('FORBIDDEN', 'Operation is not permitted'));
    expect(env.CORE.createCredential).not.toHaveBeenCalled();
  });

  test('re-resolves the live principal for every operation after revocation or demotion', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY.resolveBrowserPrincipal
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(apiError('FORBIDDEN', 'Operation is not permitted'));

    const first = await handler?.fetch(request('/operator/v1/credentials'), env);
    const second = await handler?.fetch(request('/operator/v1/credentials'), env);

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(403);
    expect(env.IDENTITY.resolveBrowserPrincipal).toHaveBeenCalledTimes(2);
    expect(env.CORE.listCredentials).toHaveBeenCalledTimes(1);
  });

  test('passes through effective expired credential status from Core', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.CORE.listCredentials.mockResolvedValue([{
      id: 'credential-expired', name: 'Expired key', merchantId: 'merchant-a',
      environment: 'local', scopes: ['schema:read'],
      expiresAt: '2000-01-01T00:00:00.000Z', createdAt: authenticatedAt,
      createdBy: 'user-admin', status: 'expired', suffix: 'deadbeef', kind: 'secret',
    }]);

    const response = await handler?.fetch(request('/operator/v1/credentials'), env);

    expect(response?.status).toBe(200);
    expect(await json(response)).toEqual([
      expect.objectContaining({ id: 'credential-expired', status: 'expired' }),
    ]);
  });

  test('requires an explicit active merchant selection for root operations', async () => {
    const handler = await worker();
    const env = createEnv(root);

    const missing = await handler?.fetch(request('/operator/v1/credentials'), env);
    expect(missing?.status).toBe(400);
    expect(await json(missing)).toEqual(apiError(
      'MERCHANT_SELECTION_REQUIRED', 'Select a merchant before continuing',
    ));

    const cookie = await selectMerchant(handler, env);
    env.IDENTITY.resolveBrowserPrincipal
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(rootForMerchant);
    const selected = await handler?.fetch(request('/operator/v1/credentials', {}, cookie), env);

    expect(selected?.status).toBe(200);
    expect(env.CORE.listCredentials).toHaveBeenCalledWith({
      correlationId,
      actorUserId: 'user-root',
      actorKind: 'root',
      merchantId: 'merchant-a',
      permission: 'credentials:read',
    });
  });

  test('lets selected root manage the client team with server-resolved organization authority', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const cookie = await selectMerchant(handler, env);
    env.IDENTITY.resolveBrowserPrincipal.mockResolvedValue(rootForMerchant);
    env.IDENTITY.listMembers.mockResolvedValue({ members: [{
      id: 'membership-admin', organizationId: 'org-a', userId: 'user-admin',
      email: 'admin@example.test', role: 'admin', status: 'active',
    }] });

    const listed = await handler?.fetch(request('/operator/v1/team', {}, cookie), env);
    expect(listed?.status).toBe(200);
    expect(await json(listed)).toMatchObject({
      members: [expect.objectContaining({ email: 'admin@example.test' })],
    });

    const created = await handler?.fetch(request('/operator/v1/team/invitations', {
      method: 'POST', body: JSON.stringify({ email: 'new@example.test', role: 'admin' }),
    }, cookie), env);
    expect(created?.status).toBe(201);
    const invitationRequest = env.IDENTITY.createInvitation.mock.calls[0]?.[0];
    expect(contracts.IdentityCreateInvitationRequestSchema.safeParse(invitationRequest).success)
      .toBe(true);
    expect(invitationRequest).toEqual({
      sessionId: 'session-root',
      selectedMerchantId: 'merchant-a',
      input: {
        organizationId: 'org-a',
        email: 'new@example.test',
        role: 'admin',
        expiresInSeconds: 86400,
        correlationId,
      },
    });
    expect(invitationRequest).not.toHaveProperty('correlationId');
    const browserBody = JSON.parse(String((await request('/operator/v1/team/invitations', {
      method: 'POST', body: JSON.stringify({ email: 'new@example.test', role: 'admin' }),
    }).text()))) as Record<string, unknown>;
    expect(browserBody).not.toHaveProperty('organizationId');
  });

  test('binds the signed selection cookie to the live root session', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const cookie = await selectMerchant(handler, env);
    env.IDENTITY.resolveBrowserPrincipal.mockResolvedValueOnce({ ...root, sessionId: 'new-session' });

    const response = await handler?.fetch(request('/operator/v1/credentials', {}, cookie), env);

    expect(response?.status).toBe(400);
    expect(await json(response)).toEqual(apiError(
      'MERCHANT_SELECTION_REQUIRED', 'Select a merchant before continuing',
    ));
    expect(env.CORE.listCredentials).not.toHaveBeenCalled();
  });

  test('uses HTTP-safe local cookies and Secure __Host cookies only in staging', async () => {
    const handler = await worker();
    const local = createEnv(root);
    const localCookie = await selectMerchant(handler, local);
    expect(localCookie).toContain('incentives-operator-selection=');
    expect(localCookie).not.toContain('__Host-');
    expect(localCookie).not.toContain('Secure');
    expect(localCookie).toContain('HttpOnly');
    expect(localCookie).toContain('SameSite=Strict');

    const staging = createEnv(root);
    staging.APP_ENV = 'staging';
    const stagingCookie = await selectMerchant(handler, staging);
    expect(stagingCookie).toContain('__Host-incentives-operator-selection=');
    expect(stagingCookie).toContain('Secure');
  });

  test('returns the live selected root merchant from session and ignores invalid selection state', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const cookie = await selectMerchant(handler, env);
    env.IDENTITY.resolveBrowserPrincipal
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(rootForMerchant);
    const selected = await handler?.fetch(request('/operator/v1/session', {}, cookie), env);
    expect(await json(selected)).toMatchObject({
      platformRole: 'root', merchantId: 'merchant-a', merchantSelectionRequired: false,
    });

    env.IDENTITY.resolveBrowserPrincipal.mockResolvedValueOnce(root);
    const invalid = await handler?.fetch(request(
      '/operator/v1/session',
      {},
      `${sessionCookie}; incentives-operator-selection=forged.invalid`,
    ), env);
    expect(await json(invalid)).toMatchObject({
      platformRole: 'root', merchantSelectionRequired: true,
    });
  });

  test('fails closed when Identity cannot revalidate a selected root merchant', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const cookie = await selectMerchant(handler, env);
    env.IDENTITY.resolveBrowserPrincipal
      .mockResolvedValueOnce(root)
      .mockRejectedValueOnce(new Error('rpc unavailable'));

    const response = await handler?.fetch(request('/operator/v1/session', {}, cookie), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));
  });

  test('derives stable provisioning identities from root and idempotency key', async () => {
    const handler = await worker();
    const env = createEnv(root);
    env.IDENTITY.provisionClient.mockImplementation(async (input: {
      selectedMerchantId: string;
      input: { provisioningId: string; merchantId: string; name: string };
    }) => ({
      provisioningId: input.input.provisioningId,
      merchantId: input.input.merchantId,
      organizationId: null,
      name: input.input.name,
      status: 'provisioning',
      failedStep: null,
      retryable: false,
    }));
    const provision = (key: string, id = correlationId) => handler?.fetch(request(
      '/operator/v1/platform/clients',
      {
        method: 'POST',
        headers: { 'x-correlation-id': id },
        body: JSON.stringify({ name: 'Client A', idempotencyKey: key }),
      },
    ), env);

    expect((await provision('request-1'))?.status).toBe(201);
    expect((await provision('request-1', 'different-correlation'))?.status).toBe(201);
    expect((await provision('request-2'))?.status).toBe(201);
    const calls = env.IDENTITY.provisionClient.mock.calls.map(call => call[0] as {
      selectedMerchantId: string;
      input: { provisioningId: string; merchantId: string };
    });
    expect(calls[0]?.input.merchantId).toBe(calls[1]?.input.merchantId);
    expect(calls[0]?.input.provisioningId).toBe(calls[1]?.input.provisioningId);
    expect(calls[0]?.selectedMerchantId).toBe(calls[1]?.selectedMerchantId);
    expect(calls[2]?.input.merchantId).not.toBe(calls[0]?.input.merchantId);
    expect(calls[2]?.input.provisioningId).not.toBe(calls[0]?.input.provisioningId);
  });

  test('lists active and failed clients for a live root without requiring merchant selection', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const clients = [
      {
        provisioningId: 'provisioning-active', merchantId: 'merchant-active',
        organizationId: 'org-active', name: 'Active client', status: 'active',
        failedStep: null, retryable: false,
      },
      {
        provisioningId: 'provisioning-failed', merchantId: 'merchant-failed',
        organizationId: null, name: 'Failed client', status: 'failed',
        failedStep: 'core_provision', retryable: true,
      },
    ];
    env.IDENTITY.listClients.mockResolvedValue({ clients });

    const response = await handler?.fetch(request('/operator/v1/platform/clients'), env);

    expect(response?.status).toBe(200);
    expect(await json(response)).toEqual({ clients });
    expect(env.IDENTITY.listClients).toHaveBeenCalledWith({
      cookieHeader: sessionCookie,
      correlationId,
    });
  });

  test('inspects failed provisioning as root without selecting its inactive merchant', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const failed = {
      provisioningId: 'provisioning-failed', merchantId: 'merchant-failed',
      organizationId: null, name: 'Failed client', status: 'failed',
      failedStep: 'identity_organization', retryable: true,
    };
    env.IDENTITY.getProvisioningForRoot.mockResolvedValue(failed);

    const response = await handler?.fetch(request(
      '/operator/v1/platform/provisionings/provisioning-failed',
    ), env);

    expect(response?.status).toBe(200);
    expect(await json(response)).toEqual(failed);
    expect(env.IDENTITY.getProvisioningForRoot).toHaveBeenCalledWith({
      cookieHeader: sessionCookie,
      provisioningId: 'provisioning-failed',
      correlationId,
    });
    expect(env.IDENTITY.resolveBrowserPrincipal).toHaveBeenCalledTimes(1);
  });

  test('retries a root-visible failed provisioning from its durable server-side identity', async () => {
    const handler = await worker();
    const env = createEnv(root);
    const failed = {
      provisioningId: 'provisioning-failed', merchantId: 'merchant-failed',
      organizationId: null, name: 'Failed client', status: 'failed',
      failedStep: 'identity_organization', retryable: true,
    };
    const active = {
      ...failed, organizationId: 'org-failed', status: 'active',
      failedStep: null, retryable: false,
    };
    env.IDENTITY.getProvisioningForRoot.mockResolvedValue(failed);
    env.IDENTITY.provisionClient.mockResolvedValue(active);

    const response = await handler?.fetch(request(
      '/operator/v1/platform/provisionings/provisioning-failed/retry',
      { method: 'POST', body: JSON.stringify({}) },
    ), env);

    expect(response?.status).toBe(200);
    expect(await json(response)).toEqual(active);
    expect(env.IDENTITY.getProvisioningForRoot).toHaveBeenCalledWith({
      cookieHeader: sessionCookie,
      provisioningId: 'provisioning-failed',
      correlationId,
    });
    expect(env.IDENTITY.provisionClient).toHaveBeenCalledWith({
      sessionId: root.sessionId,
      selectedMerchantId: 'merchant-failed',
      input: {
        provisioningId: 'provisioning-failed',
        merchantId: 'merchant-failed',
        name: 'Failed client',
        correlationId,
      },
    });
  });

  test.each([
    { status: 'active', retryable: false },
    { status: 'failed', retryable: false },
    { status: 'provisioning', retryable: false },
  ] as const)('rejects a provisioning that cannot be retried: $status', async state => {
    const handler = await worker();
    const env = createEnv(root);
    env.IDENTITY.getProvisioningForRoot.mockResolvedValue({
      provisioningId: 'provisioning-a', merchantId: 'merchant-a',
      organizationId: state.status === 'active' ? 'org-a' : null,
      name: 'Client A', failedStep: state.status === 'failed' ? 'core_provision' : null,
      ...state,
    });

    const response = await handler?.fetch(request(
      '/operator/v1/platform/provisionings/provisioning-a/retry',
      { method: 'POST', body: JSON.stringify({}) },
    ), env);

    expect(response?.status).toBe(409);
    expect(await json(response)).toEqual(apiError(
      'OPERATION_FAILED', 'Provisioning cannot be retried', false,
    ));
    expect(env.IDENTITY.provisionClient).not.toHaveBeenCalled();
  });

  test.each([
    '/operator/v1/platform/clients',
    '/operator/v1/platform/provisionings/provisioning-a',
  ])('keeps root platform reads unavailable to ordinary members: %s', async pathname => {
    const handler = await worker();
    const env = createEnv(admin);

    const response = await handler?.fetch(request(pathname), env);

    expect(response?.status).toBe(403);
    expect(await json(response)).toEqual(apiError('FORBIDDEN', 'Operation is not permitted'));
    expect(env.IDENTITY.listClients).not.toHaveBeenCalled();
    expect(env.IDENTITY.getProvisioningForRoot).not.toHaveBeenCalled();
  });

  test('rejects forged tenant fields in body/query and ignores browser authority headers', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const forgedBody = await handler?.fetch(request('/operator/v1/customers/customer-a', {
      method: 'PATCH', body: JSON.stringify({ attributes: {}, merchantId: 'merchant-b' }),
    }), env);
    const forgedQuery = await handler?.fetch(request(
      '/operator/v1/credentials?merchantId=merchant-b',
    ), env);
    const headers = {
      'x-merchant-id': 'merchant-b',
      'x-actor-user-id': 'attacker',
      'x-permission': 'credentials:manage',
      'x-root': 'true',
    };
    const ignoredHeaders = await handler?.fetch(request('/operator/v1/credentials', { headers }), env);

    expect(forgedBody?.status).toBe(400);
    expect(forgedQuery?.status).toBe(400);
    expect(ignoredHeaders?.status).toBe(200);
    expect(env.CORE.upsertCustomer).not.toHaveBeenCalled();
    expect(env.CORE.listCredentials).toHaveBeenCalledWith({
      correlationId,
      actorUserId: 'user-admin',
      actorKind: 'member',
      merchantId: 'merchant-a',
      permission: 'credentials:read',
    });
  });

  test('keeps cross-merchant identifiers neutral', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.CORE.getCustomer.mockResolvedValue(apiError(
      'NOT_FOUND', 'The requested resource was not found', false,
    ));

    const response = await handler?.fetch(request('/operator/v1/customers/merchant-b-customer'), env);

    expect(response?.status).toBe(404);
    expect(await json(response)).toEqual(apiError(
      'NOT_FOUND', 'The requested resource was not found', false,
    ));
  });

  test('returns the published schema snapshot and durable operator program views', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const configuration = {
      id: 'promo-a', type: 'promo', name: 'Promo A replacement', status: 'draft',
      eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
      fallbackReward: {
        id: 'fallback', name: 'Fallback', reward: { type: 'free_shipping' },
      },
      stackable: false, priority: 0, autoApply: true,
    };
    const view = {
      configuration,
      lifecycle: {
        programRef: 'promo-a', status: 'active', activeRevision: 1,
        draftRevision: 2, updatedAt: authenticatedAt,
      },
    };
    env.CORE.listPrograms.mockResolvedValue({ programs: [view] });
    env.CORE.getProgram.mockResolvedValue(view);

    const [published, listed, detail] = await Promise.all([
      handler?.fetch(request('/operator/v1/schema/published'), env),
      handler?.fetch(request('/operator/v1/programs'), env),
      handler?.fetch(request('/operator/v1/programs/promo-a'), env),
    ]);

    expect(published?.status).toBe(200);
    expect(await json(published)).toMatchObject({ version: 1, definitions: [] });
    expect(await json(listed)).toEqual({ programs: [view] });
    expect(await json(detail)).toEqual(view);
    expect(env.CORE.getPublishedSchema).toHaveBeenCalledWith(expect.objectContaining({
      permission: 'schemas:read', merchantId: 'merchant-a',
    }));
    expect(JSON.stringify(await json(Response.json(view)))).not.toContain('usageCount');
  });
});

describe('correlation and safe downstream failures', () => {
  test('marks authenticated and show-once credential responses as non-cacheable', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const session = await handler?.fetch(request('/operator/v1/session'), env);
    const created = await handler?.fetch(request('/operator/v1/credentials', {
      method: 'POST', body: JSON.stringify({
        name: 'Server key', environment: 'local', kind: 'secret', scopes: ['schema:read'],
      }),
    }), env);
    expect(session?.headers.get('cache-control')).toBe('no-store');
    expect(created?.headers.get('cache-control')).toBe('no-store');
  });

  test('uses one correlation id through Browser, BFF, Identity and Core', async () => {
    const handler = await worker();
    const env = createEnv(admin);

    const response = await handler?.fetch(request('/operator/v1/credentials'), env);

    expect(response?.headers.get('x-correlation-id')).toBe(correlationId);
    expect(env.IDENTITY.resolveBrowserPrincipal).toHaveBeenCalledWith({
      cookieHeader: sessionCookie,
      correlationId,
    });
    expect(env.CORE.listCredentials.mock.calls[0]?.[0]).toMatchObject({ correlationId });
  });

  test('fails closed on a malformed downstream response', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.CORE.listCredentials.mockResolvedValue({ credentials: 'not-an-array' });

    const response = await handler?.fetch(request('/operator/v1/credentials'), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true,
    ));

    env.CORE.listPrograms.mockResolvedValue({ programs: [{
      configuration: {
        id: 'promo-invalid', type: 'promo', name: 'Invalid lifecycle', status: 'draft',
        eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
        stackable: false, priority: 0, autoApply: true,
      },
      lifecycle: {
        programRef: 'promo-invalid', status: 'active', draftRevision: 2,
        updatedAt: authenticatedAt,
      },
    }] });
    const malformedProgram = await handler?.fetch(request('/operator/v1/programs'), env);
    const malformedProgramBody = await json(malformedProgram);
    expect(malformedProgramBody).toEqual(apiError(
      'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true,
    ));
    expect(malformedProgram?.status).toBe(503);

    env.CORE.listPrograms.mockResolvedValue({ programs: [{
      configuration: {
        id: 'promo-skipped-revision', type: 'promo', name: 'Skipped revision', status: 'draft',
        eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
        stackable: false, priority: 0, autoApply: true,
      },
      lifecycle: {
        programRef: 'promo-skipped-revision', status: 'active', activeRevision: 1,
        draftRevision: 3, updatedAt: authenticatedAt,
      },
    }] });
    const skippedRevision = await handler?.fetch(request('/operator/v1/programs'), env);
    expect(skippedRevision?.status).toBe(503);
    expect(await json(skippedRevision)).toEqual(apiError(
      'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true,
    ));
  });

  test('fails closed when a downstream error changes the correlation id', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.CORE.getCustomer.mockResolvedValue(apiError(
      'NOT_FOUND', 'The requested resource was not found', false, 'different-correlation',
    ));

    const response = await handler?.fetch(request('/operator/v1/customers/customer-a'), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true,
    ));
  });

  test('returns a retryable canonical 503 when Identity or Core is unavailable', async () => {
    const handler = await worker();
    const identityEnv = createEnv(admin);
    identityEnv.IDENTITY.resolveBrowserPrincipal.mockRejectedValue(new Error('rpc unavailable'));
    const identityResponse = await handler?.fetch(request('/operator/v1/credentials'), identityEnv);
    expect(identityResponse?.status).toBe(503);
    expect(await json(identityResponse)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));

    const coreEnv = createEnv(admin);
    coreEnv.CORE.listCredentials.mockRejectedValue(new Error('rpc unavailable'));
    const coreResponse = await handler?.fetch(request('/operator/v1/credentials'), coreEnv);
    expect(coreResponse?.status).toBe(503);
    expect(await json(coreResponse)).toEqual(apiError(
      'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true,
    ));
  });

  test.each([
    [new NotFoundError(), 404, 'NOT_FOUND', 'The requested resource was not found'],
    [new ForbiddenError(), 403, 'FORBIDDEN', 'Operation is not permitted'],
    [new ContextValidationError('private validation detail'), 400, 'INVALID_REQUEST', 'Request validation failed'],
    [new OptimisticVersionConflictError(), 409, 'VERSION_CONFLICT', 'The submitted version conflicts'],
    [new VersionConflictError('private version detail'), 409, 'VERSION_CONFLICT', 'The submitted version conflicts'],
    [new SchemaRevisionConflictError(), 409, 'SCHEMA_CONFLICT', 'The schema state conflicts'],
    [new SchemaConflictError('private schema detail'), 409, 'SCHEMA_CONFLICT', 'The schema state conflicts'],
    [new ProgramConflictError('private program detail'), 409, 'PROGRAM_CONFLICT', 'The program state conflicts'],
  ] as const)(
    'maps a real Core %s through the fake RPC boundary to stable status/code',
    async (error, status, code, message) => {
      const handler = await worker();
      const env = createEnv(admin);
      env.CORE.listCredentials.mockRejectedValue(error);

      const response = await handler?.fetch(request('/operator/v1/credentials'), env);

      expect(response?.status).toBe(status);
      expect(await json(response)).toEqual(apiError(code, message));
    },
  );

  test('maps the real Core credential policy error without matching private text', async () => {
    const coreErrors = await import('../../api/src/errors.js') as Record<string, unknown>;
    const ErrorConstructor = coreErrors.CredentialPolicyError;
    expect(ErrorConstructor).toBeTypeOf('function');
    if (typeof ErrorConstructor !== 'function') return;
    const handler = await worker();
    const env = createEnv(admin);
    env.CORE.createCredential.mockRejectedValue(Reflect.construct(ErrorConstructor, []));

    const response = await handler?.fetch(request('/operator/v1/credentials', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unsafe browser key', environment: 'production', kind: 'publishable',
        scopes: ['schema:read'], allowedOrigins: [],
      }),
    }), env);

    expect(response?.status).toBe(400);
    expect(await json(response)).toEqual(apiError(
      'INVALID_REQUEST', 'Request validation failed', false,
    ));
  });
});

describe('semantic downstream validation', () => {
  const otherCredential = {
    id: 'credential-b', name: 'Other key', merchantId: 'merchant-b',
    environment: 'local', scopes: ['schema:read'], createdAt: authenticatedAt,
    createdBy: 'other-user', status: 'active', suffix: 'efgh', kind: 'secret',
  };
  const otherProgram = {
    id: 'promo-b', type: 'promo', name: 'Promo B', status: 'draft',
    eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
    fallbackReward: {
      id: 'fallback', name: 'Fallback', reward: { type: 'free_shipping' },
    },
    stackable: false, priority: 0, autoApply: true,
  };
  const definitionBody = {
    key: 'customer.tier', label: 'Tier', source: 'customer',
    type: 'string', required: false,
  };

  test.each([
    {
      name: 'credential list merchant', pathname: '/operator/v1/credentials', method: 'GET',
      operation: 'listCredentials', value: [otherCredential], downstream: 'CORE',
    },
    {
      name: 'path credential id', pathname: '/operator/v1/credentials/credential-a',
      method: 'DELETE', operation: 'revokeCredential', value: {
        ...otherCredential, merchantId: 'merchant-a',
      }, downstream: 'CORE',
    },
    {
      name: 'path customer ref', pathname: '/operator/v1/customers/customer-a', method: 'GET',
      operation: 'getCustomer', value: {
        externalRef: 'customer-b', attributes: {}, version: 1, updatedAt: authenticatedAt,
      }, downstream: 'CORE',
    },
    {
      name: 'path schema id', pathname: '/operator/v1/schema/definitions/definition-a',
      method: 'PUT', body: definitionBody, operation: 'updateSchemaDefinition', value: {
        id: 'definition-b', readOnly: false, referenced: false, definition: definitionBody,
      }, downstream: 'CORE',
    },
    {
      name: 'created schema key', pathname: '/operator/v1/schema/definitions',
      method: 'POST', body: definitionBody, operation: 'createSchemaDefinition', value: {
        id: 'definition-a', readOnly: false, referenced: false,
        definition: { ...definitionBody, key: 'customer.segment' },
      }, downstream: 'CORE',
    },
    {
      name: 'path program ref', pathname: '/operator/v1/programs/promo-a', method: 'GET',
      operation: 'getProgram', value: {
        configuration: otherProgram,
        lifecycle: { programRef: 'promo-b', status: 'draft', draftRevision: 1, updatedAt: authenticatedAt },
      }, downstream: 'CORE',
    },
    {
      name: 'created program ref', pathname: '/operator/v1/programs', method: 'POST',
      body: { ...otherProgram, id: 'promo-a', name: 'Promo A' },
      operation: 'createProgramDraft', value: {
        configuration: otherProgram,
        lifecycle: { programRef: 'promo-b', status: 'draft', draftRevision: 1, updatedAt: authenticatedAt },
      }, downstream: 'CORE',
    },
    {
      name: 'lifecycle program ref', pathname: '/operator/v1/programs/promo-a/publish',
      method: 'POST', body: {}, operation: 'publishProgram', value: {
        programRef: 'promo-b', status: 'active', activeRevision: 1,
        updatedAt: authenticatedAt, warnings: [],
      }, downstream: 'CORE',
    },
  ] as const)('rejects a schema-valid response with mismatched $name', async item => {
    const handler = await worker();
    const env = createEnv(admin);
    env.CORE[item.operation].mockResolvedValue(item.value);

    const response = await handler?.fetch(request(item.pathname, {
      method: item.method,
      ...('body' in item ? { body: JSON.stringify(item.body) } : {}),
    }), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true,
    ));
  });

  test.each([
    ['member', { members: [{
      id: 'membership-b', organizationId: 'org-b', userId: 'user-b',
      email: 'other@example.com', role: 'viewer', status: 'active',
    }] }, { invitations: [] }],
    ['invitation', { members: [] }, { invitations: [{
      id: 'invitation-b', organizationId: 'org-b', email: 'other@example.com',
      role: 'viewer', status: 'sent', expiresAt: '2026-07-21T10:00:00.000Z',
    }] }],
  ] as const)('rejects a schema-valid team %s from another organization', async (
    _kind,
    members,
    invitations,
  ) => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY.listMembers.mockResolvedValue(members);
    env.IDENTITY.listInvitations.mockResolvedValue(invitations);

    const response = await handler?.fetch(request('/operator/v1/team'), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));
  });

  test('rejects a root provisioning response with a mismatched requested id', async () => {
    const handler = await worker();
    const env = createEnv(root);
    env.IDENTITY.getProvisioningForRoot.mockResolvedValue({
      provisioningId: 'provisioning-other', merchantId: 'merchant-a',
      organizationId: 'org-a', name: 'Merchant A', status: 'active',
      failedStep: null, retryable: false,
    });

    const response = await handler?.fetch(request(
      '/operator/v1/platform/provisionings/provisioning-a',
    ), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));
  });

  test.each([
    {
      pathname: '/operator/v1/team/invitations/invitation-a/retry',
      method: 'POST', operation: 'retryInvitation', value: {
        id: 'invitation-b', organizationId: 'org-a', email: 'other@example.com',
        role: 'viewer', status: 'sent', expiresAt: '2026-07-21T10:00:00.000Z',
      },
    },
    {
      pathname: '/operator/v1/team/members/membership-viewer',
      method: 'PATCH', body: { role: 'operator' }, operation: 'changeMemberRole', value: {
        id: 'membership-other', organizationId: 'org-a', userId: 'user-other',
        role: 'operator', status: 'active',
      },
    },
  ] as const)('rejects a schema-valid team entity with a mismatched path id: $pathname', async item => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY[item.operation].mockResolvedValue(item.value);

    const response = await handler?.fetch(request(item.pathname, {
      method: item.method,
      body: JSON.stringify('body' in item ? item.body : {}),
    }), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));
  });
});

describe('exact auth proxy', () => {
  test.each([
    ['/auth/passkey/verify-authentication', {
      session: { id: 'session-a', token: 'must-not-reach-dashboard' },
      user: { id: 'root-a', email: 'root@example.test' },
    }],
    ['/auth/passkey/verify-registration', {
      id: 'passkey-a', publicKey: 'must-not-reach-dashboard', userId: 'root-a',
    }],
  ] as const)('reduces successful passkey verification to a neutral response: %s', async (
    pathname,
    upstreamBody,
  ) => {
    const handler = await worker();
    const env = createEnv(root);
    env.IDENTITY_AUTH.fetch.mockResolvedValue(Response.json(upstreamBody, {
      headers: { 'set-cookie': 'session=opaque; HttpOnly; SameSite=Strict' },
    }));

    const response = await handler?.fetch(request(pathname, {
      method: 'POST', body: JSON.stringify({ response: {} }),
    }), env);

    expect(response?.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(response?.headers.get('set-cookie')).toContain('HttpOnly');
  });

  test('maps an Identity auth binding exception to a correlated canonical 503', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY_AUTH.fetch.mockRejectedValue(new Error('private binding failure'));

    const response = await handler?.fetch(request('/auth/get-session'), env);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('x-correlation-id')).toBe(correlationId);
    expect(await json(response)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));
  });

  test('forwards only bounded headers/body and preserves safe cookies', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(request('/auth/sign-in/magic-link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer browser-secret',
        'x-merchant-id': 'merchant-b',
        'x-actor-user-id': 'attacker',
        'x-internal-bootstrap': 'true',
      },
      body: JSON.stringify({ email: 'admin@example.com' }),
    }), env);

    const forwarded = env.IDENTITY_AUTH.fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe('https://operator.example.test/auth/sign-in/magic-link');
    expect(forwarded.headers.get('cookie')).toBe(sessionCookie);
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    expect(forwarded.headers.get('x-correlation-id')).toBe(correlationId);
    expect(forwarded.headers.get('authorization')).toBeNull();
    expect(forwarded.headers.get('x-merchant-id')).toBeNull();
    expect(forwarded.headers.get('x-actor-user-id')).toBeNull();
    expect(forwarded.headers.get('x-internal-bootstrap')).toBeNull();
    expect(await forwarded.json()).toEqual({ email: 'admin@example.com' });
    expect(response?.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response?.headers.get('x-correlation-id')).toBe(correlationId);
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });

  test('preserves multiple Identity Set-Cookie headers separately', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY_AUTH.fetch.mockResolvedValue(new Response(null, {
      headers: [
        ['set-cookie', 'session=one; HttpOnly; SameSite=Lax'],
        ['set-cookie', 'challenge=two; HttpOnly; SameSite=Lax'],
      ],
    }));

    const response = await handler?.fetch(request('/auth/sign-out', { method: 'POST' }), env);

    expect(response?.headers.getSetCookie()).toEqual([
      'session=one; HttpOnly; SameSite=Lax',
      'challenge=two; HttpOnly; SameSite=Lax',
    ]);
  });

  test.each([
    '/auth/magic-link/verify?token=opaque',
    'https://operator.example.test/settings/team',
  ])('preserves an Identity redirect only when it resolves to the public origin: %s', async location => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY_AUTH.fetch.mockResolvedValue(new Response(null, {
      status: 302,
      headers: [
        ['location', location],
        ['set-cookie', 'session=one; HttpOnly; SameSite=Lax'],
        ['set-cookie', 'challenge=two; HttpOnly; SameSite=Lax'],
      ],
    }));

    const response = await handler?.fetch(request('/auth/magic-link/verify?token=opaque'), env);

    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe(location);
    expect(response?.headers.getSetCookie()).toEqual([
      'session=one; HttpOnly; SameSite=Lax',
      'challenge=two; HttpOnly; SameSite=Lax',
    ]);
  });

  test.each([
    'https://attacker.example/steal',
    '//attacker.example/steal',
    'javascript:alert(1)',
  ])('fails closed instead of forwarding an unsafe Identity redirect: %s', async location => {
    const handler = await worker();
    const env = createEnv(admin);
    env.IDENTITY_AUTH.fetch.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location },
    }));

    const response = await handler?.fetch(request('/auth/magic-link/verify?token=opaque'), env);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('location')).toBeNull();
    expect(await json(response)).toEqual(apiError(
      'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    ));
  });

  test.each([
    { origin: 'https://attacker.example', site: 'cross-site' },
    { origin: 'https://operator.example.test', site: 'cross-site' },
    { origin: 'https://attacker.example', site: 'same-origin' },
  ])('rejects unsafe auth requests with hostile fetch metadata before Identity: %o', async headers => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(request('/auth/sign-out', {
      method: 'POST',
      headers: {
        origin: headers.origin,
        'sec-fetch-site': headers.site,
      },
    }), env);

    expect(response?.status).toBe(403);
    expect(await json(response)).toEqual(apiError('FORBIDDEN', 'Operation is not permitted'));
    expect(env.IDENTITY_AUTH.fetch).not.toHaveBeenCalled();
  });

  test('requires Origin on every unsafe auth request', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(new Request(
      'https://operator.example.test/auth/sign-out',
      {
        method: 'POST',
        headers: { cookie: sessionCookie, 'x-correlation-id': correlationId },
      },
    ), env);

    expect(response?.status).toBe(403);
    expect(env.IDENTITY_AUTH.fetch).not.toHaveBeenCalled();
  });

  test('reconstructs the upstream auth URL and Origin exclusively from PUBLIC_APP_ORIGIN', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const incoming = new Request('https://attacker.example/auth/sign-in/magic-link?next=dashboard', {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        origin: env.PUBLIC_APP_ORIGIN,
        'sec-fetch-site': 'same-origin',
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });

    await handler?.fetch(incoming, env);

    const forwarded = env.IDENTITY_AUTH.fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe(
      'https://operator.example.test/auth/sign-in/magic-link?next=dashboard',
    );
    expect(forwarded.headers.get('origin')).toBe(env.PUBLIC_APP_ORIGIN);
  });

  test('allows a GET magic-link navigation without browser Origin metadata', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    const response = await handler?.fetch(request('/auth/magic-link/verify?token=opaque'), env);

    expect(response?.status).toBe(200);
    expect(env.IDENTITY_AUTH.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['/operator/v1/platform/clients', { name: 'Missing key' }],
    ['/operator/v1/invitations/accept', { email: 'invalid@example.com', token: 'short' }],
  ])('classifies invalid public body as 400 before RPC: %s', async (pathname, body) => {
    const handler = await worker();
    const env = createEnv(root);

    const response = await handler?.fetch(request(pathname, {
      method: 'POST', body: JSON.stringify(body),
    }), env);

    expect(response?.status).toBe(400);
    expect(await json(response)).toEqual(apiError(
      'INVALID_REQUEST', 'Request validation failed', false,
    ));
    expect(env.IDENTITY.provisionClient).not.toHaveBeenCalled();
    expect(env.IDENTITY.acceptInvitation).not.toHaveBeenCalled();
  });

  test.each([
    ['/auth/sign-up/email', 'POST'],
    ['/auth/root/bootstrap', 'POST'],
    ['/auth/internal/session', 'GET'],
    ['/internal/bootstrap', 'POST'],
    ['/auth/arbitrary-plugin-route', 'POST'],
  ])('blocks non-allowlisted private auth route %s', async (pathname, method) => {
    const handler = await worker();
    const env = createEnv(admin);

    const response = await handler?.fetch(request(pathname, { method }), env);

    expect(response?.status).toBe(404);
    expect(env.IDENTITY_AUTH.fetch).not.toHaveBeenCalled();
  });
});

describe('explicit route and permission matrix', () => {
  const routes = [
    ['GET', '/operator/v1/team', 'members:read', 'identity', 'listMembers'],
    ['POST', '/operator/v1/team/invitations', 'members:manage', 'identity', 'createInvitation'],
    ['POST', '/operator/v1/team/invitations/invitation-a/retry', 'members:manage', 'identity', 'retryInvitation'],
    ['PATCH', '/operator/v1/team/members/membership-viewer', 'members:manage', 'identity', 'changeMemberRole'],
    ['DELETE', '/operator/v1/team/members/membership-viewer', 'members:manage', 'identity', 'removeMember'],
    ['GET', '/operator/v1/credentials', 'credentials:read', 'core', 'listCredentials'],
    ['POST', '/operator/v1/credentials', 'credentials:manage', 'core', 'createCredential'],
    ['DELETE', '/operator/v1/credentials/credential-a', 'credentials:manage', 'core', 'revokeCredential'],
    ['GET', '/operator/v1/schema/definitions', 'schemas:read', 'core', 'listSchemaDefinitions'],
    ['GET', '/operator/v1/schema/published', 'schemas:read', 'core', 'getPublishedSchema'],
    ['POST', '/operator/v1/schema/definitions', 'schemas:manage', 'core', 'createSchemaDefinition'],
    ['PUT', '/operator/v1/schema/definitions/definition-a', 'schemas:manage', 'core', 'updateSchemaDefinition'],
    ['DELETE', '/operator/v1/schema/definitions/definition-a', 'schemas:manage', 'core', 'deleteSchemaDefinition'],
    ['GET', '/operator/v1/schema/definitions/definition-a/impact', 'schemas:read', 'core', 'previewSchemaDefinitionImpact'],
    ['POST', '/operator/v1/schema/definitions/definition-a/deprecate', 'schemas:manage', 'core', 'deprecateSchemaDefinition'],
    ['POST', '/operator/v1/schema/publish', 'schemas:publish', 'core', 'publishSchema'],
    ['GET', '/operator/v1/customers/customer-a', 'customers:read', 'core', 'getCustomer'],
    ['PATCH', '/operator/v1/customers/customer-a', 'customers:manage', 'core', 'upsertCustomer'],
    ['GET', '/operator/v1/programs', 'programs:read', 'core', 'listPrograms'],
    ['POST', '/operator/v1/programs', 'programs:manage', 'core', 'createProgramDraft'],
    ['GET', '/operator/v1/programs/promo-a', 'programs:read', 'core', 'getProgram'],
    ['PUT', '/operator/v1/programs/promo-a', 'programs:manage', 'core', 'updateProgramDraft'],
    ['POST', '/operator/v1/programs/promo-a/publish', 'programs:publish', 'core', 'publishProgram'],
    ['POST', '/operator/v1/programs/promo-a/pause', 'programs:manage', 'core', 'pauseProgram'],
    ['POST', '/operator/v1/programs/promo-a/resume', 'programs:manage', 'core', 'resumeProgram'],
    ['POST', '/operator/v1/programs/promo-a/end', 'programs:manage', 'core', 'endProgram'],
  ] as const;

  function routeBody(method: string, pathname: string): string | undefined {
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined;
    return JSON.stringify(
      /\/(?:retry|deprecate|publish|pause|resume|end)$/u.test(pathname)
        ? {}
        : pathname.endsWith('/invitations')
        ? { email: 'new@example.com', role: 'viewer' }
        : pathname.includes('/members/')
          ? { role: 'operator' }
          : pathname.endsWith('/credentials')
            ? { name: 'Key', environment: 'local', scopes: ['schema:read'], kind: 'secret' }
            : pathname.includes('/customers/')
              ? { attributes: {} }
              : pathname.includes('/schema/definitions')
                ? {
                  key: 'customer.tier', label: 'Tier', source: 'customer',
                  type: 'string', required: false,
                }
                : pathname.includes('/programs')
                  ? {
                    id: 'promo-a', type: 'promo', name: 'Promo A', status: 'draft',
                    eligibility: { match: 'ALL', conditions: [] },
                    rewardRules: [],
                    fallbackReward: {
                      id: 'fallback', name: 'Fallback', reward: { type: 'free_shipping' },
                    },
                    stackable: false, priority: 0, autoApply: true,
                  }
                  : {},
    );
  }

  test.each(routes)(
    '%s %s requires only %s and calls the allowlisted %s.%s adapter',
    async (method, pathname, permission, service, operation) => {
      const handler = await worker();
      const allowed = createEnv({ ...admin, permissions: [permission] });
      const denied = createEnv({ ...admin, permissions: [] });
      const body = routeBody(method, pathname);

      const allowedResponse = await handler?.fetch(request(pathname, { method, body }), allowed);
      const deniedResponse = await handler?.fetch(request(pathname, { method, body }), denied);

      expect(allowedResponse?.status).not.toBe(403);
      expect(deniedResponse?.status).toBe(403);
      const target = service === 'identity' ? allowed.IDENTITY : allowed.CORE;
      expect(target[operation]).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ['admin', admin, ROLE_PERMISSIONS.admin],
    ['operator', operator, ROLE_PERMISSIONS.operator],
    ['viewer', viewer, ROLE_PERMISSIONS.viewer],
  ] as const)('enforces the fixed %s registry permission matrix', async (
    _role,
    principal,
    expectedPermissions,
  ) => {
    expect(principal.permissions).toEqual(expectedPermissions);
    const handler = await worker();
    for (const [method, pathname, permission] of routes) {
      const env = createEnv(principal);
      const response = await handler?.fetch(request(pathname, {
        method,
        body: routeBody(method, pathname),
      }), env);
      expect(response?.status === 403, `${method} ${pathname}`).toBe(
        !expectedPermissions.includes(permission),
      );
    }
  });

  test.each([
    ['GET', '/operator/v1/redemptions'],
    ['POST', '/operator/v1/redemptions'],
    ['POST', '/operator/v1/programs/promo-a/redeem'],
    ['POST', '/operator/v1/playground/commit'],
  ])('exposes no public operator redemption route: %s %s', async (method, pathname) => {
    const handler = await worker();
    const env = createEnv(admin);

    const response = await handler?.fetch(request(pathname, { method }), env);

    expect(response?.status).toBe(404);
    expect(Object.keys(env.CORE)).not.toContain('redeem');
  });
});

describe('assets and deployment topology', () => {
  test('serves dashboard assets without swallowing API 404s', async () => {
    const handler = await worker();
    const env = createEnv(admin);

    const page = await handler?.fetch(request('/settings/team'), env);
    const asset = await handler?.fetch(request('/assets/app.js'), env);
    const api404 = await handler?.fetch(request('/operator/v1/not-a-route'), env);

    expect(await page?.text()).toBe('<main>dashboard</main>');
    expect(await asset?.text()).toBe('asset-js');
    expect(api404?.status).toBe(404);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(2);
  });

  test('maps an unexpected asset Worker fault to canonical Operator Web unavailable', async () => {
    const handler = await worker();
    const env = createEnv(admin);
    env.ASSETS.fetch.mockRejectedValue(new Error('private asset failure'));

    const response = await handler?.fetch(request('/settings/team'), env);

    expect(response?.status).toBe(503);
    expect(await json(response)).toEqual(apiError(
      'OPERATOR_WEB_UNAVAILABLE', 'Operator service is temporarily unavailable', true,
    ));
  });

  test('documents distinct public staging origins and defers the Audit UI to Task 12', async () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const [environmentExample, operations, trackedPlan] = await Promise.all([
      readFile(path.join(root, '.env.staging.example'), 'utf8'),
      readFile(path.join(root, 'docs/integration/staging-operations.md'), 'utf8'),
      readFile(
        path.join(root, 'docs/superpowers/plans/2026-07-19-production-operator-platform.md'),
        'utf8',
      ),
    ]);
    expect(environmentExample).toContain(
      'STAGING_API_ORIGIN=https://api.staging.wastd.dev',
    );
    expect(environmentExample).toContain(
      'STAGING_OPERATOR_ORIGIN=https://operator.staging.wastd.dev',
    );
    expect(operations).toContain('https://api.staging.wastd.dev');
    expect(operations).toContain('https://operator.staging.wastd.dev');
    const task8 = trackedPlan.slice(
      trackedPlan.indexOf('### Task 8:'), trackedPlan.indexOf('### Task 9:'),
    );
    const task12 = trackedPlan.slice(
      trackedPlan.indexOf('### Task 12:'), trackedPlan.indexOf('### Task 13:'),
    );
    expect(task8).not.toMatch(/Audit\.tsx|merged audit/iu);
    expect(task12).toContain('apps/dashboard/src/pages/settings/Audit.tsx');
    expect(task12).toContain('apps/dashboard/src/lib/bff-client.ts');
    expect(task12).toContain('apps/dashboard/src/pages/settings/Audit.test.tsx');
    expect(task12).toMatch(/sequenc.*Task 8.*Task 12/isu);
    expect(task12).toMatch(/Notion.*Task 13/isu);
  });

  test('declares exactly three local Workers, two D1 databases, and no Operator Web D1', async () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const [
      operatorWrangler,
      apiWrangler,
      identityWrangler,
      workerSource,
      rootPackageSource,
      operatorPackageSource,
      apiPackageSource,
      identityPackageSource,
    ] = await Promise.all([
      readFile(path.join(root, 'apps/operator-web/wrangler.toml'), 'utf8'),
      readFile(path.join(root, 'apps/api/wrangler.toml'), 'utf8'),
      readFile(path.join(root, 'apps/identity/wrangler.toml'), 'utf8'),
      readFile(path.join(root, 'apps/operator-web/src/worker.ts'), 'utf8'),
      readFile(path.join(root, 'package.json'), 'utf8'),
      readFile(path.join(root, 'apps/operator-web/package.json'), 'utf8'),
      readFile(path.join(root, 'apps/api/package.json'), 'utf8'),
      readFile(path.join(root, 'apps/identity/package.json'), 'utf8'),
    ]);

    expect(operatorWrangler).toContain('name = "incentives-operator-web-local"');
    expect(operatorWrangler).toContain('binding = "IDENTITY_AUTH"');
    expect(operatorWrangler).toContain('binding = "IDENTITY"');
    expect(operatorWrangler).toContain('entrypoint = "IdentityOperatorService"');
    expect(operatorWrangler).toContain('binding = "CORE"');
    expect(operatorWrangler).toContain('entrypoint = "CoreOperatorService"');
    expect(operatorWrangler).toContain('directory = "../dashboard/dist"');
    expect(operatorWrangler).toContain('PUBLIC_APP_ORIGIN = "http://localhost:5173"');
    expect(operatorWrangler).toContain('not_found_handling = "single-page-application"');
    expect(operatorWrangler).toContain(
      'run_worker_first = ["/auth/*", "/internal/*", "/operator/v1/*"]',
    );
    expect(operatorWrangler).toContain('port = 5173');
    expect(apiWrangler).toContain('port = 8787');
    expect(identityWrangler).toContain('port = 8788');
    expect(operatorWrangler).not.toContain('OPERATOR_SELECTION_SECRET');
    expect(`${operatorWrangler}\n${workerSource}`).not.toMatch(/D1Database|d1_databases|AUTH_DB|\bDB\b/);
    expect(`${apiWrangler}\n${identityWrangler}`.match(/\[\[d1_databases\]\]/g) ?? [])
      .toHaveLength(2);
    expect(`${operatorWrangler}\n${apiWrangler}\n${identityWrangler}`).not.toMatch(
      /\[env\.(?:staging|prod|production)\]/,
    );
    const rootPackage = JSON.parse(rootPackageSource) as { scripts: Record<string, string> };
    const operatorPackage = JSON.parse(operatorPackageSource) as { scripts: Record<string, string> };
    const apiPackage = JSON.parse(apiPackageSource) as { scripts: Record<string, string> };
    const identityPackage = JSON.parse(identityPackageSource) as { scripts: Record<string, string> };
    expect(rootPackage.scripts['dev:local']).toBe('node scripts/local-workers-runner.mjs');
    expect(operatorPackage.scripts['dev:local']).toContain('wrangler dev');
    expect(apiPackage.scripts['dev:local']).toContain('wrangler dev');
    expect(identityPackage.scripts['dev:local']).toContain('wrangler dev');
  });

  test('generates the same three-Worker staging graph without Operator Web D1', async () => {
    const config = await import('../../../scripts/staging-wrangler-config.mjs') as {
      loadStagingConfiguration(environment: Record<string, string>): unknown;
      renderStagingWranglerConfig(app: string, config: unknown, root: string): string;
      stagingWranglerArguments(app: string, action: string, configPath: string): string[];
    };
    const staging = config.loadStagingConfiguration({
      STAGING_ENVIRONMENT: 'staging',
      STAGING_PRODUCT_D1_ID: 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1',
      STAGING_AUTH_D1_ID: '6a65017f-df57-474e-bebb-e676e09377e5',
      STAGING_OPERATOR_ORIGIN: 'https://operator.staging.example.com',
      STAGING_API_ORIGIN: 'https://api.staging.example.com',
      STAGING_PASSKEY_RP_ID: 'operator.staging.example.com',
      STAGING_ALLOWED_RECIPIENTS: '["operator@example.com"]',
    });
    const operator = config.renderStagingWranglerConfig('operator-web', staging, '/repository');
    const api = config.renderStagingWranglerConfig('api', staging, '/repository');
    const identity = config.renderStagingWranglerConfig('identity', staging, '/repository');

    expect(operator).toContain('name = "incentives-operator-web-staging"');
    expect(operator).toContain('service = "incentives-identity-staging"');
    expect(operator).toContain('entrypoint = "IdentityOperatorService"');
    expect(operator).toContain('service = "incentives-api-staging"');
    expect(operator).toContain('entrypoint = "CoreOperatorService"');
    expect(operator).toContain('PUBLIC_APP_ORIGIN = "https://operator.staging.example.com"');
    expect(operator).toContain(
      'routes = [{ pattern = "operator.staging.example.com", custom_domain = true }]',
    );
    expect(operator).toContain('not_found_handling = "single-page-application"');
    expect(operator).toContain(
      'run_worker_first = ["/auth/*", "/internal/*", "/operator/v1/*"]',
    );
    expect(operator).not.toMatch(/d1_databases|database_id|AUTH_DB|binding = "DB"/);
    expect(api.match(/^routes\s*=/gmu) ?? []).toHaveLength(1);
    expect(api).toContain(
      'routes = [{ pattern = "api.staging.example.com", custom_domain = true }]',
    );
    expect(operator.match(/^routes\s*=/gmu) ?? []).toHaveLength(1);
    for (const serviceOnly of [identity]) {
      expect(serviceOnly).toContain('workers_dev = false');
      expect(serviceOnly).toContain('preview_urls = false');
      expect(serviceOnly).not.toMatch(/^routes\s*=/mu);
    }
    expect(config.stagingWranglerArguments('operator-web', 'deploy', '/tmp/config'))
      .toEqual(['deploy', '--config', '/tmp/config']);
  });

  test('has one platform-client implementation rather than a duplicate route adapter', async () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const [workerSource, platformSource] = await Promise.all([
      readFile(path.join(root, 'apps/operator-web/src/worker.ts'), 'utf8'),
      readFile(path.join(root, 'apps/operator-web/src/routes/platform.ts'), 'utf8'),
    ]);
    expect(workerSource.match(/async function handleProvisionClient\(/g)).toHaveLength(1);
    expect(workerSource.match(/return handleProvisionClient\(/g)).toHaveLength(1);
    expect(workerSource.match(/async function handleRootPlatformRead\(/g)).toHaveLength(1);
    expect(platformSource).not.toContain('/operator\\/v1\\/platform\\/clients');
  });
});
