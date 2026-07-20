import type {
  ApiCredentialCreateInput,
  ApiCredentialScope,
  OperatorCallContext,
  PermissionKey,
} from '@incentives/contracts';
import {
  ApiCredentialCreateResultSchema,
  CoreMerchantActivationResultSchema,
  CoreMerchantProvisionResultSchema,
  MerchantActivationResultSchema,
  MerchantProvisionResultSchema,
} from '@incentives/contracts';
import * as contracts from '@incentives/contracts';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Env } from '../src/env.js';
import { CoreOperatorService } from '../src/worker.js';

const futureExpiry = '2099-01-01T00:00:00.000Z';

function operatorContext(
  merchantId: string,
  permission: PermissionKey = 'credentials:manage',
  actorUserId = 'root-user',
): OperatorCallContext {
  return {
    correlationId: `corr-${merchantId}-${permission}-${actorUserId}`,
    actorUserId,
    actorKind: 'root',
    merchantId,
    permission,
  };
}

function operatorService(): CoreOperatorService {
  return new CoreOperatorService(createExecutionContext(), env as Env);
}

async function provisionMerchant(
  merchantId: string,
  provisioningId = `provision-${merchantId}`,
) {
  const result = CoreMerchantProvisionResultSchema.parse(
    await operatorService().provisionMerchant(operatorContext(merchantId), {
    id: merchantId,
    name: `Merchant ${merchantId}`,
    provisioningId,
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function activateMerchant(
  merchantId: string,
  provisioningId = `provision-${merchantId}`,
) {
  const result = CoreMerchantActivationResultSchema.parse(
    await operatorService().activateMerchant(operatorContext(merchantId), {
    id: merchantId,
    provisioningId,
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function provisionActiveMerchant(merchantId: string) {
  await provisionMerchant(merchantId);
  return activateMerchant(merchantId);
}

async function createCredential(
  merchantId: string,
  input: {
    name?: string;
    kind?: 'publishable' | 'secret';
    scopes?: ApiCredentialScope[];
    allowedOrigins?: string[];
    expiresAt?: string;
    requestsPerMinute?: number;
  } = {},
) {
  const request: ApiCredentialCreateInput = {
    name: input.name ?? 'Integration key',
    environment: 'production',
    kind: input.kind ?? 'secret',
    scopes: input.scopes ?? ['customers:write'],
    expiresAt: input.expiresAt ?? futureExpiry,
    ...(input.allowedOrigins === undefined ? {} : { allowedOrigins: input.allowedOrigins }),
    ...(input.requestsPerMinute === undefined ? {} : {
      requestsPerMinute: input.requestsPerMinute,
    }),
  };
  return operatorService().createCredential(operatorContext(merchantId), request);
}

describe('private Core operator credential service', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DROP TRIGGER IF EXISTS fail_credential_created_audit'),
      env.DB.prepare('DROP TRIGGER IF EXISTS fail_credential_revoked_audit'),
      env.DB.prepare('DELETE FROM product_audit'),
      env.DB.prepare('DELETE FROM api_credentials'),
      env.DB.prepare('DELETE FROM redemptions'),
      env.DB.prepare('DELETE FROM evaluation_decisions'),
      env.DB.prepare('DELETE FROM program_counters'),
      env.DB.prepare('DELETE FROM program_revisions'),
      env.DB.prepare('DELETE FROM programs'),
      env.DB.prepare('DELETE FROM customers'),
      env.DB.prepare('DELETE FROM schema_versions'),
      env.DB.prepare('DELETE FROM variable_definitions'),
      env.DB.prepare('DELETE FROM merchants'),
    ]);
  });

  test('provisions a merchant idempotently by the trusted provisioning identity', async () => {
    const first = MerchantProvisionResultSchema.parse(
      await provisionMerchant('merchant-a', 'provisioning-event-1'),
    );
    const replay = MerchantProvisionResultSchema.parse(
      await provisionMerchant('merchant-a', 'provisioning-event-1'),
    );

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      id: 'merchant-a',
      name: 'Merchant merchant-a',
      provisioningId: 'provisioning-event-1',
      status: 'provisioning',
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM merchants WHERE provisioning_id = 'provisioning-event-1'",
    ).first<{ count: number }>()).toEqual({ count: 1 });
  });

  test('preserves the exact merchant id, name, and provisioning id at the real Core RPC boundary', async () => {
    const service = operatorService();
    const requested = {
      id: 'merchant-exact',
      name: 'Exact merchant name',
      provisioningId: 'provisioning-exact',
    };

    const provisionEnvelope = CoreMerchantProvisionResultSchema.parse(
      await service.provisionMerchant(operatorContext(requested.id), requested),
    );
    if (!provisionEnvelope.ok) throw new Error('Expected Core provisioning success');
    const activationEnvelope = CoreMerchantActivationResultSchema.parse(
      await service.activateMerchant(operatorContext(requested.id), {
        id: requested.id,
        provisioningId: requested.provisioningId,
      }),
    );
    if (!activationEnvelope.ok) throw new Error('Expected Core activation success');

    expect(provisionEnvelope.value).toMatchObject(requested);
    expect(activationEnvelope.value).toMatchObject(requested);
  });

  test('returns typed permanent conflict envelopes from the real Core provisioning and activation boundary', async () => {
    const schemas = contracts as unknown as Record<string, {
      parse(value: unknown): { ok: boolean; error?: { code: string; retryable: boolean } };
    }>;
    const service = operatorService();
    const context = operatorContext('merchant-envelope');
    const request = {
      id: 'merchant-envelope',
      name: 'Envelope merchant',
      provisioningId: 'provision-envelope',
    };
    const provisioned = schemas.CoreMerchantProvisionResultSchema.parse(
      await service.provisionMerchant(context, request),
    );
    expect(provisioned.ok).toBe(true);

    const provisionConflict = schemas.CoreMerchantProvisionResultSchema.parse(
      await service.provisionMerchant(context, {
        ...request,
        provisioningId: 'provision-conflict',
      }),
    );
    expect(provisionConflict).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Merchant provisioning identity conflicts',
        retryable: false,
      },
    });

    const activationConflict = schemas.CoreMerchantActivationResultSchema.parse(
      await service.activateMerchant(context, {
        id: request.id,
        provisioningId: 'provision-conflict',
      }),
    );
    expect(activationConflict).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Merchant provisioning identity conflicts',
        retryable: false,
      },
    });
  });

  test('activates the same provisioning saga idempotently and rejects conflicting identity', async () => {
    const provisioned = MerchantProvisionResultSchema.parse(
      await provisionMerchant('merchant-a', 'provisioning-event-1'),
    );
    expect(provisioned.status).toBe('provisioning');

    await expect(activateMerchant('merchant-a', 'different-provisioning-event'))
      .rejects.toThrow(/provisioning identity conflicts/i);
    expect(await env.DB.prepare(`
      SELECT status FROM merchants WHERE id = 'merchant-a'
    `).first()).toEqual({ status: 'provisioning' });

    const first = MerchantActivationResultSchema.parse(
      await activateMerchant('merchant-a', 'provisioning-event-1'),
    );
    const replay = MerchantActivationResultSchema.parse(
      await activateMerchant('merchant-a', 'provisioning-event-1'),
    );
    expect(first).toMatchObject({
      id: 'merchant-a',
      provisioningId: 'provisioning-event-1',
      status: 'active',
    });
    expect(replay).toEqual(first);
    expect(MerchantProvisionResultSchema.parse(
      await provisionMerchant('merchant-a', 'provisioning-event-1'),
    )).toEqual(first);
  });

  test('rejects conflicting merchant and provisioning saga identities without duplicates', async () => {
    await provisionMerchant('merchant-a', 'provisioning-event-1');
    await expect(provisionMerchant('merchant-a', 'provisioning-event-2'))
      .rejects.toThrow(/identity conflicts/i);
    await expect(provisionMerchant('merchant-b', 'provisioning-event-1'))
      .rejects.toThrow(/identity conflicts/i);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM merchants').first())
      .toEqual({ count: 1 });
  });

  test('parses strict canonical merchant and credential RPC inputs at the Worker boundary', async () => {
    await expect(operatorService().provisionMerchant(operatorContext('merchant-a'), {
      id: 'merchant-a',
      name: 'Merchant merchant-a',
      provisioningId: 'provisioning-event-1',
      forgedStatus: 'active',
    })).rejects.toMatchObject({ name: 'ZodError' });

    await provisionActiveMerchant('merchant-a');
    const created = ApiCredentialCreateResultSchema.parse(await createCredential('merchant-a'));
    expect(created.credential).not.toHaveProperty('digest');
    await expect(operatorService().createCredential(operatorContext('merchant-a'), {
      name: 'Strict key',
      environment: 'production',
      kind: 'secret',
      scopes: ['customers:write'],
      repositoryOnlyDigest: 'forged',
    })).rejects.toMatchObject({ name: 'ZodError' });
  });

  test('shows random credential material once and persists only safe metadata plus its digest', async () => {
    await provisionActiveMerchant('merchant-a');
    const created = await createCredential('merchant-a', {
      name: 'Checkout secret',
      kind: 'secret',
      scopes: ['customers:write', 'evaluations:write'],
    });

    expect(created.token).toMatch(/^sk_[A-Za-z0-9_-]{32,}$/u);
    expect(created.credential).toMatchObject({
      merchantId: 'merchant-a',
      name: 'Checkout secret',
      kind: 'secret',
      status: 'active',
      suffix: created.token.slice(-8),
    });
    expect(created.credential).not.toHaveProperty('digest');
    expect(created.credential).not.toHaveProperty('token');

    const listed = await operatorService().listCredentials(
      operatorContext('merchant-a', 'credentials:read'),
    );
    expect(listed).toEqual([created.credential]);
    expect(JSON.stringify(listed)).not.toContain(created.token);

    const stored = await env.DB.prepare(`
      SELECT digest, suffix, scopes_json AS scopesJson
      FROM api_credentials WHERE id = ?1
    `).bind(created.credential.id).first<{
      digest: string;
      suffix: string;
      scopesJson: string;
    }>();
    expect(stored).not.toBeNull();
    expect(stored?.digest).not.toBe(created.token);
    expect(stored?.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored?.suffix).toBe(created.token.slice(-8));
    expect(stored?.scopesJson).not.toContain(created.token);

    const columns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('api_credentials') ORDER BY cid",
    ).all<{ name: string }>();
    expect(columns.results.map(({ name }) => name)).not.toContain('token');
  });

  test('defaults and persists configurable publishable quotas while leaving secrets unthrottled', async () => {
    await provisionActiveMerchant('merchant-a');
    const defaulted = await createCredential('merchant-a', {
      name: 'Default browser quota',
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://shop.example'],
    });
    const configured = await createCredential('merchant-a', {
      name: 'Configured browser quota',
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://shop.example'],
      requestsPerMinute: 500,
    });
    const secret = await createCredential('merchant-a', {
      name: 'Unthrottled server key',
      kind: 'secret',
      scopes: ['schema:read'],
    });

    expect(defaulted.credential).toMatchObject({ requestsPerMinute: 60 });
    expect(configured.credential).toMatchObject({ requestsPerMinute: 500 });
    expect(secret.credential).not.toHaveProperty('requestsPerMinute');
    expect((await env.DB.prepare(`
      SELECT name, requests_per_minute AS requestsPerMinute
      FROM api_credentials WHERE merchant_id = 'merchant-a' ORDER BY name
    `).all()).results).toEqual([
      { name: 'Configured browser quota', requestsPerMinute: 500 },
      { name: 'Default browser quota', requestsPerMinute: 60 },
      { name: 'Unthrottled server key', requestsPerMinute: null },
    ]);
  });

  test('keeps credential management scoped to the selected merchant', async () => {
    await provisionActiveMerchant('merchant-a');
    await provisionActiveMerchant('merchant-b');
    const credentialA = await createCredential('merchant-a');
    const credentialB = await createCredential('merchant-b');

    const listedA = await operatorService().listCredentials(
      operatorContext('merchant-a', 'credentials:read'),
    );
    const listedB = await operatorService().listCredentials(
      operatorContext('merchant-b', 'credentials:read'),
    );

    expect(listedA.map(({ id }) => id)).toEqual([credentialA.credential.id]);
    expect(listedB.map(({ id }) => id)).toEqual([credentialB.credential.id]);
    await expect(operatorService().revokeCredential(
      operatorContext('merchant-b'),
      credentialA.credential.id,
    )).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  test('requires the exact operator permission for every private credential operation', async () => {
    await provisionActiveMerchant('merchant-a');

    await expect(operatorService().createCredential(
      operatorContext('merchant-a', 'credentials:read'),
      {
        name: 'Forbidden key',
        environment: 'production',
        kind: 'secret',
        scopes: ['customers:write'],
      },
    )).rejects.toMatchObject({ name: 'ForbiddenError' });

    await expect(operatorService().listCredentials(
      operatorContext('merchant-a', 'credentials:manage'),
    )).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  test('audits credential creation and revocation without token material or digests', async () => {
    await provisionActiveMerchant('merchant-a');
    const created = await createCredential('merchant-a');
    await operatorService().revokeCredential(
      operatorContext('merchant-a'),
      created.credential.id,
    );

    const audit = await env.DB.prepare(`
      SELECT actor_kind AS actorKind, actor_id AS actorId, merchant_id AS merchantId,
        action, target_type AS targetType, target_id AS targetId,
        correlation_id AS correlationId, metadata_json AS metadataJson
      FROM product_audit WHERE target_id = ?1 ORDER BY occurred_at, id
    `).bind(created.credential.id).all<Record<string, string | null>>();

    expect(audit.results).toHaveLength(2);
    expect(audit.results.map(({ action }) => action)).toEqual([
      'credential.created',
      'credential.revoked',
    ]);
    const serialized = JSON.stringify(audit.results);
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toMatch(/[a-f0-9]{64}/u);
    expect(serialized).toContain(created.credential.suffix);
  });

  test('rolls back credential creation when the matching audit append fails', async () => {
    await provisionActiveMerchant('merchant-a');
    await env.DB.prepare(`
      CREATE TRIGGER fail_credential_created_audit
      BEFORE INSERT ON product_audit
      WHEN NEW.action = 'credential.created'
      BEGIN
        SELECT RAISE(ABORT, 'forced credential create audit failure');
      END
    `).run();

    await expect(createCredential('merchant-a', {
      name: 'Must roll back',
    })).rejects.toThrow(/forced credential create audit failure/u);

    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM api_credentials WHERE merchant_id = 'merchant-a'
    `).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM product_audit
      WHERE merchant_id = 'merchant-a' AND action = 'credential.created'
    `).first()).toEqual({ count: 0 });
  });

  test('rolls back revocation when the matching audit append fails', async () => {
    await provisionActiveMerchant('merchant-a');
    const created = await createCredential('merchant-a', { name: 'Remain active' });
    await env.DB.prepare(`
      CREATE TRIGGER fail_credential_revoked_audit
      BEFORE INSERT ON product_audit
      WHEN NEW.action = 'credential.revoked'
      BEGIN
        SELECT RAISE(ABORT, 'forced credential revoke audit failure');
      END
    `).run();

    await expect(operatorService().revokeCredential(
      operatorContext('merchant-a'),
      created.credential.id,
    )).rejects.toThrow(/forced credential revoke audit failure/u);

    expect(await env.DB.prepare(`
      SELECT status, revoked_at AS revokedAt, revoked_by AS revokedBy
      FROM api_credentials WHERE id = ?1
    `).bind(created.credential.id).first()).toEqual({
      status: 'active',
      revokedAt: null,
      revokedBy: null,
    });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM product_audit
      WHERE target_id = ?1 AND action = 'credential.revoked'
    `).bind(created.credential.id).first()).toEqual({ count: 0 });
  });

  test('treats repeated revocation as idempotent and preserves the first actor history', async () => {
    await provisionActiveMerchant('merchant-a');
    const created = await createCredential('merchant-a', { name: 'Rotate once' });

    const first = await operatorService().revokeCredential(
      operatorContext('merchant-a', 'credentials:manage', 'first-admin'),
      created.credential.id,
    );
    const replay = await operatorService().revokeCredential(
      operatorContext('merchant-a', 'credentials:manage', 'second-admin'),
      created.credential.id,
    );

    expect(replay).toEqual(first);
    const revocationAudit = await env.DB.prepare(`
      SELECT actor_id AS actorId, correlation_id AS correlationId
      FROM product_audit
      WHERE target_id = ?1 AND action = 'credential.revoked'
      ORDER BY occurred_at, id
    `).bind(created.credential.id).all<{ actorId: string; correlationId: string }>();
    expect(revocationAudit.results).toEqual([{
      actorId: 'first-admin',
      correlationId: 'corr-merchant-a-credentials:manage-first-admin',
    }]);
  });
});
