import {
  ApiErrorSchema,
  AuditEntrySchema,
  CoreMerchantActivationResultSchema,
  CoreMerchantProvisionResultSchema,
  MerchantActivationResultSchema,
  MerchantProvisionResultSchema,
  type MerchantActivationRequest,
  type CoreMerchantActivationResult,
  type CoreMerchantProvisionResult,
  type MerchantProvisionRequest,
  type MerchantProvisionResult,
  type OperatorCallContext,
  type OperatorPrincipal,
} from '@incentives/contracts';
import { env } from 'cloudflare:workers';
import { createExecutionContext, SELF } from 'cloudflare:test';
import { makeSignature } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  bootstrapRoot,
  runBootstrapRootCommand,
} from '../src/cli/bootstrap-root.js';
import * as bootstrapCli from '../src/cli/bootstrap-root.js';
import { permissionsForRole, type FixedRole } from '../src/authorization/registry.js';
import { createIdentityOperatorService } from '../src/routes/internal.js';
import {
  createInvitationService,
  type InvitationEmailAdapter,
} from '../src/services/invitations.js';
import {
  createOrganizationService,
  type CoreMerchantProvisioningClient,
} from '../src/services/organizations.js';
import organizationsSource from '../src/services/organizations.ts?raw';
import internalRoutesSource from '../src/routes/internal.ts?raw';
import identityPackageSource from '../package.json?raw';
import organizationsMigrationSource from '../migrations/0003_organizations_authorization.sql?raw';
import { sha256 } from '../src/recovery.js';
import { IdentityOperatorService, type Env } from '../src/worker.js';
import {
  createTestCredential,
  registrationResponse,
  type TestCredential,
} from './webauthn-fixture.js';

const testEnv = env as typeof env & {
  AUTH_DB: D1Database;
  AUTH_SECRET: string;
  COOKIE_PREFIX: string;
  WRANGLER_CONFIG_TEXT: string;
};
const publicOrigin = 'https://operator.example.test';
const faultTriggers = [
  'test_fail_organization_create',
  'test_fail_organization_activate',
  'test_fail_security_audit',
] as const;

async function signedSessionCookie(token: string): Promise<string> {
  const signature = await makeSignature(token, testEnv.AUTH_SECRET);
  return `__Secure-${testEnv.COOKIE_PREFIX}.session_token=`
    + encodeURIComponent(`${token}.${signature}`);
}

function rootPrincipal(merchantId = 'merchant-a'): OperatorPrincipal {
  return {
    userId: 'root-1',
    sessionId: 'root-session',
    authenticationMethods: ['passkey'],
    authenticatedAt: '2026-07-20T12:00:00.000Z',
    platformRole: 'root',
    merchantId,
    permissions: [],
  };
}

function memberPrincipal(input: {
  userId: string;
  organizationId: string;
  merchantId: string;
  membershipId: string;
  role: FixedRole;
}): OperatorPrincipal {
  return {
    userId: input.userId,
    sessionId: `session-${input.userId}`,
    authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T12:00:00.000Z',
    organizationId: input.organizationId,
    merchantId: input.merchantId,
    membershipId: input.membershipId,
    permissions: permissionsForRole(input.role),
  };
}

async function dropFaultTriggers(): Promise<void> {
  for (const name of faultTriggers) {
    await testEnv.AUTH_DB.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  }
}

async function clearIdentityData(): Promise<void> {
  await dropFaultTriggers();
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare('DELETE FROM identity_audit'),
    testEnv.AUTH_DB.prepare('DELETE FROM invitations'),
    testEnv.AUTH_DB.prepare('DELETE FROM memberships'),
    testEnv.AUTH_DB.prepare('DELETE FROM organizations'),
    testEnv.AUTH_DB.prepare('DELETE FROM client_provisionings'),
    testEnv.AUTH_DB.prepare('DELETE FROM local_email_capture'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_rate_limit'),
    testEnv.AUTH_DB.prepare('DELETE FROM root_recovery_code'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_flow'),
    testEnv.AUTH_DB.prepare('DELETE FROM rateLimit'),
    testEnv.AUTH_DB.prepare('DELETE FROM passkey'),
    testEnv.AUTH_DB.prepare('DELETE FROM verification'),
    testEnv.AUTH_DB.prepare('DELETE FROM account'),
    testEnv.AUTH_DB.prepare('DELETE FROM session'),
    testEnv.AUTH_DB.prepare('DELETE FROM auth_profile'),
    testEnv.AUTH_DB.prepare('DELETE FROM user'),
  ]);
}

async function seedRoot(status: 'pending' | 'active' = 'active'): Promise<void> {
  const now = Date.now();
  const statements = [
    testEnv.AUTH_DB.prepare(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('root-1', 'Root', 'root@example.test', 1, ?1, ?1)
    `).bind(now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES ('root-1', 'root', ?1, 0)
    `).bind(status),
  ];
  if (status === 'active') {
    statements.push(testEnv.AUTH_DB.prepare(`
      INSERT INTO session (
        id, expiresAt, token, createdAt, updatedAt, userId,
        authenticationMethod, authenticatedAt, recoveryOnly
      ) VALUES ('root-session', ?1, 'token-root-session', ?2, ?2, 'root-1', 'passkey', ?2, 0)
    `).bind(now + 60_000, now));
  }
  await testEnv.AUTH_DB.batch(statements);
}

async function seedOrganization(input: {
  id?: string;
  merchantId?: string;
  status?: 'provisioning' | 'active';
} = {}): Promise<void> {
  const id = input.id ?? 'org-a';
  const merchantId = input.merchantId ?? 'merchant-a';
  const now = Date.now();
  const provisioningId = `provision-${merchantId}`;
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare(`
      INSERT INTO client_provisionings (
        provisioning_id, merchant_id, organization_id, name, status, current_step,
        failed_step, retryable, attempt_count, created_at, updated_at, correlation_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 0, 1, ?7, ?7, ?8)
    `).bind(
      provisioningId,
      merchantId,
      id,
      `Organization ${id}`,
      input.status ?? 'active',
      input.status === 'provisioning' ? 'identity_activation' : 'complete',
      now,
      `corr-${merchantId}`,
    ),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO organizations (
        id, merchant_id, provisioning_id, name, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `).bind(
      id,
      merchantId,
      provisioningId,
      `Organization ${id}`,
      input.status ?? 'active',
      now,
    ),
  ]);
}

async function seedMember(input: {
  id: string;
  userId: string;
  email: string;
  role: FixedRole;
  organizationId?: string;
  status?: 'active' | 'removed';
  sessions?: number;
}): Promise<void> {
  const now = Date.now();
  const organizationId = input.organizationId ?? 'org-a';
  const statements = [
    testEnv.AUTH_DB.prepare(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?1, ?1, ?2, 1, ?3, ?3)
    `).bind(input.userId, input.email, now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES (?1, 'employee', 'active', 1)
    `).bind(input.userId),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO memberships (
        id, organization_id, user_id, role, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `).bind(
      input.id,
      organizationId,
      input.userId,
      input.role,
      input.status ?? 'active',
      now,
    ),
  ];
  for (let index = 0; index < (input.sessions ?? 1); index += 1) {
    statements.push(testEnv.AUTH_DB.prepare(`
      INSERT INTO session (
        id, expiresAt, token, createdAt, updatedAt, userId,
        authenticationMethod, authenticatedAt, recoveryOnly
      ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'magic-link', ?4, 0)
    `).bind(
      `session-${input.userId}-${index}`,
      now + 60_000,
      `token-${input.userId}-${index}`,
      now,
      input.userId,
    ));
  }
  await testEnv.AUTH_DB.batch(statements);
}

class FakeCoreClient implements CoreMerchantProvisioningClient {
  readonly merchants = new Map<string, MerchantProvisionResult>();
  provisionCalls = 0;
  activationCalls = 0;
  failProvision = 0;
  failActivation = 0;
  permanentProvisionFailure = false;
  mismatchedProvisionResult = false;
  mismatchedActivationResult = false;

  async provisionMerchant(
    context: OperatorCallContext,
    input: MerchantProvisionRequest,
  ): Promise<CoreMerchantProvisionResult> {
    this.provisionCalls += 1;
    expect(context).toMatchObject({
      actorKind: 'root',
      merchantId: input.id,
      permission: 'credentials:manage',
    });
    if (this.permanentProvisionFailure) {
      return CoreMerchantProvisionResultSchema.parse({
        ok: false,
        error: {
          code: 'CONFLICT', message: 'Merchant provisioning identity conflicts', retryable: false,
        },
      });
    }
    if (this.failProvision-- > 0) {
      return CoreMerchantProvisionResultSchema.parse({
        ok: false,
        error: {
          code: 'UNAVAILABLE', message: 'Core merchant operation is unavailable', retryable: true,
        },
      });
    }
    const existing = [...this.merchants.values()].find(record =>
      record.id === input.id || record.provisioningId === input.provisioningId,
    );
    if (existing) {
      if (
        existing.id !== input.id
        || existing.name !== input.name
        || existing.provisioningId !== input.provisioningId
      ) return CoreMerchantProvisionResultSchema.parse({
        ok: false,
        error: {
          code: 'CONFLICT', message: 'Merchant provisioning identity conflicts', retryable: false,
        },
      });
      return CoreMerchantProvisionResultSchema.parse({ ok: true, value: existing });
    }
    const now = new Date().toISOString();
    const result = MerchantProvisionResultSchema.parse({
      ...input,
      status: 'provisioning',
      createdAt: now,
      updatedAt: now,
    });
    this.merchants.set(input.id, result);
    return CoreMerchantProvisionResultSchema.parse({
      ok: true,
      value: this.mismatchedProvisionResult
        ? { ...result, name: `${result.name} forged` }
        : result,
    });
  }

  async activateMerchant(
    context: OperatorCallContext,
    input: MerchantActivationRequest,
  ): Promise<CoreMerchantActivationResult> {
    this.activationCalls += 1;
    expect(context).toMatchObject({
      actorKind: 'root',
      merchantId: input.id,
      permission: 'credentials:manage',
    });
    if (this.failActivation-- > 0) {
      return CoreMerchantActivationResultSchema.parse({
        ok: false,
        error: {
          code: 'UNAVAILABLE', message: 'Core merchant operation is unavailable', retryable: true,
        },
      });
    }
    const existing = this.merchants.get(input.id);
    if (!existing || existing.provisioningId !== input.provisioningId) {
      return CoreMerchantActivationResultSchema.parse({
        ok: false,
        error: {
          code: 'CONFLICT', message: 'Merchant provisioning identity conflicts', retryable: false,
        },
      });
    }
    const result = MerchantActivationResultSchema.parse({
      ...existing,
      status: 'active',
      updatedAt: new Date().toISOString(),
    });
    this.merchants.set(input.id, result);
    return CoreMerchantActivationResultSchema.parse({
      ok: true,
      value: this.mismatchedActivationResult
        ? { ...result, provisioningId: `${result.provisioningId}-forged` }
        : result,
    });
  }
}

class CapturingMailer implements InvitationEmailAdapter {
  readonly messages: Array<{ to: string; text: string }> = [];
  readonly attempts: Array<{ to: string; text: string }> = [];
  failures = 0;

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.attempts.push({ to: message.to, text: message.text });
    if (this.failures-- > 0) throw new Error('EMAIL_UNAVAILABLE');
    this.messages.push({ to: message.to, text: message.text });
  }
}

function tokenFrom(message: { text: string }): string {
  const link = message.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('Expected invitation link');
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error('Expected invitation token');
  return token;
}

async function registerReplacement(cookie: string, credential: TestCredential): Promise<Response> {
  const optionsResponse = await SELF.fetch(`${publicOrigin}/auth/passkey/generate-register-options`, {
    headers: { cookie, origin: publicOrigin },
  });
  expect(optionsResponse.status).toBe(200);
  const challengeCookie = optionsResponse.headers.get('set-cookie')?.split(';', 1)[0];
  const options = await optionsResponse.json<{ challenge: string; rp: { id: string } }>();
  return SELF.fetch(`${publicOrigin}/auth/passkey/verify-registration`, {
    method: 'POST',
    headers: {
      cookie: `${cookie}; ${challengeCookie ?? ''}`,
      origin: publicOrigin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'root passkey',
      response: await registrationResponse(options, credential, publicOrigin, true),
    }),
  });
}

beforeEach(clearIdentityData);
afterEach(dropFaultTriggers);

describe('idempotent client provisioning saga', () => {
  test('denies client provisioning to non-root principals even when their role has credentials permission', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const service = createOrganizationService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
    });

    await expect(service.provisionClient(admin, {
      provisioningId: 'provision-forbidden', merchantId: 'merchant-a', name: 'Merchant A',
      correlationId: 'corr-provision-forbidden',
    })).rejects.toThrow(/root|forbidden/i);
  });

  test('provisions Core, creates one mapped organization, activates Core, then enables invites', async () => {
    await seedRoot();
    const core = new FakeCoreClient();
    const service = createOrganizationService({ database: testEnv.AUTH_DB, core });

    const result = await service.provisionClient(rootPrincipal(), {
      provisioningId: 'provision-1',
      merchantId: 'merchant-a',
      name: 'Merchant A',
      correlationId: 'corr-provision-1',
    });

    expect(result).toMatchObject({
      provisioningId: 'provision-1',
      merchantId: 'merchant-a',
      organizationId: expect.any(String),
      status: 'active',
      failedStep: null,
      retryable: false,
    });
    expect(core.merchants.get('merchant-a')?.status).toBe('active');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT merchant_id AS merchantId, status FROM organizations
    `).all()).resolves.toMatchObject({ results: [{ merchantId: 'merchant-a', status: 'active' }] });
  });

  test('concurrent and repeated requests converge without duplicate merchant or organization', async () => {
    await seedRoot();
    const core = new FakeCoreClient();
    const service = createOrganizationService({ database: testEnv.AUTH_DB, core });
    const request = {
      provisioningId: 'provision-concurrent',
      merchantId: 'merchant-a',
      name: 'Merchant A',
      correlationId: 'corr-concurrent',
    };

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => service.provisionClient(rootPrincipal(), request)),
    );
    const replay = await service.provisionClient(rootPrincipal(), request);

    expect(attempts.every(attempt => attempt.status === 'active')).toBe(true);
    expect(new Set(attempts.map(attempt => attempt.organizationId)).size).toBe(1);
    expect(replay.organizationId).toBe(attempts[0]?.organizationId);
    expect(core.merchants.size).toBe(1);
    await expect(testEnv.AUTH_DB.prepare(
      'SELECT COUNT(*) AS count FROM organizations',
    ).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(
      'SELECT COUNT(*) AS count FROM client_provisionings',
    ).first('count')).resolves.toBe(1);
  });

  test('rejects conflicting stable provisioning or merchant identities', async () => {
    await seedRoot();
    const service = createOrganizationService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
    });
    await service.provisionClient(rootPrincipal(), {
      provisioningId: 'provision-1', merchantId: 'merchant-a', name: 'Merchant A',
      correlationId: 'corr-1',
    });

    await expect(service.provisionClient(rootPrincipal('merchant-b'), {
      provisioningId: 'provision-1', merchantId: 'merchant-b', name: 'Merchant B',
      correlationId: 'corr-2',
    })).rejects.toThrow(/conflict/i);
    await expect(service.provisionClient(rootPrincipal(), {
      provisioningId: 'provision-2', merchantId: 'merchant-a', name: 'Merchant A',
      correlationId: 'corr-3',
    })).rejects.toThrow(/conflict/i);
    await expect(service.provisionClient(rootPrincipal(), {
      provisioningId: 'provision-1', merchantId: 'merchant-a', name: 'Renamed',
      correlationId: 'corr-4',
    })).rejects.toThrow(/conflict/i);
  });

  test.each([
    ['provision', true, false],
    ['activation', false, true],
  ] as const)(
    'rejects a structurally valid but identity-mismatched Core %s response as permanent',
    async (_boundary, mismatchProvision, mismatchActivation) => {
      await seedRoot();
      const core = new FakeCoreClient();
      core.mismatchedProvisionResult = mismatchProvision;
      core.mismatchedActivationResult = mismatchActivation;
      const service = createOrganizationService({ database: testEnv.AUTH_DB, core });
      const request = {
        provisioningId: `provision-mismatch-${_boundary}`,
        merchantId: `merchant-mismatch-${_boundary}`,
        name: 'Merchant mismatch',
        correlationId: `corr-mismatch-${_boundary}`,
      };

      const failed = await service.provisionClient(
        rootPrincipal(request.merchantId),
        request,
      );
      const replay = await service.provisionClient(
        rootPrincipal(request.merchantId),
        request,
      );

      expect(failed).toMatchObject({
        status: 'failed',
        failedStep: mismatchProvision ? 'core_provision' : 'core_activation',
        retryable: false,
      });
      expect(replay).toEqual(failed);
      expect(core.provisionCalls).toBe(1);
      expect(core.activationCalls).toBe(mismatchProvision ? 0 : 1);
    },
  );

  test('does not blindly retry a permanent Core conflict', async () => {
    await seedRoot();
    const core = new FakeCoreClient();
    core.permanentProvisionFailure = true;
    const service = createOrganizationService({ database: testEnv.AUTH_DB, core });
    const request = {
      provisioningId: 'provision-permanent',
      merchantId: 'merchant-permanent',
      name: 'Merchant permanent',
      correlationId: 'corr-permanent',
    };

    const failed = await service.provisionClient(rootPrincipal(request.merchantId), request);
    const replay = await service.provisionClient(rootPrincipal(request.merchantId), request);

    expect(failed).toMatchObject({ status: 'failed', retryable: false });
    expect(replay).toEqual(failed);
    expect(core.provisionCalls).toBe(1);
  });

  test.each([
    ['core provision', 'core_provision'],
    ['identity organization', 'identity_organization'],
    ['core activation', 'core_activation'],
    ['identity activation', 'identity_activation'],
  ] as const)('records and idempotently retries failure at %s', async (failure, failedStep) => {
    await seedRoot();
    const core = new FakeCoreClient();
    if (failure === 'core provision') core.failProvision = 1;
    if (failure === 'core activation') core.failActivation = 1;
    if (failure === 'identity organization') {
      await testEnv.AUTH_DB.prepare(`
        CREATE TRIGGER test_fail_organization_create
        BEFORE INSERT ON organizations
        WHEN (SELECT attempt_count FROM client_provisionings
          WHERE provisioning_id = NEW.provisioning_id) = 1
        BEGIN SELECT RAISE(FAIL, 'identity organization unavailable'); END
      `).run();
    }
    if (failure === 'identity activation') {
      await testEnv.AUTH_DB.prepare(`
        CREATE TRIGGER test_fail_organization_activate
        BEFORE UPDATE OF status ON organizations
        WHEN NEW.status = 'active' AND (SELECT attempt_count FROM client_provisionings
          WHERE provisioning_id = NEW.provisioning_id) = 1
        BEGIN SELECT RAISE(FAIL, 'identity activation unavailable'); END
      `).run();
    }
    const service = createOrganizationService({ database: testEnv.AUTH_DB, core });
    const request = {
      provisioningId: 'provision-retry', merchantId: 'merchant-a', name: 'Merchant A',
      correlationId: `corr-${failedStep}`,
    };

    const failed = await service.provisionClient(rootPrincipal(), request);
    const visible = await service.getProvisioning('provision-retry');
    const retried = await service.provisionClient(rootPrincipal(), request);

    expect(failed).toMatchObject({ status: 'failed', failedStep, retryable: true });
    expect(visible).toEqual(failed);
    expect(retried).toMatchObject({ status: 'active', failedStep: null, retryable: false });
    expect(core.merchants.get('merchant-a')?.status).toBe('active');
    await expect(testEnv.AUTH_DB.prepare(
      'SELECT COUNT(*) AS count FROM organizations',
    ).first('count')).resolves.toBe(1);
  });

  test('writes a merchant-scoped root audit atomically with a provisioning failure', async () => {
    await seedRoot();
    const core = new FakeCoreClient();
    core.failProvision = 1;
    const service = createOrganizationService({ database: testEnv.AUTH_DB, core });
    const request = {
      provisioningId: 'provision-failure-audit', merchantId: 'merchant-failure-audit',
      name: 'Failure audit merchant', correlationId: 'corr-provision-failure-audit',
    };

    await expect(service.provisionClient(rootPrincipal(request.merchantId), request))
      .resolves.toMatchObject({ status: 'failed', retryable: true });
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT actor_kind AS actorKind, actor_id AS actorId, merchant_id AS merchantId,
        outcome FROM identity_audit
      WHERE correlation_id = 'corr-provision-failure-audit'
        AND action = 'organization.provisioning_failed'
    `).first()).resolves.toEqual({
      actorKind: 'root', actorId: 'root-1', merchantId: 'merchant-failure-audit',
      outcome: 'failed',
    });

    await clearIdentityData();
    await seedRoot();
    const failingAuditCore = new FakeCoreClient();
    failingAuditCore.failProvision = 1;
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_security_audit
      BEFORE INSERT ON identity_audit
      WHEN NEW.action = 'organization.provisioning_failed'
      BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END
    `).run();
    const failingAuditService = createOrganizationService({
      database: testEnv.AUTH_DB, core: failingAuditCore,
    });

    await expect(failingAuditService.provisionClient(
      rootPrincipal(request.merchantId),
      { ...request, correlationId: 'corr-provision-failure-audit-rollback' },
    )).rejects.toThrow(/audit|unavailable|failed/i);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT status, failed_step AS failedStep FROM client_provisionings
      WHERE provisioning_id = 'provision-failure-audit'
    `).first()).resolves.toEqual({ status: 'provisioning', failedStep: null });
  });
});

describe('tenant-safe invitation lifecycle', () => {
  test('keeps invites blocked when Core is active but Identity activation failed', async () => {
    await seedRoot();
    const core = new FakeCoreClient();
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_organization_activate
      BEFORE UPDATE OF status ON organizations
      WHEN NEW.status = 'active' AND (SELECT attempt_count FROM client_provisionings
        WHERE provisioning_id = NEW.provisioning_id) = 1
      BEGIN SELECT RAISE(FAIL, 'identity activation unavailable'); END
    `).run();
    const organizations = createOrganizationService({ database: testEnv.AUTH_DB, core });
    const provisioningRequest = {
      provisioningId: 'provision-invite-gate', merchantId: 'merchant-a', name: 'Merchant A',
      correlationId: 'corr-invite-gate',
    };
    const failed = await organizations.provisionClient(rootPrincipal(), provisioningRequest);
    expect(failed).toMatchObject({ status: 'failed', failedStep: 'identity_activation' });
    expect(core.merchants.get('merchant-a')?.status).toBe('active');
    const invitations = createInvitationService({
      database: testEnv.AUTH_DB,
      email: new CapturingMailer(),
      publicOrigin,
    });
    const invitation = {
      organizationId: failed.organizationId,
      email: 'admin@example.test',
      role: 'admin' as const,
      expiresInSeconds: 3_600,
      correlationId: 'corr-invite-before-identity-active',
    };

    await expect(invitations.createInvitation(rootPrincipal(), invitation))
      .rejects.toThrow(/active/i);
    const active = await organizations.provisionClient(rootPrincipal(), provisioningRequest);
    expect(active.status).toBe('active');
    await expect(invitations.createInvitation(rootPrincipal(), invitation))
      .resolves.toMatchObject({ status: 'sent' });
  });

  test('root can invite any fixed role in the explicitly selected active merchant', async () => {
    await seedRoot();
    await seedOrganization({ status: 'provisioning' });
    const mailer = new CapturingMailer();
    const service = createInvitationService({
      database: testEnv.AUTH_DB,
      email: mailer,
      publicOrigin,
    });
    const request = {
      organizationId: 'org-a', email: 'admin@example.test', role: 'admin' as const,
      expiresInSeconds: 3_600, correlationId: 'corr-invite-root',
    };

    await expect(service.createInvitation(rootPrincipal(), request))
      .rejects.toThrow(/active/i);
    await testEnv.AUTH_DB.prepare(
      "UPDATE organizations SET status = 'active' WHERE id = 'org-a'",
    ).run();
    const operator = await service.createInvitation(rootPrincipal(), {
      ...request,
      email: 'operator@example.test',
      role: 'operator',
    });
    const created = await service.createInvitation(rootPrincipal(), request);
    const secondAdmin = await service.createInvitation(rootPrincipal(), {
      ...request,
      email: 'second-admin@example.test',
    });

    expect(created).toMatchObject({
      organizationId: 'org-a', role: 'admin', status: 'sent', expiresAt: expect.any(String),
    });
    expect(created).not.toHaveProperty('token');
    expect(created).not.toHaveProperty('link');
    expect(operator.role).toBe('operator');
    expect(secondAdmin.role).toBe('admin');
    expect(mailer.messages).toHaveLength(3);
  });

  test('Admin can invite fixed roles only within their active organization', async () => {
    await seedOrganization();
    await seedOrganization({ id: 'org-b', merchantId: 'merchant-b' });
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin,
    });

    const invited = await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'operator@example.test', role: 'operator',
      expiresInSeconds: 3_600, correlationId: 'corr-admin-invite',
    });
    expect(invited).toMatchObject({ organizationId: 'org-a', role: 'operator', status: 'sent' });
    await expect(service.createInvitation(admin, {
      organizationId: 'org-b', email: 'viewer@example.test', role: 'viewer',
      expiresInSeconds: 3_600, correlationId: 'corr-cross-org',
    })).rejects.toThrow(/forbidden/i);

    const operator = memberPrincipal({
      userId: 'operator-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-operator', role: 'operator',
    });
    await expect(service.createInvitation(operator, {
      organizationId: 'org-a', email: 'viewer@example.test', role: 'viewer',
      expiresInSeconds: 3_600, correlationId: 'corr-operator-invite',
    })).rejects.toThrow(/forbidden/i);
  });

  test('accepts an email-bound invite once and rejects wrong-email, expired, and replayed tokens', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    let now = Date.now();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin, now: () => now,
    });

    await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'new@example.test', role: 'viewer',
      expiresInSeconds: 60, correlationId: 'corr-invite-accept',
    });
    const token = tokenFrom(mailer.messages[0] as { text: string });
    await expect(service.acceptInvitation({
      token, email: 'wrong@example.test', correlationId: 'corr-wrong-email',
    })).rejects.toThrow(/invalid/i);

    const accepted = await service.acceptInvitation({
      token, email: ' NEW@example.test ', correlationId: 'corr-accept',
    });
    expect(accepted).toMatchObject({
      organizationId: 'org-a', role: 'viewer', status: 'active', userId: expect.any(String),
    });
    await expect(service.acceptInvitation({
      token, email: 'new@example.test', correlationId: 'corr-replay',
    })).rejects.toThrow(/invalid/i);

    await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'late@example.test', role: 'operator',
      expiresInSeconds: 1, correlationId: 'corr-expiring',
    });
    const expiredToken = tokenFrom(mailer.messages[1] as { text: string });
    now += 1_001;
    await expect(service.acceptInvitation({
      token: expiredToken, email: 'late@example.test', correlationId: 'corr-expired',
    })).rejects.toThrow(/invalid/i);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM memberships WHERE organization_id = 'org-a'
    `).first('count')).resolves.toBe(2);
  });

  test('serializes concurrent acceptance with one winner and no duplicate user or membership', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin,
    });
    await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'concurrent@example.test', role: 'operator',
      expiresInSeconds: 3_600, correlationId: 'corr-concurrent-invite',
    });
    const token = tokenFrom(mailer.messages[0] as { text: string });

    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      service.acceptInvitation({
        token,
        email: 'concurrent@example.test',
        correlationId: `corr-concurrent-accept-${index}`,
      }),
    ));

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(7);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM user WHERE lower(email) = 'concurrent@example.test'
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM memberships
      WHERE organization_id = 'org-a' AND user_id = (
        SELECT id FROM user WHERE lower(email) = 'concurrent@example.test'
      )
    `).first('count')).resolves.toBe(1);
  });

  test('rejects an invite for an email already bound to another organization without tenant leakage', async () => {
    await seedOrganization();
    await seedOrganization({ id: 'org-b', merchantId: 'merchant-b' });
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    await seedMember({
      id: 'membership-existing', userId: 'existing-1', email: 'existing@example.test',
      role: 'viewer', organizationId: 'org-b',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin,
    });
    const conflictingCreate = service.createInvitation(admin, {
      organizationId: 'org-a', email: 'existing@example.test', role: 'operator',
      expiresInSeconds: 3_600, correlationId: 'corr-existing-email',
    });
    await expect(conflictingCreate).rejects.toThrow(/unavailable|member|invalid/i);
    expect(mailer.messages).toHaveLength(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM memberships
      WHERE organization_id = 'org-a' AND user_id = 'existing-1'
    `).first('count')).resolves.toBe(0);
  });

  test('handles duplicate pending and active invitations deterministically', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin,
    });
    const input = {
      organizationId: 'org-a', email: 'duplicate@example.test', role: 'viewer' as const,
      expiresInSeconds: 3_600, correlationId: 'corr-duplicate',
    };

    const first = await service.createInvitation(admin, input);
    const duplicate = await service.createInvitation(admin, {
      ...input, email: ' Duplicate@Example.Test ', correlationId: 'corr-duplicate-retry',
    });
    expect(duplicate).toEqual(first);
    expect(mailer.messages).toHaveLength(1);
    const token = tokenFrom(mailer.messages[0] as { text: string });
    await service.acceptInvitation({
      token, email: 'duplicate@example.test', correlationId: 'corr-duplicate-accept',
    });
    await expect(service.createInvitation(admin, {
      ...input, correlationId: 'corr-duplicate-active',
    })).rejects.toThrow(/already.*member|active/i);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM invitations
      WHERE organization_id = 'org-a' AND lower(email) = 'duplicate@example.test'
    `).first('count')).resolves.toBe(1);
  });

  test('replaces an expired pending invitation even when no acceptance was attempted', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    let now = Date.now();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin, now: () => now,
    });
    const input = {
      organizationId: 'org-a', email: 'expired@example.test', role: 'viewer' as const,
      expiresInSeconds: 1, correlationId: 'corr-expired-first',
    };

    const first = await service.createInvitation(admin, input);
    now += 1_001;
    const replacement = await service.createInvitation(admin, {
      ...input, correlationId: 'corr-expired-replacement',
    });

    expect(replacement.id).not.toBe(first.id);
    expect(replacement.status).toBe('sent');
    expect(mailer.messages).toHaveLength(2);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT status FROM invitations WHERE id = ?1
    `).bind(first.id).first('status')).resolves.toBe('expired');
  });

  test('keeps failed delivery pending and retryable with a newly rotated token', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    mailer.failures = 1;
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin,
    });

    const failed = await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'retry@example.test', role: 'operator',
      expiresInSeconds: 3_600, correlationId: 'corr-delivery-failed',
    });
    await expect(service.acceptInvitation({
      token: tokenFrom(mailer.attempts[0] as { text: string }),
      email: 'retry@example.test',
      correlationId: 'corr-delivery-not-sent',
    })).rejects.toThrow(/invalid/i);
    const retried = await service.retryInvitation(admin, failed.id, 'corr-delivery-retry');

    expect(failed.status).toBe('delivery_failed');
    expect(retried.status).toBe('sent');
    expect(mailer.messages).toHaveLength(1);
    const persisted = JSON.stringify((await testEnv.AUTH_DB.prepare(`
      SELECT * FROM invitations WHERE id = ?1
    `).bind(failed.id).first()) ?? {});
    expect(persisted).not.toContain(tokenFrom(mailer.messages[0] as { text: string }));
  });

  test('serializes concurrent invitation retries so exactly one rotated token is delivered', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    const service = createInvitationService({
      database: testEnv.AUTH_DB, email: mailer, publicOrigin,
    });
    const invitation = await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'retry-race@example.test', role: 'viewer',
      expiresInSeconds: 3_600, correlationId: 'corr-retry-race-create',
    });
    mailer.messages.length = 0;

    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      service.retryInvitation(admin, invitation.id, `corr-retry-race-${index}`),
    ));

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(7);
    expect(mailer.messages).toHaveLength(1);
  });

  test('recovers a pending invitation after interruption immediately after creation', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const now = Date.now();
    await testEnv.AUTH_DB.prepare(`
      INSERT INTO invitations (
        id, organization_id, email, role, token_hash, status, invited_by,
        expires_at, created_at, updated_at
      ) VALUES ('invite-interrupted', 'org-a', 'interrupted@example.test', 'viewer',
        ?1, 'pending', 'admin-1', ?2, ?3, ?3)
    `).bind(await sha256('x'.repeat(43)), now + 3_600_000, now).run();
    const mailer = new CapturingMailer();
    const service = createInvitationService({ database: testEnv.AUTH_DB, email: mailer, publicOrigin });

    await expect(service.retryInvitation(
      admin, 'invite-interrupted', 'corr-recover-pending',
    )).resolves.toMatchObject({ status: 'sent' });
    expect(mailer.messages).toHaveLength(1);
  });

  test('keeps delivery retryable when sent-status audit commit fails after email success', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_security_audit
      BEFORE INSERT ON identity_audit
      WHEN NEW.action = 'invitation.delivery'
      BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END
    `).run();
    const mailer = new CapturingMailer();
    const service = createInvitationService({ database: testEnv.AUTH_DB, email: mailer, publicOrigin });

    const interrupted = await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'delivery-interrupted@example.test', role: 'viewer',
      expiresInSeconds: 3_600, correlationId: 'corr-delivery-commit-failure',
    });
    expect(interrupted.status).toBe('pending');
    expect(mailer.messages).toHaveLength(1);
    const firstToken = tokenFrom(mailer.messages[0] as { text: string });
    await expect(service.acceptInvitation({
      token: firstToken, email: 'delivery-interrupted@example.test',
      correlationId: 'corr-delivery-interrupted-accept',
    })).rejects.toThrow(/invalid/i);

    await testEnv.AUTH_DB.prepare('DROP TRIGGER test_fail_security_audit').run();
    const recovered = await service.retryInvitation(
      admin, interrupted.id, 'corr-delivery-commit-retry',
    );
    expect(recovered.status).toBe('sent');
    expect(mailer.messages).toHaveLength(2);
  });
});

describe('membership administration invariants', () => {
  test('denies cross-organization removal and role changes without revealing the target', async () => {
    await seedOrganization();
    await seedOrganization({ id: 'org-b', merchantId: 'merchant-b' });
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    await seedMember({
      id: 'membership-other', userId: 'other-1', email: 'other@example.test',
      role: 'viewer', organizationId: 'org-b',
    });
    const service = createOrganizationService({ database: testEnv.AUTH_DB });
    const actor = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });

    const remove = service.removeMember(actor, {
      membershipId: 'membership-other', correlationId: 'corr-cross-remove',
    });
    const change = service.changeMemberRole(actor, {
      membershipId: 'membership-other', role: 'operator', correlationId: 'corr-cross-role',
    });
    const [removeResult, changeResult] = await Promise.allSettled([remove, change]);

    expect(removeResult.status).toBe('rejected');
    expect(changeResult.status).toBe('rejected');
    if (removeResult.status === 'rejected' && changeResult.status === 'rejected') {
      expect((removeResult.reason as Error).message).not.toMatch(/org-b|other-1|viewer/i);
      expect((changeResult.reason as Error).message).not.toMatch(/org-b|other-1|viewer/i);
    }
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT role, status FROM memberships WHERE id = 'membership-other'
    `).first()).resolves.toEqual({ role: 'viewer', status: 'active' });
  });

  test('removal and demotion revoke every target session immediately', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    await seedMember({
      id: 'membership-operator', userId: 'operator-1', email: 'operator@example.test',
      role: 'operator', sessions: 2,
    });
    await seedMember({
      id: 'membership-admin-2', userId: 'admin-2', email: 'admin2@example.test',
      role: 'admin', sessions: 2,
    });
    const service = createOrganizationService({ database: testEnv.AUTH_DB });
    const actor = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });

    await service.removeMember(actor, {
      membershipId: 'membership-operator', correlationId: 'corr-remove',
    });
    await service.changeMemberRole(actor, {
      membershipId: 'membership-admin-2', role: 'viewer', correlationId: 'corr-demote',
    });

    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM session WHERE userId IN ('operator-1', 'admin-2')
    `).first('count')).resolves.toBe(0);
    await expect(service.resolvePrincipal('session-operator-1-0')).resolves.toBeNull();
  });

  test('prevents the last Admin from removing or demoting themselves', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const service = createOrganizationService({ database: testEnv.AUTH_DB });
    const actor = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });

    await expect(service.removeMember(actor, {
      membershipId: 'membership-admin', correlationId: 'corr-last-remove',
    })).rejects.toThrow(/last admin/i);
    await expect(service.changeMemberRole(actor, {
      membershipId: 'membership-admin', role: 'operator', correlationId: 'corr-last-demote',
    })).rejects.toThrow(/last admin/i);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT role, status FROM memberships WHERE id = 'membership-admin'
    `).first()).resolves.toEqual({ role: 'admin', status: 'active' });
  });

  test.each(['remove', 'demote'] as const)(
    'lets root %s the last Admin for incident recovery in the selected merchant',
    async operation => {
      await seedRoot();
      await seedOrganization();
      await seedMember({
        id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
      });
      const service = createOrganizationService({ database: testEnv.AUTH_DB });

      if (operation === 'remove') {
        await expect(service.removeMember(rootPrincipal(), {
          membershipId: 'membership-admin', correlationId: 'corr-root-remove-last-admin',
        })).resolves.toMatchObject({ status: 'removed' });
      } else {
        await expect(service.changeMemberRole(rootPrincipal(), {
          membershipId: 'membership-admin', role: 'operator',
          correlationId: 'corr-root-demote-last-admin',
        })).resolves.toMatchObject({ role: 'operator' });
      }
      await expect(testEnv.AUTH_DB.prepare(`
        SELECT COUNT(*) AS count FROM session WHERE userId = 'admin-1'
      `).first('count')).resolves.toBe(0);
    },
  );

  test('serializes concurrent self-demotions so one active Admin always remains', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin-1', userId: 'admin-1', email: 'admin1@example.test', role: 'admin',
    });
    await seedMember({
      id: 'membership-admin-2', userId: 'admin-2', email: 'admin2@example.test', role: 'admin',
    });
    const service = createOrganizationService({ database: testEnv.AUTH_DB });
    const first = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin-1', role: 'admin',
    });
    const second = memberPrincipal({
      userId: 'admin-2', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin-2', role: 'admin',
    });

    const results = await Promise.allSettled([
      service.changeMemberRole(first, {
        membershipId: 'membership-admin-1', role: 'viewer', correlationId: 'corr-demote-1',
      }),
      service.changeMemberRole(second, {
        membershipId: 'membership-admin-2', role: 'viewer', correlationId: 'corr-demote-2',
      }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM memberships
      WHERE organization_id = 'org-a' AND role = 'admin' AND status = 'active'
    `).first('count')).resolves.toBe(1);
  });
});

describe('operations-only root bootstrap', () => {
  test('creates one pending root without a password and rejects a second live root', async () => {
    const bootstrapped = await bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: ' Root@Example.Test ',
      correlationId: 'corr-bootstrap-root',
    });

    expect(bootstrapped).toMatchObject({
      userId: expect.any(String),
      status: 'pending',
      activationGrant: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: expect.any(Number),
    });
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT user.email, auth_profile.status, auth_profile.subject_kind
      FROM user INNER JOIN auth_profile ON auth_profile.user_id = user.id
    `).first()).resolves.toEqual({
      email: 'root@example.test', status: 'pending', subject_kind: 'root',
    });
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM account').first('count'))
      .resolves.toBe(0);
    const persisted = JSON.stringify((await testEnv.AUTH_DB.prepare(`
      SELECT * FROM recovery_flow
    `).first()) ?? {});
    expect(persisted).not.toContain(bootstrapped.activationGrant);

    await expect(bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: 'second@example.test',
      correlationId: 'corr-bootstrap-second',
    })).rejects.toThrow(/root already exists/i);
  });

  test('resumes a lost bootstrap response for the same pending email', async () => {
    const first = await bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: 'root@example.test',
      correlationId: 'corr-bootstrap-first',
    });
    const replay = await bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: ' ROOT@example.test ',
      correlationId: 'corr-bootstrap-replay',
    });

    expect(replay).toEqual(first);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM auth_profile
      WHERE subject_kind = 'root' AND status IN ('pending', 'active')
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow
      WHERE completed_at IS NULL AND cancelled_at IS NULL
    `).first('count')).resolves.toBe(1);
  });

  test('serializes concurrent first-root bootstrap with one flow and one success audit', async () => {
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: 'root@example.test',
      correlationId: `corr-bootstrap-concurrent-${index}`,
    })));

    expect(new Set(attempts.map(result => result.userId)).size).toBe(1);
    expect(new Set(attempts.map(result => result.activationGrant)).size).toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM auth_profile
      WHERE subject_kind = 'root' AND status IN ('pending', 'active')
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow
      WHERE purpose = 'bootstrap' AND completed_at IS NULL AND cancelled_at IS NULL
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit WHERE action = 'root.bootstrap'
    `).first('count')).resolves.toBe(1);
  });

  test('rolls back first-root creation when its mandatory success audit fails', async () => {
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_security_audit
      BEFORE INSERT ON identity_audit
      WHEN NEW.action = 'root.bootstrap'
      BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END
    `).run();

    await expect(bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: 'root@example.test',
      correlationId: 'corr-bootstrap-audit-failure',
    })).rejects.toThrow();
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM auth_profile WHERE subject_kind = 'root'
    `).first('count')).resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow WHERE purpose = 'bootstrap'
    `).first('count')).resolves.toBe(0);
  });

  test.each(['expired', 'cancelled'] as const)(
    'reissues a pending-root activation after the prior flow is %s',
    async reason => {
      const first = await bootstrapRoot({
        database: testEnv.AUTH_DB,
        authSecret: testEnv.AUTH_SECRET,
        email: 'root@example.test',
        correlationId: `corr-bootstrap-${reason}-first`,
      });
      if (reason === 'expired') {
        await testEnv.AUTH_DB.prepare('UPDATE recovery_flow SET expires_at = 0').run();
      } else {
        await testEnv.AUTH_DB.prepare(`
          UPDATE recovery_flow SET cancelled_at = ?1, cancel_reason = 'operator-reissue'
        `).bind(Date.now()).run();
      }

      const reissued = await bootstrapRoot({
        database: testEnv.AUTH_DB,
        authSecret: testEnv.AUTH_SECRET,
        email: 'root@example.test',
        correlationId: `corr-bootstrap-${reason}-reissue`,
      });

      expect(reissued.userId).toBe(first.userId);
      expect(reissued.activationGrant).not.toBe(first.activationGrant);
      expect(reissued.expiresAt).toBeGreaterThan(Date.now());
      await expect(testEnv.AUTH_DB.prepare(`
        SELECT COUNT(*) AS count FROM recovery_flow
        WHERE completed_at IS NULL AND cancelled_at IS NULL
      `).first('count')).resolves.toBe(1);
    },
  );

  test('activates pending root only through Task 5 passkey registration and code handoff', async () => {
    const bootstrapped = await bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email: 'root@example.test',
      correlationId: 'corr-bootstrap-activation',
    });
    const exchange = await SELF.fetch(`${publicOrigin}/auth/root/recovery/exchange`, {
      method: 'POST',
      headers: { origin: publicOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: bootstrapped.activationGrant }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('Expected constrained activation session');
    const credential = await createTestCredential();

    const registered = await registerReplacement(cookie, credential);
    expect(registered.status).toBe(200);
    const rotated = await SELF.fetch(`${publicOrigin}/auth/root/recovery/rotate-codes`, {
      method: 'POST',
      headers: { cookie, origin: publicOrigin, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(rotated.status).toBe(200);
    const body = await rotated.json<{ codes: string[] }>();
    expect(body.codes).toHaveLength(8);
    expect(body.codes.every(code => /^[A-Za-z0-9_-]{43}$/u.test(code))).toBe(true);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT status FROM auth_profile WHERE user_id = ?1
    `).bind(bootstrapped.userId).first('status')).resolves.toBe('active');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM passkey WHERE userId = ?1
    `).bind(bootstrapped.userId).first('count')).resolves.toBe(1);
  });

  test('does not expose bootstrap through a public Identity route', async () => {
    const response = await SELF.fetch(`${publicOrigin}/auth/root/bootstrap`, {
      method: 'POST',
      headers: { origin: publicOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'root@example.test' }),
    });

    expect(response.status).toBe(404);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM user').first('count'))
      .resolves.toBe(0);
  });

  test('provides a validated operations command handler with no password input or secret logging', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const invoke = vi.fn(async (email: string, correlationId: string) => bootstrapRoot({
      database: testEnv.AUTH_DB,
      authSecret: testEnv.AUTH_SECRET,
      email,
      correlationId,
    }));

    const exitCode = await runBootstrapRootCommand(
      ['--environment', 'local', '--email', 'root@example.test'],
      { bootstrap: invoke, writeOutput: value => output.push(value), writeError: value => errors.push(value) },
    );
    expect(exitCode).toBe(0);
    expect(invoke).toHaveBeenCalledWith('root@example.test', expect.any(String));
    expect(errors).toEqual([]);
    const result = JSON.parse(output.join('')) as Record<string, unknown>;
    expect(result).toMatchObject({
      userId: expect.any(String), status: 'pending',
      activationGrant: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: expect.any(Number),
    });
    expect(result).not.toHaveProperty('password');
    expect(output.join('')).not.toContain(testEnv.AUTH_SECRET);

    await expect(runBootstrapRootCommand(
      ['--email', 'root@example.test', '--password', 'forbidden'],
      { bootstrap: invoke, writeOutput: vi.fn(), writeError: vi.fn() },
    )).resolves.toBe(2);
    await expect(runBootstrapRootCommand(
      [],
      { bootstrap: invoke, writeOutput: vi.fn(), writeError: vi.fn() },
    )).resolves.toBe(2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('has a runnable local/staging bootstrap command with explicit safe Wrangler arguments', () => {
    const task6Cli = bootstrapCli as unknown as {
      buildBootstrapRootWranglerCommand(input: {
        environment: 'local' | 'staging';
        sqlFile: string;
      }): { command: string; arguments: string[] };
    };
    expect(JSON.parse(identityPackageSource)).toMatchObject({
      scripts: { 'bootstrap:root': expect.stringContaining('bootstrap-root-runner') },
    });
    expect(task6Cli.buildBootstrapRootWranglerCommand({
      environment: 'local', sqlFile: '/tmp/bootstrap-safe.sql',
    })).toEqual({
      command: 'pnpm',
      arguments: [
        'exec', 'wrangler', 'd1', 'execute', 'incentives-auth-local',
        '--local', '--file', '/tmp/bootstrap-safe.sql', '--json',
      ],
    });
    expect(task6Cli.buildBootstrapRootWranglerCommand({
      environment: 'staging', sqlFile: '/tmp/bootstrap-safe.sql',
    })).toEqual({
      command: 'pnpm',
      arguments: [
        'exec', 'wrangler', 'd1', 'execute', 'incentives-auth-staging',
        '--env', 'staging', '--remote', '--file', '/tmp/bootstrap-safe.sql', '--json',
      ],
    });
  });

  test('writes correlation-safe onboarding audits without invitation, grant, or code secrets', async () => {
    const spies = ['debug', 'info', 'log', 'warn', 'error'].map(method =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined));
    try {
      const bootstrapped = await bootstrapRoot({
        database: testEnv.AUTH_DB,
        authSecret: testEnv.AUTH_SECRET,
        email: 'root@example.test',
        correlationId: 'corr-safe-bootstrap',
      });
      const audit = JSON.stringify((await testEnv.AUTH_DB.prepare(`
        SELECT * FROM identity_audit WHERE correlation_id = 'corr-safe-bootstrap'
      `).all()).results);
      const logs = spies.flatMap(spy => spy.mock.calls).flat().join(' ');

      expect(audit).not.toContain(bootstrapped.activationGrant);
      expect(audit).not.toContain('root@example.test');
      expect(logs).not.toContain(bootstrapped.activationGrant);
      expect(audit).toContain('root.bootstrap');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test('writes canonical merchant-scoped member and root audit entries', async () => {
    await seedRoot();
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const service = createInvitationService({
      database: testEnv.AUTH_DB,
      email: new CapturingMailer(),
      publicOrigin,
    });
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });

    await service.createInvitation(admin, {
      organizationId: 'org-a', email: 'viewer@example.test', role: 'viewer',
      expiresInSeconds: 3_600, correlationId: 'corr-canonical-member-audit',
    });
    await service.createInvitation(rootPrincipal(), {
      organizationId: 'org-a', email: 'operator@example.test', role: 'operator',
      expiresInSeconds: 3_600, correlationId: 'corr-canonical-root-audit',
    });

    const rows = await testEnv.AUTH_DB.prepare(`
      SELECT id, occurred_at AS occurredAt, actor_kind AS actorKind,
        actor_id AS actorId, merchant_id AS merchantId, action,
        target_type AS targetType, target_id AS targetId, outcome,
        correlation_id AS correlationId, metadata_json AS metadata
      FROM identity_audit
      WHERE correlation_id IN ('corr-canonical-member-audit', 'corr-canonical-root-audit')
        AND action = 'invitation.created'
      ORDER BY correlation_id
    `).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) {
      expect(AuditEntrySchema.parse({
        ...row,
        occurredAt: new Date(row.occurredAt as number).toISOString(),
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      })).toMatchObject({ merchantId: 'merchant-a' });
    }
    expect(rows.results.map(row => row.actorKind).sort()).toEqual(['member', 'root']);
  });

  test('forward migration rewrites legacy employee audit actors to canonical member actors', async () => {
    const rewrite = organizationsMigrationSource.match(
      /UPDATE\s+identity_audit\s+SET\s+actor_kind\s*=\s*'member'\s+WHERE\s+actor_kind\s*=\s*'employee'\s*;/iu,
    )?.[0];
    expect(rewrite).toBeTypeOf('string');
    await testEnv.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES ('legacy-audit', ?1, 'employee', 'legacy-user', 'session.created',
        'session', 'legacy-session', 'succeeded', 'corr-legacy-audit', NULL)
    `).bind(Date.now()).run();
    await testEnv.AUTH_DB.exec(rewrite as string);

    await expect(testEnv.AUTH_DB.prepare(`
      SELECT actor_kind AS actorKind FROM identity_audit WHERE id = 'legacy-audit'
    `).first('actorKind')).resolves.toBe('member');
  });

  test('rolls back a security mutation when its mandatory audit write fails', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_security_audit
      BEFORE INSERT ON identity_audit
      WHEN NEW.action = 'invitation.created'
      BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END
    `).run();
    const admin = memberPrincipal({
      userId: 'admin-1', organizationId: 'org-a', merchantId: 'merchant-a',
      membershipId: 'membership-admin', role: 'admin',
    });
    const mailer = new CapturingMailer();
    const service = createInvitationService({ database: testEnv.AUTH_DB, email: mailer, publicOrigin });

    await expect(service.createInvitation(admin, {
      organizationId: 'org-a', email: 'no-audit@example.test', role: 'viewer',
      expiresInSeconds: 3_600, correlationId: 'corr-audit-rollback',
    })).rejects.toThrow(/unavailable|audit|failed/i);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM invitations WHERE email = 'no-audit@example.test'
    `).first('count')).resolves.toBe(0);
    expect(mailer.attempts).toHaveLength(0);
  });
});

describe('private Identity operator service boundary', () => {
  test('exposes the typed Task 7 principal, provisioning, invitation, and member methods privately', () => {
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin,
    });

    expect(Object.keys(service).sort()).toEqual([
      'acceptInvitation',
      'changeMemberRole',
      'createInvitation',
      'getProvisioning',
      'getProvisioningForRoot',
      'listClients',
      'listInvitations',
      'listMembers',
      'provisionClient',
      'removeMember',
      'resolvePrincipal',
      'retryInvitation',
    ]);
    for (const method of Object.values(service)) expect(method).toBeTypeOf('function');
  });

  test('resolves browser cookies live and validates root merchants against active organizations', async () => {
    await seedRoot();
    await seedOrganization();
    await seedOrganization({ id: 'org-pending', merchantId: 'merchant-pending', status: 'provisioning' });
    const service = new IdentityOperatorService(
      createExecutionContext(),
      testEnv as unknown as Env,
    );
    const cookieHeader = await signedSessionCookie('token-root-session');

    const selected = await service.resolveBrowserPrincipal({
      cookieHeader, selectedMerchantId: 'merchant-a', correlationId: 'corr-browser-selected',
    });
    expect(selected).toMatchObject({
      platformRole: 'root', sessionId: 'root-session', merchantId: 'merchant-a',
      organizationId: 'org-a',
    });
    const pending = await service.resolveBrowserPrincipal({
      cookieHeader, selectedMerchantId: 'merchant-pending', correlationId: 'corr-browser-pending',
    });
    expect(ApiErrorSchema.parse(pending).error).toMatchObject({
      code: 'FORBIDDEN', message: 'Operation is not permitted', retryable: false,
    });

    await testEnv.AUTH_DB.prepare("DELETE FROM session WHERE id = 'root-session'").run();
    const revoked = await service.resolveBrowserPrincipal({
      cookieHeader, correlationId: 'corr-browser-revoked',
    });
    expect(ApiErrorSchema.parse(revoked).error.code).toBe('UNAUTHORIZED');
  });

  test('lists active, provisioning, and failed clients through a live root browser session', async () => {
    await seedRoot();
    await seedOrganization();
    await seedOrganization({
      id: 'org-provisioning', merchantId: 'merchant-provisioning', status: 'provisioning',
    });
    const now = Date.now();
    await testEnv.AUTH_DB.prepare(`
      INSERT INTO client_provisionings (
        provisioning_id, merchant_id, organization_id, name, status, current_step,
        failed_step, retryable, attempt_count, created_at, updated_at, correlation_id
      ) VALUES (
        'provision-failed', 'merchant-failed', NULL, 'Failed merchant', 'failed',
        'core_provision', 'core_provision', 1, 1, ?1, ?1, 'corr-failed'
      )
    `).bind(now).run();
    const service = new IdentityOperatorService(
      createExecutionContext(),
      testEnv as unknown as Env,
    ) as IdentityOperatorService & {
      listClients?: (input: unknown) => Promise<unknown>;
    };
    expect(service.listClients).toBeTypeOf('function');
    if (!service.listClients) return;

    const result = await service.listClients({
      cookieHeader: await signedSessionCookie('token-root-session'),
      correlationId: 'corr-root-list-clients',
    });

    expect(result).toMatchObject({
      clients: expect.arrayContaining([
        expect.objectContaining({ merchantId: 'merchant-a', status: 'active' }),
        expect.objectContaining({ merchantId: 'merchant-provisioning', status: 'provisioning' }),
        expect.objectContaining({
          provisioningId: 'provision-failed', merchantId: 'merchant-failed',
          organizationId: null, status: 'failed', failedStep: 'core_provision', retryable: true,
        }),
      ]),
    });
  });

  test('gets a failed provisioning through a live root session without merchant selection', async () => {
    await seedRoot();
    const now = Date.now();
    await testEnv.AUTH_DB.prepare(`
      INSERT INTO client_provisionings (
        provisioning_id, merchant_id, organization_id, name, status, current_step,
        failed_step, retryable, attempt_count, created_at, updated_at, correlation_id
      ) VALUES (
        'provision-failed', 'merchant-failed', NULL, 'Failed merchant', 'failed',
        'identity_organization', 'identity_organization', 1, 1, ?1, ?1, 'corr-failed'
      )
    `).bind(now).run();
    const service = new IdentityOperatorService(
      createExecutionContext(),
      testEnv as unknown as Env,
    ) as IdentityOperatorService & {
      getProvisioningForRoot?: (input: unknown) => Promise<unknown>;
    };
    expect(service.getProvisioningForRoot).toBeTypeOf('function');
    if (!service.getProvisioningForRoot) return;

    await expect(service.getProvisioningForRoot({
      cookieHeader: await signedSessionCookie('token-root-session'),
      provisioningId: 'provision-failed',
      correlationId: 'corr-root-get-provisioning',
    })).resolves.toMatchObject({
      provisioningId: 'provision-failed', merchantId: 'merchant-failed',
      organizationId: null, status: 'failed', failedStep: 'identity_organization', retryable: true,
    });
  });

  test('keeps root client inventory methods unavailable to live member sessions', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const service = new IdentityOperatorService(
      createExecutionContext(),
      testEnv as unknown as Env,
    ) as IdentityOperatorService & {
      listClients?: (input: unknown) => Promise<unknown>;
    };
    expect(service.listClients).toBeTypeOf('function');
    if (!service.listClients) return;

    const result = await service.listClients({
      cookieHeader: await signedSessionCookie('token-admin-1-0'),
      correlationId: 'corr-member-list-clients',
    });

    expect(ApiErrorSchema.parse(result).error).toMatchObject({
      code: 'FORBIDDEN', message: 'Operation is not permitted', retryable: false,
    });
  });

  test('lists only the live selected tenant members and invitations', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    await seedMember({
      id: 'membership-viewer', userId: 'viewer-1', email: 'viewer@example.test', role: 'viewer',
    });
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin,
    });
    await service.createInvitation({
      sessionId: 'session-admin-1-0', selectedMerchantId: 'merchant-a',
      input: {
        organizationId: 'org-a', email: 'invite@example.test', role: 'viewer',
        expiresInSeconds: 3_600, correlationId: 'corr-list-create',
      },
    });

    const members = await service.listMembers({
      sessionId: 'session-admin-1-0', selectedMerchantId: 'merchant-a',
      correlationId: 'corr-list-members',
    });
    const invitations = await service.listInvitations({
      sessionId: 'session-admin-1-0', selectedMerchantId: 'merchant-a',
      correlationId: 'corr-list-invitations',
    });
    expect(members).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ id: 'membership-admin' }),
        expect.objectContaining({ id: 'membership-viewer' }),
      ]),
    });
    expect(invitations).toMatchObject({
      invitations: [expect.objectContaining({ email: 'invite@example.test' })],
    });
  });

  test('does not expose any private operator method through public fetch routes', async () => {
    for (const path of [
      '/internal/principal',
      '/internal/provision-client',
      '/internal/invitations',
      '/internal/members',
      '/auth/root/bootstrap',
    ]) {
      const response = await SELF.fetch(`${publicOrigin}${path}`, {
        method: 'POST',
        headers: { origin: publicOrigin, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status, path).toBe(404);
    }
  });

  test('preserves a nullable pre-organization Core failure through provision and root get RPCs', async () => {
    await seedRoot();
    const core = new FakeCoreClient();
    core.failProvision = 1;
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core,
      email: new CapturingMailer(),
      publicOrigin,
    });
    const failed = await service.provisionClient({
      sessionId: 'root-session',
      selectedMerchantId: 'merchant-core-failure',
      input: {
        provisioningId: 'provision-core-failure',
        merchantId: 'merchant-core-failure',
        name: 'Core failure merchant',
        correlationId: 'corr-core-failure-rpc',
      },
    });

    expect(failed).toEqual({
      provisioningId: 'provision-core-failure',
      merchantId: 'merchant-core-failure',
      organizationId: null,
      name: 'Core failure merchant',
      status: 'failed',
      failedStep: 'core_provision',
      retryable: true,
    });
    await expect(service.getProvisioning({
      sessionId: 'root-session',
      selectedMerchantId: 'merchant-core-failure',
      provisioningId: 'provision-core-failure',
      correlationId: 'corr-core-failure-read',
    })).resolves.toEqual(failed);
  });

  test('resolves live authorization from the session on every RPC and ignores no caller snapshot', async () => {
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin,
    });
    const request = {
      sessionId: 'session-admin-1-0',
      selectedMerchantId: 'merchant-a',
      input: {
        organizationId: 'org-a', email: 'first@example.test', role: 'viewer' as const,
        expiresInSeconds: 3_600, correlationId: 'corr-rpc-live-first',
      },
    };

    await expect(service.createInvitation(request)).resolves.toMatchObject({ status: 'sent' });
    await testEnv.AUTH_DB.prepare(`
      UPDATE memberships SET status = 'removed' WHERE id = 'membership-admin'
    `).run();
    const stale = await service.createInvitation({
      ...request,
      input: { ...request.input, email: 'stale@example.test', correlationId: 'corr-rpc-stale' },
    });

    expect(ApiErrorSchema.parse(stale)).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication is required',
        correlationId: 'corr-rpc-stale',
        retryable: false,
      },
    });
    expect(JSON.stringify(stale)).not.toMatch(/org-a|merchant-a|admin-1|membership-admin/i);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT outcome FROM identity_audit
      WHERE correlation_id = 'corr-rpc-stale' AND action = 'authorization.denied'
    `).first('outcome')).resolves.toBe('denied');
  });

  test('restricts provisioning reads to root and returns tenant-neutral RPC failures', async () => {
    await seedRoot();
    await seedOrganization();
    await seedMember({
      id: 'membership-admin', userId: 'admin-1', email: 'admin@example.test', role: 'admin',
    });
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin,
    });

    await expect(service.getProvisioning({
      sessionId: 'root-session',
      selectedMerchantId: 'merchant-a',
      provisioningId: 'provision-merchant-a',
      correlationId: 'corr-root-get-provisioning',
    })).resolves.toMatchObject({ merchantId: 'merchant-a' });
    const forbidden = await service.getProvisioning({
      sessionId: 'session-admin-1-0',
      selectedMerchantId: 'merchant-a',
      provisioningId: 'provision-merchant-a',
      correlationId: 'corr-member-get-provisioning',
    });
    const nonexistent = await service.getProvisioning({
      sessionId: 'session-admin-1-0',
      selectedMerchantId: 'merchant-secret',
      provisioningId: 'provision-secret',
      correlationId: 'corr-member-get-missing',
    });

    expect(ApiErrorSchema.parse(forbidden).error).toMatchObject({
      code: 'FORBIDDEN', message: 'Operation is not permitted', retryable: false,
    });
    expect(ApiErrorSchema.parse(nonexistent).error).toMatchObject({
      code: 'FORBIDDEN', message: 'Operation is not permitted', retryable: false,
    });
    expect(JSON.stringify([forbidden, nonexistent])).not.toMatch(/merchant-secret|provision-secret|org-a|merchant-a/i);
  });

  test('returns the same generic invitation failure for invalid, wrong-email, and cross-tenant cases', async () => {
    await seedOrganization();
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin,
    });
    const attempts = await Promise.all([
      service.acceptInvitation({
        token: 'x'.repeat(43), email: 'one@example.test', correlationId: 'corr-invalid-one',
      }),
      service.acceptInvitation({
        token: 'y'.repeat(43), email: 'other-tenant@example.test', correlationId: 'corr-invalid-two',
      }),
    ]);

    for (const [index, result] of attempts.entries()) {
      expect(ApiErrorSchema.parse(result).error).toEqual({
        code: 'INVITATION_INVALID',
        message: 'Invitation is invalid',
        correlationId: `corr-invalid-${index === 0 ? 'one' : 'two'}`,
        retryable: false,
      });
      expect(JSON.stringify(result)).not.toMatch(/tenant|organization|membership/i);
    }
  });

  test('normalizes unexpected session, D1, and configuration faults for every private RPC method', async () => {
    const brokenDatabase = {
      prepare() {
        throw new Error('tenant-secret database configuration detail');
      },
    } as unknown as D1Database;
    const service = createIdentityOperatorService({
      database: brokenDatabase,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin,
    });
    const calls: Array<[string, Promise<unknown>]> = [
      ['resolve', service.resolvePrincipal({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        correlationId: 'corr-fault-resolve',
      })],
      ['provision', service.provisionClient({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        input: {
          provisioningId: 'provision-fault', merchantId: 'merchant-fault',
          name: 'Fault merchant', correlationId: 'corr-fault-provision',
        },
      })],
      ['get', service.getProvisioning({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        provisioningId: 'provision-fault', correlationId: 'corr-fault-get',
      })],
      ['createInvite', service.createInvitation({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        input: {
          organizationId: 'org-fault', email: 'invite@example.test', role: 'viewer',
          expiresInSeconds: 3_600, correlationId: 'corr-fault-create-invite',
        },
      })],
      ['listMembers', service.listMembers({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        correlationId: 'corr-fault-list-members',
      })],
      ['listInvitations', service.listInvitations({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        correlationId: 'corr-fault-list-invitations',
      })],
      ['retryInvite', service.retryInvitation({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        invitationId: 'invite-fault', correlationId: 'corr-fault-retry-invite',
      })],
      ['acceptInvite', service.acceptInvitation({
        token: 'x'.repeat(43), email: 'invite@example.test',
        correlationId: 'corr-fault-accept-invite',
      })],
      ['remove', service.removeMember({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        membershipId: 'member-fault', correlationId: 'corr-fault-remove',
      })],
      ['role', service.changeMemberRole({
        sessionId: 'session-fault', selectedMerchantId: 'merchant-fault',
        membershipId: 'member-fault', role: 'viewer', correlationId: 'corr-fault-role',
      })],
    ];

    const results = await Promise.all(calls.map(([, call]) => call));
    for (const result of results) {
      const error = ApiErrorSchema.parse(result).error;
      expect(error).toMatchObject({
        code: 'IDENTITY_UNAVAILABLE',
        message: 'Identity is temporarily unavailable',
        retryable: true,
      });
      expect(error.correlationId).toMatch(/^corr-fault-/u);
      expect(JSON.stringify(result)).not.toMatch(/tenant-secret|database configuration/i);
    }
  });

  test('normalizes an invitation delivery configuration fault as retryable and tenant-neutral', async () => {
    await seedRoot();
    await seedOrganization();
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core: new FakeCoreClient(),
      email: new CapturingMailer(),
      publicOrigin: 'not a valid origin',
    });

    const result = await service.createInvitation({
      sessionId: 'root-session', selectedMerchantId: 'merchant-a',
      input: {
        organizationId: 'org-a', email: 'config-fault@example.test', role: 'viewer',
        expiresInSeconds: 3_600, correlationId: 'corr-fault-delivery-config',
      },
    });

    expect(ApiErrorSchema.parse(result).error).toEqual({
      code: 'IDENTITY_UNAVAILABLE',
      message: 'Identity is temporarily unavailable',
      correlationId: 'corr-fault-delivery-config',
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain('not a valid origin');
  });

  test('keeps Identity free of Product D1 and uses the injected Core RPC instead of public fetch', async () => {
    expect(testEnv.WRANGLER_CONFIG_TEXT).not.toMatch(/PRODUCT_DB|incentives-product|d1.*product/i);
    expect(`${organizationsSource}\n${internalRoutesSource}`).not.toMatch(
      /apps\/api|\.\.\/\.\.\/api|PRODUCT_DB|createRepositories|CoreOperatorService/u,
    );
    expect(organizationsSource).not.toMatch(/\bfetch\s*\(/u);
    await seedRoot();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const core = new FakeCoreClient();
    const service = createIdentityOperatorService({
      database: testEnv.AUTH_DB,
      core,
      email: new CapturingMailer(),
      publicOrigin,
    });
    try {
      await expect(service.provisionClient({
        sessionId: 'root-session',
        selectedMerchantId: 'merchant-a',
        input: {
          provisioningId: 'provision-private-rpc', merchantId: 'merchant-a', name: 'Merchant A',
          correlationId: 'corr-private-rpc',
        },
      })).resolves.toMatchObject({ status: 'active' });
      expect(core.provisionCalls).toBeGreaterThan(0);
      expect(core.activationCalls).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
