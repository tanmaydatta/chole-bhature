import { afterEach, describe, expect, test, vi } from 'vitest';
import type { VariableDefinition } from '@incentives/contracts';

import { BffClientError, createBffClient } from './bff-client';

const session = {
  userId: 'user-admin',
  authenticationMethods: ['magic-link'],
  authenticatedAt: '2026-07-20T10:00:00.000Z',
  organizationId: 'org-a',
  merchantId: 'merchant-a',
  membershipId: 'membership-admin',
  permissions: ['members:read', 'members:manage', 'credentials:read', 'credentials:manage'],
  merchantSelectionRequired: false,
};

afterEach(() => vi.restoreAllMocks());

describe('same-origin BFF client', () => {
  test('includes browser credentials and parses canonical successful responses', async () => {
    const fetcher = vi.fn(async () => Response.json(session));
    const client = createBffClient(fetcher);

    await expect(client.session()).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledWith('/operator/v1/session', {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  });

  test('preserves canonical status, code, retryability, and correlation id', async () => {
    const fetcher = vi.fn(async () => Response.json({
      error: {
        code: 'OPERATION_FAILED', message: 'Provisioning cannot be retried',
        retryable: false, correlationId: 'corr-conflict',
      },
    }, { status: 409 }));

    await expect(createBffClient(fetcher).retryProvisioning('provisioning-a')).rejects.toMatchObject({
      name: 'BffClientError', status: 409, code: 'OPERATION_FAILED', retryable: false,
      correlationId: 'corr-conflict', message: 'Provisioning cannot be retried',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/operator/v1/platform/provisionings/provisioning-a/retry',
      expect.objectContaining({ method: 'POST', credentials: 'include', body: '{}' }),
    );
  });

  test('rejects unsafe or noncanonical success and error responses', async () => {
    const malformedSuccess = createBffClient(vi.fn(async () => Response.json({
      userId: 'user-admin', sessionId: 'must-never-reach-browser',
    })));
    const malformedError = createBffClient(vi.fn(async () => Response.json({
      error: { code: 'FORBIDDEN', message: 'private detail' },
    }, { status: 403, headers: { 'x-correlation-id': 'corr-header' } })));

    await expect(malformedSuccess.session()).rejects.toEqual(expect.objectContaining({
      name: 'BffClientError', status: 502, code: 'INVALID_RESPONSE', retryable: true,
    }));
    await expect(malformedError.team()).rejects.toEqual(expect.objectContaining({
      name: 'BffClientError', status: 502, code: 'INVALID_RESPONSE', retryable: true,
      correlationId: 'corr-header',
    }));
    expect(BffClientError).toBeDefined();
  });

  test('sends only canonical bodies without browser authority fields', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({
        credential: {
          id: 'credential-a', name: 'Key', merchantId: 'merchant-a', environment: 'local',
          scopes: ['schema:read'], createdAt: '2026-07-20T10:00:00.000Z',
          createdBy: 'user-admin', status: 'active', suffix: 'abcd', kind: 'secret',
        },
        token: `sk_${'a'.repeat(32)}`,
      }, { status: 201 });
      return Response.json([]);
    });
    const client = createBffClient(fetcher);

    await client.createCredential({
      name: 'Key', environment: 'local', scopes: ['schema:read'], kind: 'secret',
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      name: 'Key', environment: 'local', scopes: ['schema:read'], kind: 'secret',
    });
    expect(body).not.toHaveProperty('merchantId');
    expect(body).not.toHaveProperty('permission');
    expect(body).not.toHaveProperty('actorUserId');
  });

  test('strictly parses the server-authoritative root recovery handoff', async () => {
    const codes = Array.from(
      { length: 8 }, (_, index) => `${String(index).padStart(2, '0')}${'r'.repeat(41)}`,
    );
    const valid = createBffClient(vi.fn(async () => Response.json({ userId: 'root-1', codes })));
    await expect(valid.rotateRootRecoveryCodes()).resolves.toEqual({ userId: 'root-1', codes });

    const missingId = createBffClient(vi.fn(async () => Response.json({ codes })));
    await expect(missingId.rotateRootRecoveryCodes()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 502,
    });
  });

  test('reads one root provisioning through its canonical encoded route', async () => {
    const provisioning = {
      provisioningId: 'provisioning/a', merchantId: 'merchant-a', organizationId: null,
      name: 'Client A', status: 'failed', failedStep: 'core_provision', retryable: true,
    };
    const fetcher = vi.fn(async () => Response.json(provisioning));
    await expect(createBffClient(fetcher).provisioning('provisioning/a'))
      .resolves.toEqual(provisioning);
    expect(fetcher).toHaveBeenCalledWith(
      '/operator/v1/platform/provisionings/provisioning%2Fa',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  test('uses exact encoded live-authoring routes and runtime-parses every response', async () => {
    const definition: VariableDefinition = {
      key: 'customer.tier', label: 'Tier', source: 'customer', type: 'enum',
      required: true, enumValues: ['gold', 'silver'],
    };
    const configuration = {
      id: 'promo/a', type: 'promo', name: 'Gold offer', status: 'draft',
      eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
      fallbackReward: { id: 'fallback', name: 'Fallback', reward: { type: 'free_shipping' } },
      stackable: false, priority: 10, autoApply: true,
    } as const;
    const view = {
      configuration,
      activeConfiguration: { ...configuration, status: 'active' as const },
      draftConfiguration: configuration,
      lifecycle: {
        programRef: 'promo/a', status: 'active', activeRevision: 1, draftRevision: 2,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    } as const;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/operator/v1/schema/definitions') {
        if (init?.method === 'POST') return Response.json({
          id: 'definition/a', definition, readOnly: false, referenced: false,
        }, { status: 201 });
        return Response.json({ definitions: [], draftVersion: 2, publishedVersion: 1 });
      }
      if (path === '/operator/v1/schema/published') return Response.json({
        version: 1, publishedAt: '2026-07-20T10:00:00.000Z', definitions: [definition],
        jsonSchema: {}, sample: {},
      });
      if (path === '/operator/v1/customers/customer%2Fa') return Response.json({
        externalRef: 'customer/a', attributes: { tier: 'gold' }, version: 2,
        updatedAt: '2026-07-20T10:00:00.000Z',
      });
      if (path === '/operator/v1/programs/promo%2Fa') return Response.json(view);
      throw new Error(`Unexpected ${init?.method ?? 'GET'} ${path}`);
    });
    const client = createBffClient(fetcher);

    await expect(client.schemaDefinitions()).resolves.toMatchObject({ publishedVersion: 1 });
    await expect(client.createSchemaDefinition(definition)).resolves.toMatchObject({
      id: 'definition/a',
    });
    await expect(client.publishedSchema()).resolves.toMatchObject({ version: 1 });
    await expect(client.customer('customer/a')).resolves.toMatchObject({ version: 2 });
    await expect(client.program('promo/a')).resolves.toEqual(view);
    expect(fetcher).toHaveBeenCalledWith(
      '/operator/v1/programs/promo%2Fa',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );

    const malformed = createBffClient(vi.fn(async () => Response.json({
      configuration, lifecycle: { ...view.lifecycle, unexpectedCounter: 42 },
    }, { headers: { 'x-correlation-id': 'corr-malformed' } })));
    await expect(malformed.program('promo/a')).rejects.toMatchObject({
      status: 502, code: 'INVALID_RESPONSE', correlationId: 'corr-malformed',
    });
  });
});
