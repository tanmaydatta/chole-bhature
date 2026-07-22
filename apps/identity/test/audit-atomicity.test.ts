import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

const testEnv = env as typeof env & { AUTH_DB: D1Database };

async function clearData() {
  await testEnv.AUTH_DB.prepare('DROP TRIGGER IF EXISTS test_fail_auth_audit').run();
  await testEnv.AUTH_DB.prepare('DROP TRIGGER IF EXISTS test_probe_session_audit').run();
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare('DELETE FROM identity_audit'),
    testEnv.AUTH_DB.prepare('DELETE FROM passkey'),
    testEnv.AUTH_DB.prepare('DELETE FROM session'),
    testEnv.AUTH_DB.prepare('DELETE FROM invitations'),
    testEnv.AUTH_DB.prepare('DELETE FROM memberships'),
    testEnv.AUTH_DB.prepare('DELETE FROM organizations'),
    testEnv.AUTH_DB.prepare('DELETE FROM client_provisionings'),
    testEnv.AUTH_DB.prepare('DELETE FROM auth_profile'),
    testEnv.AUTH_DB.prepare('DELETE FROM user'),
  ]);
}

async function seedMember() {
  const now = Date.now();
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('member-1', 'Member', 'member@example.test', 1, ?1, ?1)
    `).bind(now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES ('member-1', 'employee', 'active', 1)
    `),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO client_provisionings (
        provisioning_id, merchant_id, organization_id, name, status, current_step,
        attempt_count, created_at, updated_at, correlation_id
      ) VALUES (
        'provisioning-1', 'merchant-1', 'organization-1', 'Merchant', 'active', 'complete',
        1, ?1, ?1, 'seed-correlation'
      )
    `).bind(now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO organizations (
        id, merchant_id, provisioning_id, name, status, created_at, updated_at
      ) VALUES ('organization-1', 'merchant-1', 'provisioning-1', 'Merchant', 'active', ?1, ?1)
    `).bind(now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO memberships (
        id, organization_id, user_id, role, status, created_at, updated_at
      ) VALUES ('membership-1', 'organization-1', 'member-1', 'admin', 'active', ?1, ?1)
    `).bind(now),
  ]);
  return now;
}

async function insertSession(now: number, id = 'session-1') {
  return testEnv.AUTH_DB.prepare(`
    INSERT INTO session (
      id, expiresAt, token, createdAt, updatedAt, userId,
      authenticationMethod, authenticatedAt, recoveryOnly
    ) VALUES (?1, ?2, ?3, ?4, ?4, 'member-1', 'magic-link', ?4, 0)
  `).bind(id, now + 60_000, `secret-${id}`, now).run();
}

async function insertPasskey(now: number, id = 'passkey-1') {
  return testEnv.AUTH_DB.prepare(`
    INSERT INTO passkey (
      id, name, publicKey, userId, credentialID, counter, deviceType,
      backedUp, transports, createdAt, aaguid
    ) VALUES (?1, 'test', 'secret-public-key', 'member-1', ?2, 0,
      'singleDevice', 0, 'internal', ?3, '')
  `).bind(id, `credential-${id}`, now).run();
}

async function installAuditFailure(action: 'session.created' | 'passkey.created') {
  await testEnv.AUTH_DB.prepare(`
    CREATE TRIGGER test_fail_auth_audit
    BEFORE INSERT ON identity_audit
    WHEN NEW.action = '${action}'
    BEGIN SELECT RAISE(ABORT, 'forced auth audit failure'); END
  `).run();
}

beforeEach(clearData);

describe('transactional authentication persistence audit', () => {
  test('Miniflare rolls back a parent insert when an AFTER audit trigger aborts', async () => {
    const now = await seedMember();
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_probe_session_audit
      AFTER INSERT ON session
      BEGIN
        INSERT INTO identity_audit (
          id, occurred_at, actor_kind, actor_id, action, target_type,
          target_id, outcome, correlation_id
        ) VALUES (
          lower(hex(randomblob(16))), NEW.createdAt, 'member', NEW.userId,
          'session.created', 'session', NEW.id, 'succeeded', lower(hex(randomblob(16)))
        );
      END
    `).run();
    await installAuditFailure('session.created');

    await expect(insertSession(now)).rejects.toThrow(/forced auth audit failure/);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);
  });

  test('writes one canonical member session audit with merchant context and no secrets', async () => {
    const now = await seedMember();
    await insertSession(now);

    const audits = await testEnv.AUTH_DB.prepare(`
      SELECT actor_kind AS actorKind, actor_id AS actorId, merchant_id AS merchantId,
        action, target_type AS targetType, target_id AS targetId, outcome,
        correlation_id AS correlationId, metadata_json AS metadataJson
      FROM identity_audit WHERE action = 'session.created'
    `).all<Record<string, unknown>>();

    expect(audits.results).toEqual([{
      actorKind: 'member',
      actorId: 'member-1',
      merchantId: 'merchant-1',
      action: 'session.created',
      targetType: 'session',
      targetId: 'session-1',
      outcome: 'succeeded',
      correlationId: expect.stringMatching(/^[0-9a-f]{32}$/),
      metadataJson: null,
    }]);
    expect(JSON.stringify(audits.results)).not.toContain('secret-session-1');
  });

  test('writes one canonical passkey audit without public-key or credential metadata', async () => {
    const now = await seedMember();
    await insertPasskey(now);

    const audits = await testEnv.AUTH_DB.prepare(`
      SELECT actor_kind AS actorKind, actor_id AS actorId, merchant_id AS merchantId,
        action, target_type AS targetType, target_id AS targetId, outcome,
        correlation_id AS correlationId, metadata_json AS metadataJson
      FROM identity_audit WHERE action = 'passkey.created'
    `).all<Record<string, unknown>>();

    expect(audits.results).toEqual([{
      actorKind: 'member',
      actorId: 'member-1',
      merchantId: 'merchant-1',
      action: 'passkey.created',
      targetType: 'passkey',
      targetId: 'passkey-1',
      outcome: 'succeeded',
      correlationId: expect.stringMatching(/^[0-9a-f]{32}$/),
      metadataJson: null,
    }]);
    expect(JSON.stringify(audits.results)).not.toMatch(/secret-public-key|credential-passkey-1/);
  });

  test.each([
    ['session.created', 'session'] as const,
    ['passkey.created', 'passkey'] as const,
  ])('rolls back %s persistence when its audit insert fails', async (action, table) => {
    const now = await seedMember();
    await installAuditFailure(action);

    const persistence = table === 'session' ? insertSession(now) : insertPasskey(now);

    await expect(persistence).rejects.toThrow(/forced auth audit failure/);
    await expect(testEnv.AUTH_DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first('count'))
      .resolves.toBe(0);
  });
});
