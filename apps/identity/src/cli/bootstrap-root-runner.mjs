import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { buildBootstrapRootWranglerCommand } from './bootstrap-wrangler-command.mjs';
import {
  deriveBootstrapGrant,
  randomBootstrapSecret,
  sha256Hex,
} from './bootstrap-cryptography.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TTL_MS = 10 * 60_000;

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
  const target = environment === 'local'
    ? ['incentives-auth-local', '--local']
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

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
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
    const command = buildBootstrapRootWranglerCommand({ environment, sqlFile });
    await run(command.command, command.arguments);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const { environment, email } = parseArguments(process.argv.slice(2));
  const authSecret = process.env.AUTH_SECRET ?? '';
  if (authSecret.length < 32) throw new Error('secret');
  const now = Date.now();
  const correlationId = randomUUID();
  const roots = await query(environment, `
    SELECT user.id AS userId, lower(user.email) AS email, auth_profile.status
    FROM auth_profile INNER JOIN user ON user.id = auth_profile.user_id
    WHERE auth_profile.subject_kind = 'root'
      AND auth_profile.status IN ('pending', 'active') LIMIT 1
  `);
  const root = roots[0];
  if (root && (root.status === 'active' || root.email !== email)) throw new Error('root exists');

  let userId = root?.userId;
  if (userId) {
    const flows = await query(environment, `
      SELECT recovery_flow.id, recovery_flow.initiating_code_hash AS initiatingCodeHash,
        recovery_flow.expires_at AS expiresAt, recovery_flow.session_id AS sessionId,
        session.expiresAt AS sessionExpiresAt
      FROM recovery_flow LEFT JOIN session ON session.id = recovery_flow.session_id
      WHERE recovery_flow.user_id = ${sqlString(userId)}
        AND recovery_flow.purpose = 'bootstrap'
        AND recovery_flow.completed_at IS NULL AND recovery_flow.cancelled_at IS NULL
      ORDER BY recovery_flow.rowid DESC LIMIT 1
    `);
    const flow = flows[0];
    if (
      flow
      && (Number(flow.expiresAt) > now
        || (flow.sessionId && Number(flow.sessionExpiresAt) > now))
    ) {
      return {
        userId,
        status: 'pending',
        activationGrant: await deriveBootstrapGrant(
          authSecret,
          flow.id,
          flow.initiatingCodeHash,
        ),
        expiresAt: Number(flow.expiresAt),
      };
    }
  } else {
    userId = randomUUID();
  }

  const flowId = randomUUID();
  const initiatingCodeHash = await sha256Hex(randomBootstrapSecret());
  const activationGrant = await deriveBootstrapGrant(authSecret, flowId, initiatingCodeHash);
  const grantHash = await sha256Hex(activationGrant);
  const expiresAt = now + TTL_MS;
  const createRootSql = root ? '' : `
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlString(userId)}, 'Platform Root', ${sqlString(email)}, 1, ${now}, ${now});
    INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES (${sqlString(userId)}, 'root', 'pending', 0);
  `;
  await executeFile(environment, `${createRootSql}
    UPDATE recovery_flow SET cancelled_at = ${now}, cancel_reason = 'expired'
      WHERE user_id = ${sqlString(userId)} AND purpose = 'bootstrap'
        AND completed_at IS NULL AND cancelled_at IS NULL;
    DELETE FROM passkey WHERE id IN (
      SELECT replacement_passkey_id FROM recovery_flow
      WHERE user_id = ${sqlString(userId)} AND purpose = 'bootstrap'
        AND completed_at IS NULL AND cancelled_at IS NOT NULL
    );
    DELETE FROM session WHERE id IN (
      SELECT session_id FROM recovery_flow
      WHERE user_id = ${sqlString(userId)} AND purpose = 'bootstrap'
        AND completed_at IS NULL AND cancelled_at IS NOT NULL
    );
    INSERT INTO recovery_flow (
      id, user_id, grant_hash, initiating_code_hash, created_at, expires_at, purpose
    ) VALUES (
      ${sqlString(flowId)}, ${sqlString(userId)}, ${sqlString(grantHash)},
      ${sqlString(initiatingCodeHash)}, ${now}, ${expiresAt}, 'bootstrap'
    );
    INSERT INTO identity_audit (
      id, occurred_at, actor_kind, actor_id, action, target_type,
      target_id, outcome, correlation_id, metadata_json
    ) VALUES (
      ${sqlString(randomUUID())}, ${now}, 'system', 'operations', 'root.bootstrap',
      'user', ${sqlString(userId)}, 'succeeded', ${sqlString(correlationId)}, NULL
    );
  `);
  return { userId, status: 'pending', activationGrant, expiresAt };
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
