import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { OperatorPrincipal } from '@incentives/contracts';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, test } from 'vitest';

import { sha256 } from '../src/recovery.js';
import { createInvitationService } from '../src/services/invitations.js';
import { createOrganizationService } from '../src/services/organizations.js';

const testEnv = env as typeof env & { AUTH_SCHEMA_TEST_DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
const legacy = testEnv.AUTH_SCHEMA_TEST_DB;
const root: OperatorPrincipal = { userId: 'schema-root', sessionId: 'schema-root-session',
  authenticationMethods: ['passkey'], authenticatedAt: '2026-10-21T00:00:00.000Z',
  platformRole: 'root', permissions: [] };

beforeAll(async () => {
  await applyD1Migrations(legacy, testEnv.TEST_MIGRATIONS.filter(migration => migration.name < '0007'));
});

async function seed(database: D1Database) {
  const id = crypto.randomUUID(), now = Date.now();
  await database.batch([
    database.prepare(`INSERT INTO client_provisionings
      (provisioning_id,merchant_id,organization_id,name,status,current_step,retryable,attempt_count,created_at,updated_at,correlation_id)
      VALUES (?1,?1,?1,'Schema compatibility','active','complete',0,1,?2,?2,?1)`).bind(id, now),
    database.prepare(`INSERT INTO organizations (id,merchant_id,provisioning_id,name,status,created_at,updated_at)
      VALUES (?1,?1,?1,'Schema compatibility','active',?2,?2)`).bind(id, now),
    database.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt)
      VALUES (?1,'Existing member',?2,1,?3,?3)`).bind(id, `${id}@example.test`, now),
    database.prepare(`INSERT INTO auth_profile (user_id,subject_kind,status,email_login_enabled)
      VALUES (?1,'employee','active',1)`).bind(id),
    database.prepare(`INSERT INTO memberships (id,organization_id,user_id,role,status,created_at,updated_at)
      VALUES (?1,?1,?1,'viewer','active',?2,?2)`).bind(id, now),
    database.prepare(`INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId,authenticationMethod,authenticatedAt,recoveryOnly)
      VALUES (?1,?2,?1,?3,?3,?1,'magic-link',?3,0)`).bind(id, now + 60_000, now),
  ]);
  return id;
}

function invitations(database: D1Database, send = async (_message: { text: string }) => {}) {
  return createInvitationService({ database, publicOrigin: 'https://operator.example.test', email: { send } });
}

async function sentInvitation(database: D1Database, organizationId: string) {
  const id = crypto.randomUUID(), email = `${id}@example.test`, token = 'A'.repeat(11) + id.replaceAll('-', ''), now = Date.now();
  await database.prepare(`INSERT INTO invitations
    (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
    VALUES (?1,?2,?3,'operator',?4,'sent','schema-root',?5,?6,?6)`)
    .bind(id, organizationId, email, await sha256(token), now + 60_000, now).run();
  return { id, email, token };
}

async function rows(database: D1Database) {
  return Promise.all(['invitations', 'user', 'auth_profile', 'memberships', 'session', 'identity_audit']
    .map(async table => (await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
}

describe('ordinary Identity writes across Auth schemas', () => {
  for (const [name, database] of [['historical 0001–0006', legacy], ['full 0001–0007', env.AUTH_DB]] as const) {
    test(`${name}: invitation issuance and acceptance persist the account, membership and audit`, async () => {
      const organizationId = await seed(database), email = `${crypto.randomUUID()}@example.test`;
      let token: string | undefined;
      const service = invitations(database, async message => {
        const url = message.text.match(/https:\/\/\S+/u)?.[0];
        token = url ? new URL(url).searchParams.get('token') ?? undefined : undefined;
      });
      const invite = await service.createInvitation({ ...root, merchantId: organizationId }, { organizationId, email, role: 'operator',
        expiresInSeconds: 600, correlationId: 'schema-issue' });
      expect(invite.status).toBe('sent');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      const accepted = await service.acceptInvitation({ email, token: token!, correlationId: 'schema-accept' });
      expect(await database.prepare('SELECT status,accepted_by AS userId FROM invitations WHERE id=?1')
        .bind(invite.id).first()).toEqual({ status: 'accepted', userId: accepted.userId });
      expect(await database.prepare('SELECT email,emailVerified FROM user WHERE id=?1').bind(accepted.userId).first())
        .toEqual({ email, emailVerified: 1 });
      expect(await database.prepare('SELECT subject_kind,status FROM auth_profile WHERE user_id=?1').bind(accepted.userId).first())
        .toEqual({ subject_kind: 'employee', status: 'active' });
      expect(await database.prepare('SELECT organization_id,role,status FROM memberships WHERE id=?1').bind(accepted.id).first())
        .toEqual({ organization_id: organizationId, role: 'operator', status: 'active' });
      expect((await database.prepare('SELECT action FROM identity_audit WHERE target_id=?1 ORDER BY rowid').bind(invite.id).all()).results)
        .toEqual([{ action: 'invitation.created' }, { action: 'invitation.delivery' }, { action: 'invitation.accepted' }]);
    });

    test(`${name}: a previously sent invitation accepts without issuing another invitation`, async () => {
      const organizationId = await seed(database), invite = await sentInvitation(database, organizationId);
      const accepted = await invitations(database).acceptInvitation({ ...invite, correlationId: 'schema-existing' });
      expect(await database.prepare('SELECT status,accepted_by AS userId FROM invitations WHERE id=?1').bind(invite.id).first())
        .toEqual({ status: 'accepted', userId: accepted.userId });
      expect(await database.prepare('SELECT role,status FROM memberships WHERE id=?1').bind(accepted.id).first())
        .toEqual({ role: 'operator', status: 'active' });
    });

    test(`${name}: role changes and removal persist and revoke existing sessions`, async () => {
      const id = await seed(database), service = createOrganizationService({ database }), principal = { ...root, merchantId: id };
      await service.changeMemberRole(principal, { membershipId: id, role: 'operator', correlationId: 'schema-role' });
      expect(await database.prepare('SELECT role,status FROM memberships WHERE id=?1').bind(id).first())
        .toEqual({ role: 'operator', status: 'active' });
      expect(await database.prepare('SELECT id FROM session WHERE userId=?1').bind(id).first()).toBeNull();
      const now = Date.now();
      await database.prepare(`INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId,authenticationMethod,authenticatedAt,recoveryOnly)
        VALUES (?1,?2,?1,?3,?3,?1,'magic-link',?3,0)`).bind(id, now + 60_000, now).run();
      await service.removeMember(principal, { membershipId: id, correlationId: 'schema-remove' });
      expect(await database.prepare('SELECT role,status FROM memberships WHERE id=?1').bind(id).first())
        .toEqual({ role: 'operator', status: 'removed' });
      expect(await database.prepare('SELECT id FROM session WHERE userId=?1').bind(id).first()).toBeNull();
      expect((await database.prepare("SELECT action FROM identity_audit WHERE target_id=?1 AND action LIKE 'membership.%' ORDER BY rowid")
        .bind(id).all()).results).toEqual([{ action: 'membership.role_changed' }, { action: 'membership.removed' }]);
    });
  }

  test.each([
    ['organization marker', 'ALTER TABLE organizations ADD COLUMN e2e_control_run_id TEXT', 'ALTER TABLE organizations DROP COLUMN e2e_control_run_id'],
    ['user marker', 'ALTER TABLE user ADD COLUMN e2e_control_run_id TEXT', 'ALTER TABLE user DROP COLUMN e2e_control_run_id'],
    ['claim version', 'ALTER TABLE e2e_run_claims ADD COLUMN control_version INTEGER', 'ALTER TABLE e2e_run_claims DROP COLUMN control_version'],
    ['control table', 'CREATE TABLE e2e_control_runs (organization_id TEXT)', 'DROP TABLE e2e_control_runs'],
    ['control view', 'CREATE VIEW e2e_control_partial AS SELECT 1', 'DROP VIEW e2e_control_partial'],
    ['migration marker', "INSERT INTO d1_migrations (name) VALUES ('0007_e2e_control_leases.sql')", "DELETE FROM d1_migrations WHERE name='0007_e2e_control_leases.sql'"],
    ['mixed-case organization marker', 'ALTER TABLE organizations ADD COLUMN E2E_Control_Run_ID TEXT', 'ALTER TABLE organizations DROP COLUMN E2E_Control_Run_ID'],
    ['mixed-case user marker', 'ALTER TABLE user ADD COLUMN E2E_Control_Run_ID TEXT', 'ALTER TABLE user DROP COLUMN E2E_Control_Run_ID'],
    ['mixed-case claim version', 'ALTER TABLE e2e_run_claims ADD COLUMN Control_Version INTEGER', 'ALTER TABLE e2e_run_claims DROP COLUMN Control_Version'],
    ['uppercase control table', 'CREATE TABLE E2E_CONTROL_RUNS (organization_id TEXT)', 'DROP TABLE E2E_CONTROL_RUNS'],
    ['mixed-case control view', 'CREATE VIEW E2E_Control_Partial AS SELECT 1', 'DROP VIEW E2E_Control_Partial'],
    ['mixed-case migration marker', "INSERT INTO d1_migrations (name) VALUES ('0007_E2E_Control_Leases.sql')", "DELETE FROM d1_migrations WHERE name='0007_E2E_Control_Leases.sql'"],
  ])('partial schema (%s) refuses member, invitation issuance and acceptance without writes', async (_name, apply, restore) => {
    const id = await seed(legacy), invite = await sentInvitation(legacy, id);
    await legacy.prepare(apply).run();
    try {
      if (_name === 'organization marker') {
        await legacy.prepare("UPDATE organizations SET e2e_control_run_id='retained-control-marker' WHERE id=?1").bind(id).run();
      }
      if (_name === 'user marker') {
        await legacy.prepare("UPDATE user SET e2e_control_run_id='retained-control-marker' WHERE id=?1").bind(id).run();
      }
      const before = await rows(legacy), service = createOrganizationService({ database: legacy }), principal = { ...root, merchantId: id };
      await expect(service.changeMemberRole(principal, { membershipId: id, role: 'operator', correlationId: 'partial' })).rejects.toThrow();
      await expect(service.removeMember(principal, { membershipId: id, correlationId: 'partial' })).rejects.toThrow();
      await expect(invitations(legacy).createInvitation(principal, { organizationId: id, email: `${crypto.randomUUID()}@example.test`,
        role: 'viewer', expiresInSeconds: 600, correlationId: 'partial' })).rejects.toThrow();
      await expect(invitations(legacy).acceptInvitation({ ...invite, correlationId: 'partial' })).rejects.toThrow();
      expect(await rows(legacy)).toEqual(before);
    } finally {
      await legacy.prepare(restore).run();
    }
  });

  test.each(['sqlite_master', 'PRAGMA table_info', 'd1_migrations', 'SELECT 1 FROM organizations'])
    ('database failure at %s refuses before any persisted business writes', async boundary => {
      const database = env.AUTH_DB, id = await seed(database), invite = await sentInvitation(database, id);
      const failure = new Error('Injected schema database failure');
      const unavailable = new Proxy(database, { get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          if (sql.includes(boundary)) throw failure;
          return target.prepare(sql);
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const before = await rows(database), principal = { ...root, merchantId: id };
      const service = createOrganizationService({ database: unavailable });
      await expect(service.changeMemberRole(principal, { membershipId: id, role: 'operator', correlationId: 'failure' })).rejects.toThrow(failure);
      await expect(service.removeMember(principal, { membershipId: id, correlationId: 'failure' })).rejects.toThrow(failure);
      await expect(invitations(unavailable).createInvitation(principal, { organizationId: id, email: `${crypto.randomUUID()}@example.test`,
        role: 'viewer', expiresInSeconds: 600, correlationId: 'failure' })).rejects.toThrow();
      await expect(invitations(unavailable).acceptInvitation({ ...invite, correlationId: 'failure' })).rejects.toThrow(failure);
      expect(await rows(database)).toEqual(before);
    });

  test('an existing service rechecks a later migration and refuses an incomplete control fence', async () => {
    const id = await seed(legacy), principal = { ...root, merchantId: id }, service = createOrganizationService({ database: legacy });
    await service.changeMemberRole(principal, { membershipId: id, role: 'operator', correlationId: 'before-migration' });
    await applyD1Migrations(legacy, testEnv.TEST_MIGRATIONS);
    const trigger = await legacy.prepare("SELECT sql FROM sqlite_master WHERE name='e2e_control_guard_final'").first<{ sql: string }>();
    if (!trigger) throw new Error('Missing test control fence');
    await legacy.prepare('DROP TRIGGER e2e_control_guard_final').run();
    try {
      const before = await rows(legacy);
      await expect(service.changeMemberRole(principal, { membershipId: id, role: 'viewer', correlationId: 'after-migration' })).rejects.toThrow();
      expect(await rows(legacy)).toEqual(before);
    } finally {
      await legacy.prepare(trigger.sql).run();
    }
    await service.changeMemberRole(principal, { membershipId: id, role: 'viewer', correlationId: 'restored-migration' });
    expect(await legacy.prepare('SELECT role FROM memberships WHERE id=?1').bind(id).first()).toEqual({ role: 'viewer' });
  });
});
