import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newRunId, RunIdSchema, type RunId } from './config.js';
import { bootstrapLocalRootPasskey, parseLocalRootBootstrapResult } from './passkey-bootstrap.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workerNames = ['core', 'identity', 'operator'] as const;

const phases = ['setup', 'build', 'migrations', 'root-bootstrap', 'worker-readiness',
  'passkey-bootstrap', 'ready', 'cleanup'] as const;

function cleanupDeadline<Result>(operation: Promise<Result>): Promise<Result> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Owned local cleanup deadline exceeded')), 10_000);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

const ownedProcessStops = new WeakMap<ChildProcess, Promise<void>>();
const ownedProcessState = new WeakMap<ChildProcess,
  { cleaned: boolean; forced: boolean; commandCode: number | null; commandSignal: string | null }>();

// The live supervisor pins its group's identity. Only it signals its own group;
// the parent communicates over IPC and never signals a remembered negative PID.
const supervisorProgram = String.raw`
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const inspect = promisify(execFile);
let stopping;
const send = message => new Promise(done => {
  if (!process.connected) return done();
  process.send(message, () => done());
});
process.on('SIGTERM', () => {});
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    try {
      process.kill(-process.pid, 'SIGTERM');
      const until = Date.now() + 5000;
      while (true) {
        const inspection = inspect('/bin/ps', ['-axo', 'pid=,pgid=,stat='],
          {timeout: 1000, maxBuffer: 1048576});
        const inspectorPID = inspection.child.pid;
        const {stdout} = await inspection;
        const livePeers = stdout.split('\n').some(line => {
          const [pid, group, state] = line.trim().split(/\s+/);
          return Number(group) === process.pid && Number(pid) !== process.pid
            && Number(pid) !== inspectorPID
            && state && !state.startsWith('Z');
        });
        if (!livePeers) { await send({type: 'cleaned'}); process.exit(0); }
        if (Date.now() >= until) {
          await send({type: 'forced'});
          process.kill(-process.pid, 'SIGKILL');
          return;
        }
        await new Promise(done => setTimeout(done, 25));
      }
    } catch {
      await send({type: 'cleanup-failed'});
      // Retain the live identity for best-effort termination even if inspection failed.
      try { process.kill(-process.pid, 'SIGKILL'); } catch {}
      process.exit(1);
    }
  })();
  return stopping;
}
process.on('disconnect', () => { void stop(); });
process.on('message', message => {
  if (message.type === 'stop') { void stop(); return; }
  if (message.type !== 'start' || stopping) return;
  const command = spawn(message.command, message.args, {stdio: [0, 1, 2]});
  let reported = false;
  const finished = async (code, signal) => {
    if (reported) return;
    reported = true;
    await send({type: 'command-exit', code, signal});
    void stop();
  };
  command.once('error', () => { void finished(null, null); });
  command.once('exit', (code, signal) => { void finished(code, signal); });
});
`;

function stopOwnedProcess(child: ChildProcess): Promise<void> {
  const previous = ownedProcessStops.get(child);
  if (previous) return previous;
  const state = ownedProcessState.get(child)!;
  const stopped = new Promise<void>((resolveStop, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const completed = () => {
      clearTimeout(timer);
      if (state.cleaned || (state.forced && child.signalCode === 'SIGKILL')) resolveStop();
      else reject(new Error('Owned local supervisor cleanup incomplete'));
    };
    if (child.exitCode !== null || child.signalCode !== null) { completed(); return; }
    child.once('close', completed);
    timer = setTimeout(() => {
      // ChildProcess's live handle is used only for this supervisor, never a stale group ID.
      child.kill('SIGKILL');
      reject(new Error('Owned local supervisor cleanup deadline exceeded'));
    }, 10_000);
    if (child.connected) child.send({ type: 'stop' }, () => {});
  });
  ownedProcessStops.set(child, stopped);
  return stopped;
}

// Register before acquisition; cancellation bounds pending-resource cleanup.
export function createLocalStackOwner() {
  const children: ChildProcess[] = [];
  const cleanup: (() => Promise<void>)[] = [];
  const controller = new AbortController();
  const began = Date.now();
  let phase = 'setup';
  let stopping: Promise<void> | undefined;
  const check = () => { if (controller.signal.aborted) throw new Error('Local stack operation cancelled'); };
  const report = () => console.log(`local-stack phase=${phase}; elapsed_ms=${
    Math.max(0, Math.min(3_600_000, Date.now() - began))}`);
  const heartbeat = setInterval(report, 10_000);
  heartbeat.unref();
  const owner = {
    signal: controller.signal,
    check,
    phase(value: string) { phase = phases.includes(value as typeof phases[number]) ? value : 'unknown'; report(); },
    own(stop: () => Promise<void>) {
      check();
      let stopped: Promise<void> | undefined;
      cleanup.push(() => stopped ??= cleanupDeadline(Promise.resolve().then(stop)));
    },
    async acquire<Resource>(start: () => Promise<Resource>, stop: (resource: Resource) => Promise<void>) {
      check();
      const resource = await start();
      if (controller.signal.aborted) {
        await cleanupDeadline(Promise.resolve().then(() => stop(resource)));
        check();
      }
      owner.own(() => stop(resource));
      return resource;
    },
    spawn(command: string, args: string[], options: SpawnOptions) {
      check();
      if (process.platform === 'win32') throw new Error('Managed local process ownership requires POSIX');
      const io = Array.isArray(options.stdio) ? options.stdio.slice(0, 3)
        : Array(3).fill(options.stdio ?? 'pipe');
      const child = spawn(process.execPath, ['--eval', supervisorProgram],
        { ...options, detached: true, stdio: [...io, 'ipc'] });
      children.push(child);
      const state = { cleaned: false, forced: false, commandCode: null, commandSignal: null } as
        { cleaned: boolean; forced: boolean; commandCode: number | null; commandSignal: string | null };
      ownedProcessState.set(child, state);
      child.on('message', message => {
        const status = message as { type?: string; code?: number | null; signal?: string | null };
        if (status.type === 'cleaned') state.cleaned = true;
        if (status.type === 'forced') state.forced = true;
        if (status.type === 'command-exit') {
          state.commandCode = status.code ?? null;
          state.commandSignal = status.signal ?? null;
        }
      });
      child.once('error', () => { /* run/readiness reports only closed failure labels. */ });
      child.send({ type: 'start', command, args }, () => {});
      return child;
    },
    async run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
      check();
      const child = owner.spawn(command, args, { cwd, env: { ...env, CI: 'true',
        WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
      return new Promise((resolveOutput, reject) => {
        let output = '';
        child.stdout?.on('data', chunk => { output += String(chunk); });
        child.stderr?.on('data', chunk => { output += String(chunk); });
        const aborted = () => { void stopOwnedProcess(child).then(() =>
          reject(new Error('Local setup command cancelled or deadline exceeded')),
        () => reject(new Error('Local setup command cleanup failed'))); };
        signal.addEventListener('abort', aborted, { once: true });
        child.once('error', () => { signal.removeEventListener('abort', aborted);
          reject(new Error('Local setup command could not start')); });
        child.once('close', code => {
          signal.removeEventListener('abort', aborted);
          if (signal.aborted) reject(new Error('Local setup command cancelled or deadline exceeded'));
          else if (code === 0 && ownedProcessState.get(child)?.commandCode === 0) void stopOwnedProcess(child).then(() => resolveOutput(output),
            () => reject(new Error('Local setup command cleanup failed')));
          else reject(new Error('Local setup command failed'));
        });
        if (signal.aborted) aborted();
      });
    },
    stop(): Promise<void> {
      if (stopping) return stopping;
      controller.abort();
      clearInterval(heartbeat);
      owner.phase('cleanup');
      stopping = (async () => {
        let failures = (await Promise.allSettled(children.map(stopOwnedProcess)))
          .filter(result => result.status === 'rejected').length;
        for (const stop of [...cleanup].reverse()) {
          try { await stop(); } catch { failures++; }
        }
        if (failures) throw new Error(`Owned local cleanup incomplete; failures=${failures}`);
      })();
      return stopping;
    },
  };
  return owner;
}

export async function withLocalStackFixture(use: (owner: ReturnType<typeof createLocalStackOwner>) => Promise<void>) {
  const owner = createLocalStackOwner();
  let failure: unknown;
  let failed = false;
  try { await use(owner); } catch (error) { failure = error; failed = true; }
  try { await owner.stop(); } catch (error) {
    if (failed) throw new AggregateError([failure, error], 'Local fixture failed after owned cleanup');
    throw error;
  }
  if (failed) throw failure;
}

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

async function waitFor(origin: string, children: ChildProcess[], signal: AbortSignal): Promise<void> {
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    if (signal.aborted) throw new Error('Local readiness cancelled');
    if (children.some(child => child.exitCode !== null || child.signalCode !== null)) {
      throw new Error('A local Worker stopped before readiness');
    }
    try {
      const response = await fetch(origin, { signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]) });
      if (response.status < 500) return;
    } catch { /* Wait for the Worker to bind. */ }
    await new Promise(done => setTimeout(done, 150));
  }
  throw new Error(`Local Worker did not become ready at ${origin}`);
}

export async function startManagedLocalStack(options: { skipBuild?: boolean;
  owner?: ReturnType<typeof createLocalStackOwner> } = {}): Promise<{ stop(): Promise<void>;
  operatorOrigin: string; apiOrigin: string; storageState: string; directory: string; rootUserId: string }> {
  const runId: RunId = newRunId();
  options.owner?.check();
  const owner = createLocalStackOwner();
  const stop = () => owner.stop();
  options.owner?.own(stop);
  const children: ChildProcess[] = [];
  let ownedDirectory: string | undefined;
  let phase = 'setup';
  const stage = (value: typeof phases[number]) => { owner.check(); phase = value; owner.phase(value); };
  try {
    stage('setup');
    const directory = await owner.acquire(() => mkdtemp(join(tmpdir(), 'incentives-e2e-local-')),
      directory => rm(directory, { recursive: true, force: true }));
    ownedDirectory = directory;
    await chmod(directory, 0o700);
    owner.check();
    const ports = await localPorts();
    owner.check();
    const config = localStackConfiguration(repositoryRoot, directory, runId, ports);
    for (const app of workerNames) { owner.check(); await mkdir(join(directory, app), { mode: 0o700 }); }
    owner.check();
    const configPaths = Object.fromEntries(workerNames.map(app =>
      [app, join(directory, app, 'wrangler.json')])) as Record<typeof workerNames[number], string>;
    await Promise.all([
      writeFile(configPaths.core, JSON.stringify(config.coreConfig), { mode: 0o600, flag: 'wx' }),
      writeFile(configPaths.identity, JSON.stringify(config.identityConfig), { mode: 0o600, flag: 'wx' }),
      writeFile(configPaths.operator, JSON.stringify(config.operatorConfig), { mode: 0o600, flag: 'wx' }),
    ]);
    owner.check();
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
      stage('build');
      await owner.run('pnpm', ['--filter', '@incentives/api', 'build:dependencies'], repositoryRoot);
      await owner.run('pnpm', ['--filter', '@incentives/dashboard', 'build'], repositoryRoot);
    }
    stage('migrations');
    for (const [app, database] of [['core', 'incentives-dev'],
      ['identity', 'incentives-auth-local']] as const) {
      await owner.run(process.execPath, [wrangler(app === 'core' ? 'api' : app),
        'd1', 'migrations', 'apply', database, '--local', '--config', configPaths[app],
        '--persist-to', config.persistTo], repositoryRoot);
    }
    stage('root-bootstrap');
    const rootEmail = `root+${runId}@e2e.invalid`;
    const bootstrap = await owner.run(process.execPath,
      [join(repositoryRoot, 'apps/identity/src/cli/bootstrap-root-runner.mjs'),
        '--environment', 'local', '--email', rootEmail], repositoryRoot,
      { ...process.env, AUTH_SECRET: authSecret,
        E2E_LOCAL_WRANGLER_CONFIG: configPaths.identity,
        E2E_LOCAL_PERSIST_TO: config.persistTo });
    const expectedRoot = parseLocalRootBootstrapResult(bootstrap);
    stage('worker-readiness');
    for (const [app, port, inspector] of [
      ['core', ports.core, ports.coreInspector],
      ['identity', ports.identity, ports.identityInspector],
      ['operator', ports.operator, ports.operatorInspector],
    ] as const) {
      const log = await owner.acquire(() => open(join(directory, `${app}.log`), 'wx', 0o600),
        log => log.close());
      const workerApp = app === 'core' ? 'api' : app === 'operator' ? 'operator-web' : app;
      const child = owner.spawn(process.execPath,
        [wrangler(workerApp), 'dev', '--config', configPaths[app],
          '--port', String(port), '--inspector-port', String(inspector),
          '--persist-to', config.persistTo, '--log-level', 'error',
          '--show-interactive-dev-session=false'],
        { cwd: repositoryRoot, env: { ...process.env, CI: 'true',
          WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', log.fd, log.fd] });
      children.push(child);
    }
    await waitFor(config.operatorOrigin, children, owner.signal);
    stage('passkey-bootstrap');
    const storageState = await bootstrapLocalRootPasskey({ operatorOrigin: config.operatorOrigin,
      expectedRootUserId: expectedRoot.userId, activationGrant: expectedRoot.activationGrant,
      storageStatePath: join(directory, 'root-storage-state.json'),
      signal: AbortSignal.any([owner.signal, AbortSignal.timeout(45_000)]), owner });
    stage('ready');
    return { stop, operatorOrigin: config.operatorOrigin, apiOrigin: config.apiOrigin,
      storageState, directory, rootUserId: expectedRoot.userId };
  } catch {
    const diagnostic = (await Promise.all(workerNames.map(async app => {
      let output = '';
      try {
        if (ownedDirectory) output = await readFile(join(ownedDirectory, `${app}.log`), 'utf8');
      } catch { /* Unavailable private log still has a safe process-state summary. */ }
      const child = children[workerNames.indexOf(app)];
      const state = child && ownedProcessState.get(child);
      return `${app}: ${summarizeLocalWorkerFailure(output, state &&
        { exitCode: state.commandCode, signalCode: state.commandSignal })}`;
    }))).join('\n');
    let cleanupFailed = false;
    try { await stop(); } catch { cleanupFailed = true; }
    throw new Error(`Managed local stack startup failed during ${phase}${
      cleanupFailed ? '; owned cleanup incomplete' : ''}\n${diagnostic}`);
  }
}
