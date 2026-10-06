import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { buildBootstrapRootWranglerCommand } from './bootstrap-wrangler-command.mjs';
import { bootstrapRootCore, renderBootstrapSql } from './bootstrap-root-core.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function parseArguments(arguments_) {
  if (
    arguments_.length !== 4
    || arguments_[0] !== '--environment'
    || !['local', 'staging'].includes(arguments_[1])
    || arguments_[2] !== '--email'
  ) throw new Error('usage');
  const email = (arguments_[3] ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error('usage');
  return { environment: arguments_[1], email };
}

function wranglerArguments(environment, tail) {
  const localConfig = process.env.E2E_LOCAL_WRANGLER_CONFIG;
  const localPersistTo = process.env.E2E_LOCAL_PERSIST_TO;
  if (Boolean(localConfig) !== Boolean(localPersistTo)) throw new Error('local override');
  if ((localConfig || localPersistTo) && environment !== 'local') throw new Error('local only');
  const target = environment === 'local'
    ? ['incentives-auth-local', '--local', ...(localConfig
      ? ['--config', localConfig, '--persist-to', localPersistTo] : [])]
    : ['incentives-auth-staging', '--env', 'staging', '--remote'];
  return ['exec', 'wrangler', 'd1', 'execute', ...target, ...tail, '--json'];
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env };
    delete childEnvironment.AUTH_SECRET;
    const child = spawn(command, arguments_, {
      cwd: new URL('../..', import.meta.url),
      env: childEnvironment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(Buffer.concat(output).toString('utf8'));
      else reject(new Error('wrangler failed'));
    });
  });
}

function resultRows(output) {
  const parsed = JSON.parse(output);
  const commands = Array.isArray(parsed) ? parsed : [parsed];
  for (const command of commands) {
    const results = command?.results ?? command?.result?.[0]?.results;
    if (Array.isArray(results)) return results;
  }
  return [];
}

async function query(environment, sql) {
  return resultRows(await run('pnpm', wranglerArguments(environment, ['--command', sql])));
}

async function executeFile(environment, sql) {
  const directory = await mkdtemp(join(tmpdir(), 'incentives-root-bootstrap-'));
  const sqlFile = join(directory, 'bootstrap.sql');
  try {
    await writeFile(sqlFile, sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const command = buildBootstrapRootWranglerCommand({ environment, sqlFile,
      localConfig: process.env.E2E_LOCAL_WRANGLER_CONFIG,
      localPersistTo: process.env.E2E_LOCAL_PERSIST_TO });
    await run(command.command, command.arguments);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const { environment, email } = parseArguments(process.argv.slice(2));
  return bootstrapRootCore({
    authSecret: process.env.AUTH_SECRET ?? '', email, correlationId: randomUUID(),
    database: {
      first: async (sql, params = []) => (await query(environment, renderBootstrapSql({ sql, params })))[0] ?? null,
      batch: statements => executeFile(environment, statements.map(renderBootstrapSql).join(';\n') + ';'),
    },
  });
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    'Root bootstrap failed. Verify local/staging configuration and inspect the audit correlation.\n',
  );
  process.exitCode = 1;
}
