import { stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { request, type APIRequestContext } from '@playwright/test';
import { E2eCapabilitiesSchema, OperatorSessionViewSchema,
  OperatorTeamResponseSchema } from '@incentives/contracts';

import type { Target } from './config.js';

export class ApiFailure extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`API request failed: ${status} ${code}`);
  }
}

export async function requireE2eCapabilities(client: {
  request(method: 'GET', path: string): Promise<unknown>;
}): Promise<void> {
  try {
    E2eCapabilitiesSchema.parse(await client.request(
      'GET', '/operator/v1/platform/e2e-capabilities',
    ));
  } catch {
    throw new Error('E2E prewrite capability handshake failed: apply Product 0008 and Auth 0005/0006 migrations, then deploy matching Core, Identity, and Operator Workers');
  }
}

export function requireOperatorStorageState(env: NodeJS.ProcessEnv): string {
  const path = env.E2E_OPERATOR_STORAGE_STATE;
  if (!path) {
    throw new Error('E2E_OPERATOR_STORAGE_STATE must point to an authorized Playwright storage-state file; bootstrap root with the supported passkey flow first');
  }
  return path;
}

export async function openOperatorClient(target: Target, env: NodeJS.ProcessEnv): Promise<OperatorClient> {
  const path = requireOperatorStorageState(env);
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error('Operator storage-state file must be a private regular file (mode 0600)');
  }
  const context = await request.newContext({
    baseURL: target.operatorOrigin,
    storageState: path,
    extraHTTPHeaders: { origin: target.operatorOrigin },
  });
  const client = new OperatorClient(context, target.operatorOrigin);
  try {
    await client.requireRoot();
    return client;
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

const expectedPermissions = {
  admin: [
    'members:read', 'members:manage', 'schemas:read', 'schemas:manage',
    'schemas:publish', 'customers:read', 'customers:manage', 'programs:read',
    'programs:manage', 'programs:publish', 'evaluations:run',
    'redemptions:commit', 'credentials:read', 'credentials:manage', 'audit:read',
  ],
  operator: [
    'schemas:read', 'schemas:manage', 'schemas:publish', 'customers:read',
    'customers:manage', 'programs:read', 'programs:manage',
    'programs:publish', 'evaluations:run', 'redemptions:commit', 'audit:read',
  ],
  viewer: ['schemas:read', 'programs:read', 'evaluations:run', 'audit:read'],
} as const;

export async function verifyFixtureMemberSession(target: Target, input: {
  cookieHeader: string; userId: string; membershipId: string;
  merchantId: string; role: 'admin' | 'operator' | 'viewer';
}): Promise<void> {
  if (!input.cookieHeader || /[\r\n]/u.test(input.cookieHeader)) {
    throw new Error('Invalid fixture session cookie');
  }
  const context = await request.newContext({ baseURL: target.operatorOrigin,
    extraHTTPHeaders: { cookie: input.cookieHeader, origin: target.operatorOrigin } });
  try {
    const sessionResponse = await context.get('/operator/v1/session', { failOnStatusCode: false });
    if (!sessionResponse.ok()) throw new Error('Fixture member sign-in was rejected');
    const session = OperatorSessionViewSchema.parse(await sessionResponse.json());
    if (session.userId !== input.userId || session.membershipId !== input.membershipId
      || session.merchantId !== input.merchantId || session.platformRole !== undefined
      || session.merchantSelectionRequired) {
      throw new Error('Fixture session identity crossed the run boundary');
    }
    assert.deepEqual(session.authenticationMethods, ['e2e-fixture']);
    assert.deepEqual(session.permissions, expectedPermissions[input.role]);
    const teamResponse = await context.get('/operator/v1/team', { failOnStatusCode: false });
    if (input.role === 'admin') {
      if (!teamResponse.ok()) throw new Error('Fixture admin lacks members:read permission');
      const team = OperatorTeamResponseSchema.parse(await teamResponse.json());
      if (!team.members.some(member => member.id === input.membershipId
        && member.userId === input.userId && member.role === 'admin'
        && member.status === 'active')) {
        throw new Error('Fixture admin membership is not active');
      }
    } else if (teamResponse.status() !== 403) {
      throw new Error('Non-admin fixture unexpectedly accessed the team API');
    }
  } finally {
    await context.dispose();
  }
}

export class OperatorClient {
  constructor(
    private readonly context: APIRequestContext,
    private readonly origin: string,
  ) {}

  async close(): Promise<void> {
    await this.context.dispose();
  }

  async request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    if (!path.startsWith('/operator/v1/')) throw new Error('Only protected operator routes are available');
    const response = await this.context.fetch(path, {
      method,
      headers: { origin: this.origin },
      ...(body === undefined ? {} : { data: body }),
      failOnStatusCode: false,
    });
    if (!response.ok()) {
      let code = 'UNKNOWN';
      try {
        const value = await response.json() as { error?: { code?: unknown } };
        if (typeof value.error?.code === 'string') code = value.error.code;
      } catch { /* Keep the response body out of errors and logs. */ }
      throw new ApiFailure(response.status(), code);
    }
    if (response.status() === 204) return null;
    return response.json() as Promise<unknown>;
  }

  async requireRoot(): Promise<void> {
    const response = await this.request('GET', '/operator/v1/session');
    if (typeof response !== 'object' || response === null || Reflect.get(response, 'platformRole') !== 'root') {
      throw new Error('An authenticated root operator session is required');
    }
    OperatorSessionViewSchema.parse(response);
  }
}

export class PublicApiClient {
  private constructor(private readonly context: APIRequestContext) {}

  static async withToken(target: Target, token: string): Promise<PublicApiClient> {
    const context = await request.newContext({
      baseURL: target.apiOrigin,
      extraHTTPHeaders: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    return new PublicApiClient(context);
  }

  async close(): Promise<void> {
    await this.context.dispose();
  }

  async post(path: '/v1/evaluate' | '/v1/redemptions', body: unknown): Promise<unknown> {
    const response = await this.context.post(path, { data: body, failOnStatusCode: false });
    if (!response.ok()) {
      let code = 'UNKNOWN';
      try {
        const value = await response.json() as { error?: { code?: unknown } };
        if (typeof value.error?.code === 'string') code = value.error.code;
      } catch { /* Do not expose response bodies, which may contain sensitive data. */ }
      throw new ApiFailure(response.status(), code);
    }
    return response.json() as Promise<unknown>;
  }
}
