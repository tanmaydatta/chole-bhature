import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, open, readFile, rm, writeFile,
  type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newRunId, RunIdSchema, type RunId } from './config.js';
import { bootstrapLocalRootPasskey, parseLocalRootBootstrapResult } from './passkey-bootstrap.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workerNames = ['core', 'identity', 'operator'] as const;

// Both starts settle before the owner exits, including peers that finish after a rejection.
export async function withLocalStackPair<Stack extends { stop(): Promise<void> }, Result>(
  start: () => Promise<Stack>, use: (stacks: [Stack, Stack]) => Promise<Result>,
): Promise<Result> {
  const attempts = await Promise.allSettled([
    Promise.resolve().then(start), Promise.resolve().then(start),
  ]);
  const stacks = attempts.flatMap(attempt => attempt.status === 'fulfilled' ? [attempt.value] : []);
  const failures: unknown[] = attempts.flatMap(attempt => attempt.status === 'rejected' ? [attempt.reason] : []);
  let result: Result | undefined;
  if (failures.length === 0) {
    try { result = await use([stacks[0]!, stacks[1]!]); }
    catch (error) { failures.push(error); }
  }
  const cleanup = await Promise.allSettled(stacks.map(stack => Promise.resolve().then(() => stack.stop())));
  failures.push(...cleanup.flatMap(attempt => attempt.status === 'rejected' ? [attempt.reason] : []));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Local stack pair failed after owned cleanup');
  return result as Result;
}

// Recognize hints from the complete private log; never reflect any part of its text.
const nativeFailureHints = [
  ['resource-unavailable', /\b(?:EAGAIN|Resource temporarily unavailable|pthread_create)\b/iu],
  ['address-in-use', /\b(?:EADDRINUSE|Address already in use)\b/iu],
  ['too-many-open-files', /\b(?:EMFILE|ENFILE|Too many open files)\b/iu],
  ['out-of-memory', /\b(?:ENOMEM|Cannot allocate memory|Out of memory)\b/iu],
  ['native-check-failed', /\b(?:Check failed|Fatal error)\b/iu],
  ['segmentation-fault', /\bSegmentation fault\b/iu],
] as const;
const knownSignals = new Set(['SIGABRT', 'SIGSEGV', 'SIGKILL', 'SIGTERM', 'SIGBUS', 'SIGILL']);

export function summarizeLocalWorkerFailure(output: string,
  state?: { exitCode: number | null; signalCode: string | null }): string {
  const hints = nativeFailureHints.filter(([, pattern]) => pattern.test(output)).map(([hint]) => hint);
  const exit = state === undefined ? 'not-started' : state.exitCode === null ? 'none'
    : Number.isInteger(state.exitCode) && state.exitCode >= 0 && state.exitCode <= 255
      ? String(state.exitCode) : 'unknown';
  const signal = state?.signalCode == null ? 'none'
    : knownSignals.has(state.signalCode) ? state.signalCode : 'unknown';
  return `hints=${hints.join(',') || 'unknown'}; exit=${exit}; signal=${signal}`;
}

export interface LocalPorts {
  core: number; identity: number; operator: number;
  coreInspector: number; identityInspector: number; operatorInspector: number;
}

export function localStackConfiguration(repo: string, directory: string, runId: string,
  ports: LocalPorts, target: 'local' | 'staging' = 'local') {
  if (target !== 'local') throw new Error('Managed stack is local only');
  RunIdSchema.parse(runId);
  const suffix = runId.replaceAll('_', '-');
  const coreName = `incentives-api-${suffix}`;
  const identityName = `incentives-identity-${suffix}`;
  const operatorName = `incentives-operator-${suffix}`;
  const operatorOrigin = `http://localhost:${ports.operator}`;
  const persistTo = join(directory, 'state');
  const coreConfig = {
    name: coreName, main: join(repo, 'apps/api/src/worker.ts'),
    compatibility_date: '2026-07-18', workers_dev: false, preview_urls: false,
    vars: { APP_ENV: 'local', E2E_LOCAL_TEST_MODE: '1' },
    d1_databases: [{ binding: 'DB', database_name: 'incentives-dev',
      database_id: '00000000-0000-0000-0000-000000000000',
      migrations_dir: join(repo, 'apps/api/migrations') }],
  };
  const identityConfig = {
    name: identityName, main: join(repo, 'apps/identity/src/worker.ts'),
    compatibility_date: '2026-07-20', compatibility_flags: ['nodejs_compat'],
    workers_dev: false, preview_urls: false,
    vars: { APP_ENV: 'local', E2E_LOCAL_TEST_MODE: '1', PUBLIC_APP_ORIGIN: operatorOrigin,
      COOKIE_PREFIX: `incentives-${suffix}`, EMAIL_MODE: 'local-capture',
      MAGIC_LINK_TTL_SECONDS: '300', EMAIL_RATE_LIMIT_MAX: '3',
      EMAIL_RATE_LIMIT_WINDOW_SECONDS: '60', STAGING_ALLOWED_RECIPIENTS: '[]',
      PASSKEY_RP_ID: 'localhost', PASSKEY_RP_NAME: 'Incentives Operator (Local E2E)' },
    d1_databases: [{ binding: 'AUTH_DB', database_name: 'incentives-auth-local',
      database_id: '10000000-0000-0000-0000-000000000001',
      migrations_dir: join(repo, 'apps/identity/migrations') }],
    services: [{ binding: 'CORE', service: coreName, entrypoint: 'CoreOperatorService' }],
  };
  const operatorConfig = {
    name: operatorName, main: join(repo, 'apps/operator-web/src/worker.ts'),
    compatibility_date: '2026-07-20', workers_dev: false, preview_urls: false,
    vars: { APP_ENV: 'local', E2E_LOCAL_TEST_MODE: '1', PUBLIC_APP_ORIGIN: operatorOrigin },
    services: [
      { binding: 'IDENTITY_AUTH', service: identityName },
      { binding: 'IDENTITY', service: identityName, entrypoint: 'IdentityOperatorService' },
      { binding: 'CORE', service: coreName, entrypoint: 'CoreOperatorService' },
    ],
    assets: { directory: join(repo, 'apps/dashboard/dist'), binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/auth/*', '/internal/*', '/operator/v1/*'] },
  };
  return { operatorOrigin, apiOrigin: `http://localhost:${ports.core}`,
    persistTo, coreConfig, identityConfig, operatorConfig };
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve local port'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function localPorts(): Promise<LocalPorts> {
  const values = await Promise.all(Array.from({ length: 6 }, () => reservePort()));
  if (new Set(values).size !== values.length) return localPorts();
  const [core, identity, operator, coreInspector, identityInspector, operatorInspector] = values;
  if ([core, identity, operator, coreInspector, identityInspector, operatorInspector]
    .some(value => value === undefined)) throw new Error('Unable to allocate local ports');
  return { core: core!, identity: identity!, operator: operator!,
    coreInspector: coreInspector!, identityInspector: identityInspector!,
    operatorInspector: operatorInspector! };
}

function wrangler(app: string): string {
  return join(repositoryRoot, `apps/${app}/node_modules/wrangler/bin/wrangler.js`);
}

async function run(command: string, args: string[], cwd: string,
  env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, CI: 'true',
      WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += String(chunk); });
    child.stderr?.on('data', chunk => { output += String(chunk); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolveOutput(output)
      : reject(new Error(`${command.split('/').at(-1)} failed (${code}); inspect local setup logs`)));
  });
}

async function waitFor(origin: string, children: ChildProcess[]): Promise<void> {
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    if (children.some(child => child.exitCode !== null || child.signalCode !== null)) {
      throw new Error('A local Worker stopped before readiness');
    }
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch { /* Wait for the Worker to bind. */ }
    await new Promise(done => setTimeout(done, 150));
  }
  throw new Error(`Local Worker did not become ready at ${origin}`);
}

async function stopChildren(children: ChildProcess[]): Promise<void> {
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(done => {
      child.once('close', () => done());
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5_000).unref();
    });
  }));
}

export async function startManagedLocalStack(options: { skipBuild?: boolean } = {}): Promise<{ stop(): Promise<void>;
  operatorOrigin: string; apiOrigin: string; storageState: string; directory: string; rootUserId: string }> {
  const runId: RunId = newRunId();
  const directory = await mkdtemp(join(tmpdir(), 'incentives-e2e-local-'));
  const children: ChildProcess[] = [];
  const logs: FileHandle[] = [];
  let phase = 'setup';
  async function stop() {
    let failures = 0;
    try { await stopChildren(children); } catch { failures++; }
    const closed = await Promise.allSettled(logs.map(log => log.close()));
    failures += closed.filter(result => result.status === 'rejected').length;
    try { await rm(directory, { recursive: true, force: true }); } catch { failures++; }
    if (failures > 0) throw new Error('Managed local stack cleanup did not complete');
  }
  try {
    await chmod(directory, 0o700);
    const ports = await localPorts();
    const config = localStackConfiguration(repositoryRoot, directory, runId, ports);
    for (const app of workerNames) await mkdir(join(directory, app), { mode: 0o700 });
    const configPaths = Object.fromEntries(workerNames.map(app =>
      [app, join(directory, app, 'wrangler.json')])) as Record<typeof workerNames[number], string>;
    await Promise.all([
      writeFile(configPaths.core, JSON.stringify(config.coreConfig), { mode: 0o600, flag: 'wx' }),
      writeFile(configPaths.identity, JSON.stringify(config.identityConfig), { mode: 0o600, flag: 'wx' }),
      writeFile(configPaths.operator, JSON.stringify(config.operatorConfig), { mode: 0o600, flag: 'wx' }),
    ]);
    const authSecret = randomBytes(32).toString('hex');
    await Promise.all([
      writeFile(join(directory, 'identity/.dev.vars'), `AUTH_SECRET=${authSecret}\n`,
        { mode: 0o600, flag: 'wx' }),
      writeFile(join(directory, 'operator/.dev.vars'),
        `OPERATOR_SELECTION_SECRET=${randomBytes(32).toString('hex')}\n`,
        { mode: 0o600, flag: 'wx' }),
      writeFile(join(directory, 'core/.dev.vars'),
        `DECISION_SIGNING_SECRET=${randomBytes(32).toString('hex')}\n`,
        { mode: 0o600, flag: 'wx' }),
    ]);
    if (!options.skipBuild) {
      phase = 'build';
      await run('pnpm', ['--filter', '@incentives/api', 'build:dependencies'], repositoryRoot);
      await run('pnpm', ['--filter', '@incentives/dashboard', 'build'], repositoryRoot);
    }
    phase = 'migrations';
    for (const [app, database] of [['core', 'incentives-dev'],
      ['identity', 'incentives-auth-local']] as const) {
      await run(process.execPath, [wrangler(app === 'core' ? 'api' : app),
        'd1', 'migrations', 'apply', database, '--local', '--config', configPaths[app],
        '--persist-to', config.persistTo], repositoryRoot);
    }
    phase = 'root-bootstrap';
    const rootEmail = `root+${runId}@e2e.invalid`;
    const bootstrap = await run(process.execPath,
      [join(repositoryRoot, 'apps/identity/src/cli/bootstrap-root-runner.mjs'),
        '--environment', 'local', '--email', rootEmail], repositoryRoot,
      { ...process.env, AUTH_SECRET: authSecret,
        E2E_LOCAL_WRANGLER_CONFIG: configPaths.identity,
        E2E_LOCAL_PERSIST_TO: config.persistTo });
    const expectedRoot = parseLocalRootBootstrapResult(bootstrap);
    phase = 'worker-readiness';
    for (const [app, port, inspector] of [
      ['core', ports.core, ports.coreInspector],
      ['identity', ports.identity, ports.identityInspector],
      ['operator', ports.operator, ports.operatorInspector],
    ] as const) {
      const log = await open(join(directory, `${app}.log`), 'wx', 0o600);
      logs.push(log);
      const workerApp = app === 'core' ? 'api' : app === 'operator' ? 'operator-web' : app;
      const child = spawn(process.execPath,
        [wrangler(workerApp), 'dev', '--config', configPaths[app],
          '--port', String(port), '--inspector-port', String(inspector),
          '--persist-to', config.persistTo, '--log-level', 'error',
          '--show-interactive-dev-session=false'],
        { cwd: repositoryRoot, env: { ...process.env, CI: 'true',
          WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', log.fd, log.fd] });
      children.push(child);
    }
    await waitFor(config.operatorOrigin, children);
    phase = 'passkey-bootstrap';
    const storageState = await bootstrapLocalRootPasskey({ operatorOrigin: config.operatorOrigin,
      expectedRootUserId: expectedRoot.userId, activationGrant: expectedRoot.activationGrant,
      storageStatePath: join(directory, 'root-storage-state.json') });
    return { stop, operatorOrigin: config.operatorOrigin, apiOrigin: config.apiOrigin,
      storageState, directory, rootUserId: expectedRoot.userId };
  } catch {
    const diagnostic = (await Promise.all(workerNames.map(async app => {
      let output = '';
      try {
        output = await readFile(join(directory, `${app}.log`), 'utf8');
      } catch { /* Unavailable private log still has a safe process-state summary. */ }
      return `${app}: ${summarizeLocalWorkerFailure(output, children[workerNames.indexOf(app)])}`;
    }))).join('\n');
    let cleanupFailed = false;
    try { await stop(); } catch { cleanupFailed = true; }
    throw new Error(`Managed local stack startup failed during ${phase}${
      cleanupFailed ? '; owned cleanup incomplete' : ''}\n${diagnostic}`);
  }
}
