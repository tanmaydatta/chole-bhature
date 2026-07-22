import {
  deriveBootstrapGrant,
  randomBootstrapSecret,
  sha256Hex,
} from './bootstrap-cryptography.mjs';
import { buildBootstrapRootWranglerCommand as buildWranglerCommand } from './bootstrap-wrangler-command.mjs';

const ACTIVATION_TTL_MS = 10 * 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface BootstrapRootInput {
  database: D1Database;
  authSecret: string;
  email: string;
  correlationId: string;
  now?: () => number;
}

export interface BootstrapRootResult {
  userId: string;
  status: 'pending';
  activationGrant: string;
  expiresAt: number;
}

export interface BootstrapRootCommandDependencies {
  bootstrap(email: string, correlationId: string): Promise<BootstrapRootResult>;
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export type BootstrapEnvironment = 'local' | 'staging';

export interface BootstrapWranglerCommand {
  command: string;
  arguments: string[];
}

export function buildBootstrapRootWranglerCommand(input: {
  environment: BootstrapEnvironment;
  sqlFile: string;
}): BootstrapWranglerCommand {
  return buildWranglerCommand(input);
}

interface RootState {
  userId: string;
  email: string;
  status: 'pending' | 'active';
}

interface BootstrapFlow {
  id: string;
  initiatingCodeHash: string;
  expiresAt: number;
  sessionId: string | null;
  sessionExpiresAt: number | null;
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error('A valid root email is required');
  return email;
}

async function liveRoot(database: D1Database): Promise<RootState | null> {
  return database.prepare(`
    SELECT user.id AS userId, lower(user.email) AS email, auth_profile.status
    FROM auth_profile INNER JOIN user ON user.id = auth_profile.user_id
    WHERE auth_profile.subject_kind = 'root'
      AND auth_profile.status IN ('pending', 'active')
    LIMIT 1
  `).first<RootState>();
}

async function bootstrapFlow(
  database: D1Database,
  userId: string,
): Promise<BootstrapFlow | null> {
  return database.prepare(`
    SELECT recovery_flow.id,
      recovery_flow.initiating_code_hash AS initiatingCodeHash,
      recovery_flow.expires_at AS expiresAt,
      recovery_flow.session_id AS sessionId,
      session.expiresAt AS sessionExpiresAt
    FROM recovery_flow
    LEFT JOIN session ON session.id = recovery_flow.session_id
    WHERE recovery_flow.user_id = ?1 AND recovery_flow.purpose = 'bootstrap'
      AND recovery_flow.completed_at IS NULL AND recovery_flow.cancelled_at IS NULL
    ORDER BY recovery_flow.rowid DESC LIMIT 1
  `).bind(userId).first<BootstrapFlow>();
}

async function resultFor(
  authSecret: string,
  userId: string,
  flow: BootstrapFlow,
): Promise<BootstrapRootResult> {
  return {
    userId,
    status: 'pending',
    activationGrant: await deriveBootstrapGrant(
      authSecret,
      flow.id,
      flow.initiatingCodeHash,
    ),
    expiresAt: flow.expiresAt,
  };
}

async function issueBootstrapFlow(
  input: BootstrapRootInput,
  userId: string,
  now: number,
  options: { newRootEmail?: string; expiredFlowId?: string } = {},
): Promise<BootstrapRootResult> {
  const flowId = crypto.randomUUID();
  const initiatingCodeHash = await sha256Hex(randomBootstrapSecret());
  const grant = await deriveBootstrapGrant(input.authSecret, flowId, initiatingCodeHash);
  const grantHash = await sha256Hex(grant);
  const expiresAt = now + ACTIVATION_TTL_MS;
  const statements: D1PreparedStatement[] = [];
  if (options.newRootEmail) {
    statements.push(
      input.database.prepare(`
        INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?1, 'Platform Root', ?2, 1, ?3, ?3)
      `).bind(userId, options.newRootEmail, now),
      input.database.prepare(`
        INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
        VALUES (?1, 'root', 'pending', 0)
      `).bind(userId),
    );
  }
  if (options.expiredFlowId) {
    statements.push(input.database.prepare(`
      UPDATE recovery_flow SET cancelled_at = ?1, cancel_reason = 'expired'
      WHERE id = ?2 AND completed_at IS NULL AND cancelled_at IS NULL
    `).bind(now, options.expiredFlowId));
  }
  statements.push(
    input.database.prepare(`
      DELETE FROM passkey WHERE id IN (
        SELECT replacement_passkey_id FROM recovery_flow
        WHERE user_id = ?1 AND purpose = 'bootstrap' AND completed_at IS NULL
          AND cancelled_at IS NOT NULL
      )
    `).bind(userId),
    input.database.prepare(`
      DELETE FROM session WHERE id IN (
        SELECT session_id FROM recovery_flow
        WHERE user_id = ?1 AND purpose = 'bootstrap' AND completed_at IS NULL
          AND cancelled_at IS NOT NULL
      )
    `).bind(userId),
    input.database.prepare(`
      INSERT INTO recovery_flow (
        id, user_id, grant_hash, initiating_code_hash, created_at, expires_at, purpose
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'bootstrap')
    `).bind(flowId, userId, grantHash, initiatingCodeHash, now, expiresAt),
    input.database.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, 'system', 'operations', 'root.bootstrap',
        'user', ?3, 'succeeded', ?4, NULL)
    `).bind(crypto.randomUUID(), now, userId, input.correlationId),
  );
  await input.database.batch(statements);
  return { userId, status: 'pending', activationGrant: grant, expiresAt };
}

export async function bootstrapRoot(input: BootstrapRootInput): Promise<BootstrapRootResult> {
  const email = normalizedEmail(input.email);
  if (input.authSecret.length < 32) throw new Error('Auth secret is invalid');
  if (!input.correlationId.trim()) throw new Error('Correlation id is required');
  const now = (input.now ?? Date.now)();
  let root = await liveRoot(input.database);
  if (root?.status === 'active' || (root && root.email !== email)) {
    throw new Error('A live root already exists');
  }

  if (!root) {
    const userId = crypto.randomUUID();
    try {
      return await issueBootstrapFlow(input, userId, now, { newRootEmail: email });
    } catch {
      root = await liveRoot(input.database);
      if (!root || root.status !== 'pending' || root.email !== email) {
        throw new Error('A live root already exists');
      }
    }
  }

  const existing = await bootstrapFlow(input.database, root.userId);
  if (existing) {
    const flowIsUsable = existing.expiresAt > now
      || Boolean(existing.sessionId && (existing.sessionExpiresAt ?? 0) > now);
    if (flowIsUsable) return resultFor(input.authSecret, root.userId, existing);
  }
  try {
    return await issueBootstrapFlow(
      input,
      root.userId,
      now,
      existing ? { expiredFlowId: existing.id } : {},
    );
  } catch {
    const raced = await bootstrapFlow(input.database, root.userId);
    if (
      raced
      && (raced.expiresAt > now || Boolean(raced.sessionId && (raced.sessionExpiresAt ?? 0) > now))
    ) return resultFor(input.authSecret, root.userId, raced);
    throw new Error('Root activation could not be issued');
  }
}

export async function runBootstrapRootCommand(
  arguments_: string[],
  dependencies: BootstrapRootCommandDependencies,
): Promise<number> {
  if (
    arguments_.length !== 4
    || arguments_[0] !== '--environment'
    || !['local', 'staging'].includes(arguments_[1] ?? '')
    || arguments_[2] !== '--email'
    || !arguments_[3]
  ) {
    dependencies.writeError(
      'Usage: bootstrap-root --environment <local|staging> --email <root-email>',
    );
    return 2;
  }
  try {
    const correlationId = crypto.randomUUID();
    const result = await dependencies.bootstrap(arguments_[3], correlationId);
    dependencies.writeOutput(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    dependencies.writeError('Root bootstrap failed. Inspect the correlation audit for details.');
    return 1;
  }
}
