import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test } from 'vitest';
import { bootstrapCiRoot } from '../../../scripts/cloud-e2e/root-bootstrap.mjs';
import { createCloudflareClient } from '../../../scripts/cloud-e2e/cloudflare.mjs';
import { resourceNames } from '../../../scripts/cloud-e2e/key.mjs';

const require = createRequire(import.meta.url);
const { Miniflare } = require(require.resolve('miniflare', { paths: [require.resolve('wrangler')] }));
const { unstable_splitSqlQuery: splitSql } = require('wrangler');

const execFileAsync = promisify(execFile);
const identityDirectory = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(identityDirectory, 'src/cli/bootstrap-root-runner.mjs');
const authSecret = 'runner-e2e-auth-secret-at-least-thirty-two-characters';
const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];
const localDatabases: { dispose(): Promise<void> }[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local test port'));
        return;
      }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForWorker(origin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${origin}/internal/health`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Identity worker did not become ready');
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (!child.killed) child.kill('SIGTERM');
  }
  await Promise.all(localDatabases.splice(0).map(database => database.dispose()));
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

type LocalRequest = { method: string; path: string; body?: { sql?: string; params?: unknown[]; name?: string } };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function localRun(index: number, options: { createAuth?: boolean; beforeRequest?: (request: LocalRequest) => Promise<void>; beforeCheckpoint?: (value: unknown) => Promise<void>; replacementId?: string } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'identity-exact-d1-'));
  temporaryDirectories.push(directory);
  const persistDirectory = path.join(directory, 'state');
  const key = { repository_id: 42, repository: 'acme/incentives', pr: 7, head_sha: 'a'.repeat(40), run_id: 100 + index, attempt: 1 };
  const ids = index === 1
    ? { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' }
    : { product: '33333333-3333-4333-8333-333333333333', auth: '44444444-4444-4444-8444-444444444444' };
  const secret = `synthetic-exact-d1-run-${index}-secret-at-least-32-characters`;
  const names = resourceNames(key);
  const miniflare = new Miniflare({ modules: true, script: '', d1Persist: path.join(persistDirectory, 'v3/d1'), d1Databases: { AUTH_DB: ids.auth, PRODUCT_DB: ids.product } });
  localDatabases.push(miniflare);
  const database = await miniflare.getD1Database('AUTH_DB') as D1Database;
  const product = await miniflare.getD1Database('PRODUCT_DB') as D1Database;
  for (const migration of ['0001_auth.sql', '0002_identity_hardening.sql', '0003_organizations_authorization.sql', '0004_auth_persistence_audit.sql', '0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql']) {
    const sql = await readFile(path.join(identityDirectory, 'migrations', migration), 'utf8');
    await database.batch(splitSql(sql).map((statement: string) => database.prepare(statement)));
  }
  await product.prepare('CREATE TABLE product_sentinel (id TEXT PRIMARY KEY)').run();
  await product.prepare('INSERT INTO product_sentinel VALUES (?1)').bind(`product-${index}`).run();
  let ms = Date.now();
  const at = new Date(ms).toISOString();
  const inventory = { key, names, cloudflare: { accountId: `local-account-${index}`, workerIds: {}, d1Ids: {}, accessAppIds: {}, tokenId: null }, stage: 'creating', createdAt: at, updatedAt: at };
  const resources = new Map<string, { uuid: string; name: string }>();
  const calls: LocalRequest[] = [];
  const queryTargets = new Map([[ids.auth, database]]);
  const evidence: unknown[] = [];
  let afterQuery = () => {};
  const protectedD1Ids = { product: '55555555-5555-4555-8555-555555555555', auth: '66666666-6666-4666-8666-666666666666' };
  const d1Client = createCloudflareClient({ accountId: inventory.cloudflare.accountId, inventory, protectedD1Ids, now: () => new Date(ms).toISOString(), store: { async put(value: unknown) { evidence.push(value); await options.beforeCheckpoint?.(value); } }, transport: {
    async request(request: typeof calls[number]) {
      calls.push(request);
      await options.beforeRequest?.(request);
      const root = `/accounts/${inventory.cloudflare.accountId}/d1/database`;
      let result: unknown;
      if (request.path === root && request.method === 'GET') result = [...resources.values()];
      else if (request.path === root && request.method === 'POST') {
        const role = request.body?.name === names.auth ? 'auth' : request.body?.name === names.product ? 'product' : null;
        if (!role) throw new Error('Unknown local D1 create');
        const uuid = role === 'auth' && resources.has(ids.auth) ? options.replacementId : ids[role];
        if (!uuid) throw new Error('Unexpected repeated local D1 create');
        result = { uuid, name: names[role] }; resources.set(uuid, result as { uuid: string; name: string });
      } else if (request.method === 'GET') {
        result = resources.get(request.path.slice(root.length + 1));
        if (!result) return { status: 404 };
      } else if (request.path.endsWith('/query') && request.method === 'POST' && queryTargets.has(request.path.slice(root.length + 1, -6))) {
        // Complete LOCAL protocol: SQL persists through real atomic D1.batch, never a live REST claim.
        const statements = splitSql(request.body?.sql ?? '');
        const target = queryTargets.get(request.path.slice(root.length + 1, -6))!;
        try { result = await target.batch(statements.map((sql: string) => target.prepare(sql).bind(...(request.body?.params ?? [])))); }
        catch { result = [{ success: false, results: [], error: 'Local transaction rolled back' }]; }
        afterQuery();
      } else throw new Error('Unknown exact-ID local protocol');
      return { status: 200, success: true, result, ...(Array.isArray(result) ? { result_info: { total_count: result.length } } : {}) };
    },
  } });
  await d1Client.createD1('product'); if (options.createAuth !== false) await d1Client.createD1('auth');
  const input = { authDatabaseId: ids.auth, key, authSecret: secret, email: `root-${index}@example.test`, d1Client };
  return { input, database, product, ids, directory, persistDirectory, miniflare, calls, evidence, resources, queryTargets, createdAt: ms, afterSql(action: () => void) { afterQuery = action; }, advance(msDelta: number) { ms += msDelta; } };
}

async function counts(database: D1Database) {
  return Promise.all(['user', 'auth_profile', 'recovery_flow', 'identity_audit'].map(table => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<number>('count')));
}

describe('guard-owned local exact-D1 bootstrap', () => {
  for (const postAge of [300001, 200]) {
    test(`post-response clock ${postAge}ms reversed across checkpoint cannot persist root rows or recover authority`, async () => {
      const foreign = await localRun(2);
      let f: Awaited<ReturnType<typeof localRun>>;
      f = await localRun(1, { createAuth: false, beforeRequest: async request => {
        if (request.method === 'POST' && request.path.endsWith('/database') && request.body?.name?.endsWith('-auth')) f.advance(postAge);
      }, beforeCheckpoint: async value => {
        if ((value as { cloudflare?: { d1Ids: { auth?: string } } }).cloudflare?.d1Ids.auth) f.advance(100 - postAge);
      } });
      const created = await f.input.d1Client.createD1('auth');
      const first = await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected');
      f.advance(150);
      const recovered = await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected');
      expect({ first, recovered, originalRows: await counts(f.database), foreignRows: await counts(foreign.database),
        queries: f.calls.filter(call => call.path.endsWith('/query')).length,
      }).toEqual({ first: 'rejected', recovered: 'rejected', originalRows: [0, 0, 0, 0], foreignRows: [0, 0, 0, 0], queries: 0 });
      expect(created.uuid).toBe('22222222-2222-4222-8222-222222222222');
      expect(f.evidence.some(value => (value as { cloudflare?: { d1Ids: { auth?: string } } }).cloudflare?.d1Ids.auth === '22222222-2222-4222-8222-222222222222')).toBe(true);
      expect((await f.input.d1Client.getD1(f.ids.auth)).result.uuid).toBe(f.ids.auth);
      expect(await f.product.prepare('SELECT id FROM product_sentinel').first('id')).toBe('product-1');
      expect(await foreign.product.prepare('SELECT id FROM product_sentinel').first('id')).toBe('product-2');
    });
  }

  test('overlapping Auth creation keeps actual root rows on the requested database and leaves the other run empty', async () => {
    const foreign = await localRun(2);
    const firstList = deferred(); const entered = deferred(); const secondPost = deferred(); const secondEntered = deferred();
    let lists = 0; let waiting = true; let second: Promise<string>;
    const f = await localRun(1, { createAuth: false, replacementId: foreign.ids.auth, beforeRequest: async request => {
      if (request.method === 'GET' && request.path.endsWith('/database') && ++lists === 2) { entered.release(); await firstList.promise; }
      if (request.method === 'POST' && request.path.endsWith('/database') && request.body?.name?.endsWith('-auth') && waiting) { secondEntered.release(); await secondPost.promise; }
      if (request.path.endsWith('/query')) { secondPost.release(); await second; }
    } });
    f.queryTargets.set(foreign.ids.auth, foreign.database);
    const first = f.input.d1Client.createD1('auth'); await entered.promise;
    second = f.input.d1Client.createD1('auth').then(() => 'accepted', () => 'rejected');
    await Promise.race([secondEntered.promise, second]); waiting = false; firstList.release(); await first;
    const result = await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected'); secondPost.release();
    expect({ second: await second, bootstrap: result, originalRows: await counts(f.database), foreignRows: await counts(foreign.database),
      queries: f.calls.filter(call => call.path.endsWith('/query')).map(call => call.path),
      authResources: [...f.resources.values()].filter(resource => resource.name.endsWith('-auth')).length,
    }).toEqual({ second: 'rejected', bootstrap: 'accepted', originalRows: [1, 1, 1, 1], foreignRows: [0, 0, 0, 0],
      queries: Array(2).fill(`/accounts/local-account-1/d1/database/22222222-2222-4222-8222-222222222222/query`), authResources: 1 });
    expect(await foreign.product.prepare('SELECT id FROM product_sentinel').first('id')).toBe('product-2');
  });

  test('expired final exact readback refuses with real bootstrap tables still empty', async () => {
    let reads = 0; let f: Awaited<ReturnType<typeof localRun>>;
    f = await localRun(1, { beforeRequest: async request => {
      if (request.method === 'GET' && request.path.endsWith('/22222222-2222-4222-8222-222222222222') && ++reads === 3) f.advance(300001);
    } });
    expect(await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected')).toBe('rejected');
    expect(await counts(f.database)).toEqual([0, 0, 0, 0]);
    expect(f.calls.filter(call => call.path.endsWith('/query')).length).toBe(1);
    expect(await f.product.prepare('SELECT id FROM product_sentinel').first('id')).toBe('product-1');
  });

  test('changed exact readback between initial SELECT and batch refuses with no persisted bootstrap effects', async () => {
    const f = await localRun(1);
    f.afterSql(() => f.resources.set(f.ids.auth, { uuid: f.ids.auth, name: 'foreign-auth' }));
    expect(await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected')).toBe('rejected');
    expect(await counts(f.database)).toEqual([0, 0, 0, 0]);
    expect(f.calls.filter(call => call.path.endsWith('/query')).length).toBe(1);
  });

  test('persists isolated concurrent roots and real recovery exchange without permitting either-direction swaps', async () => {
    const [first, second] = await Promise.all([localRun(1), localRun(2)]);
    expect(new Set([first.ids.product, first.ids.auth, second.ids.product, second.ids.auth]).size).toBe(4);
    expect(first.input.authSecret === second.input.authSecret).toBe(false);
    const results = await Promise.all([first, second].map(async f => {
      const attempts = await Promise.all(Array.from({ length: 8 }, () => bootstrapCiRoot(f.input)));
      expect(new Set(attempts.map(result => result.activationGrant)).size).toBe(1);
      expect(await counts(f.database)).toEqual([1, 1, 1, 1]);
      const row = await f.database.prepare(`SELECT user.email, auth_profile.status, auth_profile.subject_kind,
        auth_profile.email_login_enabled FROM user JOIN auth_profile ON user.id = auth_profile.user_id`).first();
      expect(row).toEqual({ email: f.input.email, status: 'pending', subject_kind: 'root', email_login_enabled: 0 });
      const flow = await f.database.prepare('SELECT created_at, expires_at, grant_hash, initiating_code_hash FROM recovery_flow').first<{ created_at: number; expires_at: number; grant_hash: string; initiating_code_hash: string }>();
      expect(flow!.expires_at - flow!.created_at).toBe(600_000);
      expect(attempts[0].expiresAt).toBe(f.createdAt + 600_000);
      expect(flow!.grant_hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(flow!.initiating_code_hash).toMatch(/^[a-f0-9]{64}$/u);
      const serialized = JSON.stringify({ calls: f.calls, evidence: f.evidence, flow, audit: await f.database.prepare('SELECT * FROM identity_audit').all() });
      expect(serialized.includes(f.input.authSecret)).toBe(false);
      expect(serialized.includes(attempts[0].activationGrant)).toBe(false);
      expect(await f.product.prepare('SELECT id FROM product_sentinel').first('id')).toBe(`product-${f.input.key.run_id - 100}`);
      return attempts[0];
    }));
    expect(results[0].activationGrant === results[1].activationGrant).toBe(false);
    for (const [recipient, foreign] of [[first, second], [second, first]]) {
      const before = await counts(recipient.database);
      const queryCount = recipient.calls.filter(c => c.path.endsWith('/query')).length;
      for (const change of [{ authDatabaseId: foreign.ids.auth }, { d1Client: foreign.input.d1Client }, { key: foreign.input.key }]) {
        expect(await bootstrapCiRoot({ ...recipient.input, ...change }).then(() => 'accepted', () => 'rejected')).toBe('rejected');
      }
      expect(recipient.calls.filter(c => c.path.endsWith('/query')).length).toBe(queryCount);
      expect(await counts(recipient.database)).toEqual(before);
    }
    for (const [f, issued] of [[first, results[0]], [second, results[1]]] as const) {
      await f.miniflare.dispose(); localDatabases.splice(localDatabases.indexOf(f.miniflare), 1);
      const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
      const configPath = path.join(f.directory, 'wrangler.toml');
      await writeFile(configPath, `name = "identity-exact-d1-${f.input.key.run_id}"
main = "${path.join(identityDirectory, 'src/worker.ts')}"
compatibility_date = "2026-07-20"
compatibility_flags = ["nodejs_compat"]
[vars]
APP_ENV = "local"
AUTH_SECRET = "${f.input.authSecret}"
PUBLIC_APP_ORIGIN = "${origin}"
COOKIE_PREFIX = "identity-exact-${f.input.key.run_id}"
EMAIL_MODE = "local-capture"
MAGIC_LINK_TTL_SECONDS = "300"
EMAIL_RATE_LIMIT_MAX = "3"
EMAIL_RATE_LIMIT_WINDOW_SECONDS = "60"
STAGING_ALLOWED_RECIPIENTS = "[]"
PASSKEY_RP_ID = "127.0.0.1"
PASSKEY_RP_NAME = "Identity Exact D1"
[[d1_databases]]
binding = "AUTH_DB"
database_name = "local-exact-auth"
database_id = "${f.ids.auth}"
`, { mode: 0o600 });
      const worker = spawn(path.join(identityDirectory, 'node_modules/.bin/wrangler'), ['dev', '--config', configPath, '--persist-to', f.persistDirectory, '--ip', '127.0.0.1', '--port', String(port)], { cwd: identityDirectory, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      childProcesses.push(worker); await waitForWorker(origin);
      const foreignGrant = f === first ? results[1].activationGrant : results[0].activationGrant;
      const foreignResponse = await fetch(`${origin}/auth/root/recovery/exchange`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: foreignGrant }) });
      expect(foreignResponse.status).not.toBe(200);
      const exchanged = await fetch(`${origin}/auth/root/recovery/exchange`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: issued.activationGrant }) });
      expect(exchanged.status).toBe(200);
      expect(exchanged.headers.get('set-cookie')?.includes(`identity-exact-${f.input.key.run_id}`)).toBe(true);
    }
  });

  test('audit failure rolls back new root and expired reissue; retry converges and authority refuses active or other email', async () => {
    const f = await localRun(1);
    const trigger = `CREATE TRIGGER local_fail_bootstrap_audit BEFORE INSERT ON identity_audit WHEN NEW.action = 'root.bootstrap' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`;
    await f.database.prepare(trigger).run();
    expect(await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected')).toBe('rejected');
    expect(await counts(f.database)).toEqual([0, 0, 0, 0]);
    await f.database.prepare('DROP TRIGGER local_fail_bootstrap_audit').run();
    const original = await bootstrapCiRoot(f.input);
    expect((await bootstrapCiRoot(f.input)).activationGrant === original.activationGrant).toBe(true);
    await f.database.prepare('UPDATE recovery_flow SET expires_at = 0').run();
    await f.database.prepare(trigger).run();
    expect(await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected')).toBe('rejected');
    expect(await counts(f.database)).toEqual([1, 1, 1, 1]);
    expect(await f.database.prepare('SELECT cancelled_at FROM recovery_flow').first('cancelled_at')).toBeNull();
    await f.database.prepare('DROP TRIGGER local_fail_bootstrap_audit').run();
    const reissued = await Promise.all(Array.from({ length: 4 }, () => bootstrapCiRoot(f.input)));
    expect(new Set(reissued.map(result => result.activationGrant)).size).toBe(1);
    expect(reissued[0].activationGrant === original.activationGrant).toBe(false);
    expect(await counts(f.database)).toEqual([1, 1, 2, 2]);
    const before = await counts(f.database);
    expect(await bootstrapCiRoot({ ...f.input, email: 'different@example.test' }).then(() => 'accepted', () => 'rejected')).toBe('rejected');
    await f.database.prepare("UPDATE auth_profile SET status = 'active'").run();
    expect(await bootstrapCiRoot(f.input).then(() => 'accepted', () => 'rejected')).toBe('rejected');
    expect(await counts(f.database)).toEqual(before);
  });
});

describe('real root bootstrap runner', () => {
  test('uses safe Wrangler execution and emits a grant accepted by the real recovery endpoint', async () => {
    const testDirectory = await mkdtemp(path.join(tmpdir(), 'identity-runner-e2e-'));
    temporaryDirectories.push(testDirectory);
    const persistDirectory = path.join(testDirectory, 'd1');
    const fakeBinDirectory = path.join(testDirectory, 'bin');
    const capturePath = path.join(testDirectory, 'capture.json');
    await mkdir(fakeBinDirectory);
    const wranglerPath = path.join(identityDirectory, 'node_modules/.bin/wrangler');

    await execFileAsync(wranglerPath, [
      'd1', 'migrations', 'apply', 'incentives-auth-local',
      '--local', '--config', 'wrangler.toml', '--persist-to', persistDirectory,
    ], { cwd: identityDirectory });

    const fakePnpmPath = path.join(fakeBinDirectory, 'pnpm');
    await writeFile(fakePnpmPath, `#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
if (fileIndex >= 0) {
  const sqlFile = args[fileIndex + 1];
  writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
    args,
    sqlFile,
    sql: readFileSync(sqlFile, 'utf8'),
    mode: statSync(sqlFile).mode & 0o777,
    hasAuthSecret: Object.hasOwn(process.env, 'AUTH_SECRET'),
  }));
}
const result = spawnSync(process.env.REAL_WRANGLER, [
  ...args.slice(2), '--persist-to', process.env.TEST_D1_PERSIST,
], { env: process.env, stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
    await chmod(fakePnpmPath, 0o700);

    const runner = await execFileAsync(process.execPath, [
      runnerPath, '--environment', 'local', '--email', 'root@example.test',
    ], {
      cwd: identityDirectory,
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        AUTH_SECRET: authSecret,
        CAPTURE_PATH: capturePath,
        REAL_WRANGLER: wranglerPath,
        TEST_D1_PERSIST: persistDirectory,
      },
    });
    expect(runner.stderr).toBe('');
    const bootstrap = JSON.parse(runner.stdout) as {
      activationGrant: string;
      userId: string;
    };
    expect(bootstrap.activationGrant).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      args: string[];
      sqlFile: string;
      sql: string;
      mode: number;
      hasAuthSecret: boolean;
    };
    expect(capture.mode).toBe(0o600);
    expect(capture.hasAuthSecret).toBe(false);
    expect(capture.args.join(' ')).not.toContain(authSecret);
    expect(capture.sql).not.toContain(authSecret);
    expect(capture.sql).not.toContain(bootstrap.activationGrant);
    await expect(stat(capture.sqlFile)).rejects.toMatchObject({ code: 'ENOENT' });

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const configPath = path.join(testDirectory, 'wrangler.toml');
    await writeFile(configPath, `
name = "identity-runner-e2e"
main = "${path.join(identityDirectory, 'src/worker.ts')}"
compatibility_date = "2026-07-20"
compatibility_flags = ["nodejs_compat"]

[vars]
APP_ENV = "local"
AUTH_SECRET = "${authSecret}"
PUBLIC_APP_ORIGIN = "${origin}"
COOKIE_PREFIX = "identity-runner-e2e"
EMAIL_MODE = "local-capture"
MAGIC_LINK_TTL_SECONDS = "300"
EMAIL_RATE_LIMIT_MAX = "3"
EMAIL_RATE_LIMIT_WINDOW_SECONDS = "60"
STAGING_ALLOWED_RECIPIENTS = "[]"
PASSKEY_RP_ID = "127.0.0.1"
PASSKEY_RP_NAME = "Identity Runner E2E"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "incentives-auth-local"
database_id = "10000000-0000-0000-0000-000000000001"
`, { mode: 0o600 });
    const worker = spawn(wranglerPath, [
      'dev', '--config', configPath,
      '--persist-to', persistDirectory, '--ip', '127.0.0.1', '--port', String(port),
    ], {
      cwd: identityDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    childProcesses.push(worker);
    await waitForWorker(origin);

    const exchanged = await fetch(`${origin}/auth/root/recovery/exchange`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: bootstrap.activationGrant }),
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get('set-cookie')).toContain('identity-runner-e2e');
  });
});
