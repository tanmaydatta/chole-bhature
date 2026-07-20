import type {
  ApiCredentialScope,
  OperatorCallContext,
  PermissionKey,
} from '@incentives/contracts';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Env } from '../src/env.js';
import { CoreOperatorService } from '../src/worker.js';

const futureExpiry = '2099-01-01T00:00:00.000Z';

function operatorContext(
  merchantId: string,
  permission: PermissionKey = 'credentials:manage',
): OperatorCallContext {
  return {
    correlationId: `corr-${merchantId}-${permission}`,
    actorUserId: 'root-user',
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
  return operatorService().provisionMerchant(operatorContext(merchantId), {
    id: merchantId,
    name: `Merchant ${merchantId}`,
    provisioningId,
  });
}

async function createCredential(
  merchantId: string,
  input: {
    name?: string;
    kind?: 'publishable' | 'secret';
    scopes?: ApiCredentialScope[];
    allowedOrigins?: string[];
    expiresAt?: string;
  } = {},
) {
  return operatorService().createCredential(operatorContext(merchantId), {
    name: input.name ?? 'Integration key',
    environment: 'production',
    kind: input.kind ?? 'secret',
    scopes: input.scopes ?? ['customers:write'],
    allowedOrigins: input.allowedOrigins,
    expiresAt: input.expiresAt ?? futureExpiry,
  });
}

describe('private Core operator credential service', () => {
  beforeEach(async () => {
    await env.DB.batch([
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
    const first = await provisionMerchant('merchant-a', 'provisioning-event-1');
    const replay = await provisionMerchant('merchant-a', 'provisioning-event-1');

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      id: 'merchant-a',
      name: 'Merchant merchant-a',
      provisioningId: 'provisioning-event-1',
      status: 'active',
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM merchants WHERE provisioning_id = 'provisioning-event-1'",
    ).first<{ count: number }>()).toEqual({ count: 1 });
  });

  test('shows random credential material once and persists only safe metadata plus its digest', async () => {
    await provisionMerchant('merchant-a');
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

  test('keeps credential management scoped to the selected merchant', async () => {
    await provisionMerchant('merchant-a');
    await provisionMerchant('merchant-b');
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
    await provisionMerchant('merchant-a');

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
    await provisionMerchant('merchant-a');
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
});
