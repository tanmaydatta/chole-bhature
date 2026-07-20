import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const identityDirectory = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(identityDirectory, 'src/cli/bootstrap-root-runner.mjs');
const authSecret = 'runner-e2e-auth-secret-at-least-thirty-two-characters';
const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

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
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
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
