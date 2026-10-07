import { deriveBootstrapGrant, randomBootstrapSecret, sha256Hex } from './bootstrap-cryptography.mjs';

const TTL_MS = 600_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// Only bootstrap-owned statements reach this renderer. Values never become SQL syntax.
export function renderBootstrapSql({ sql, params = [] }) {
  return sql.replace(/\?(\d+)/gu, (_, index) => {
    const value = params[Number(index) - 1];
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (value === null) return 'NULL';
    throw new Error('Invalid bootstrap SQL parameter');
  });
}

export function validateBootstrapInput(input) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email) || [...email].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('A valid root email is required');
  if (typeof input.authSecret !== 'string' || input.authSecret.trim().length < 32) throw new Error('Auth secret is invalid');
  if (typeof input.correlationId !== 'string' || !input.correlationId.trim()) throw new Error('Correlation id is required');
  const now = (input.now ?? Date.now)();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + TTL_MS)) throw new Error('Bootstrap clock is invalid');
  return { email, now };
}

async function liveRoot(database) {
  return database.first(`
    SELECT user.id AS userId, lower(user.email) AS email, auth_profile.status
    FROM auth_profile INNER JOIN user ON user.id = auth_profile.user_id
    WHERE auth_profile.subject_kind = 'root' AND auth_profile.status IN ('pending', 'active') LIMIT 1
  `);
}

async function bootstrapFlow(database, userId) {
  return database.first(`
    SELECT recovery_flow.id, recovery_flow.initiating_code_hash AS initiatingCodeHash,
      recovery_flow.expires_at AS expiresAt, recovery_flow.session_id AS sessionId,
      session.expiresAt AS sessionExpiresAt
    FROM recovery_flow LEFT JOIN session ON session.id = recovery_flow.session_id
    WHERE recovery_flow.user_id = ?1 AND recovery_flow.purpose = 'bootstrap'
      AND recovery_flow.completed_at IS NULL AND recovery_flow.cancelled_at IS NULL
    ORDER BY recovery_flow.rowid DESC LIMIT 1
  `, [userId]);
}

function usable(flow, now) {
  return flow && (flow.expiresAt > now || Boolean(flow.sessionId && (flow.sessionExpiresAt ?? 0) > now));
}

async function resultFor(authSecret, userId, flow) {
  return { userId, status: 'pending', activationGrant: await deriveBootstrapGrant(authSecret, flow.id, flow.initiatingCodeHash), expiresAt: flow.expiresAt };
}

async function issue(input, userId, now, options = {}) {
  const flowId = crypto.randomUUID();
  const initiatingCodeHash = await sha256Hex(randomBootstrapSecret());
  const activationGrant = await deriveBootstrapGrant(input.authSecret, flowId, initiatingCodeHash);
  const grantHash = await sha256Hex(activationGrant);
  const expiresAt = now + TTL_MS;
  const statements = [];
  const add = (sql, params) => statements.push({ sql, params });
  if (options.newRootEmail) {
    add(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?1, 'Platform Root', ?2, 1, ?3, ?3)`, [userId, options.newRootEmail, now]);
    add(`INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES (?1, 'root', 'pending', 0)`, [userId]);
  }
  if (options.expiredFlowId) add(`UPDATE recovery_flow SET cancelled_at = ?1, cancel_reason = 'expired'
    WHERE id = ?2 AND completed_at IS NULL AND cancelled_at IS NULL`, [now, options.expiredFlowId]);
  add(`DELETE FROM passkey WHERE id IN (SELECT replacement_passkey_id FROM recovery_flow
    WHERE user_id = ?1 AND purpose = 'bootstrap' AND completed_at IS NULL AND cancelled_at IS NOT NULL)`, [userId]);
  add(`DELETE FROM session WHERE id IN (SELECT session_id FROM recovery_flow
    WHERE user_id = ?1 AND purpose = 'bootstrap' AND completed_at IS NULL AND cancelled_at IS NOT NULL)`, [userId]);
  add(`INSERT INTO recovery_flow (id, user_id, grant_hash, initiating_code_hash, created_at, expires_at, purpose)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'bootstrap')`, [flowId, userId, grantHash, initiatingCodeHash, now, expiresAt]);
  add(`INSERT INTO identity_audit (id, occurred_at, actor_kind, actor_id, action, target_type,
    target_id, outcome, correlation_id, metadata_json) VALUES (?1, ?2, 'system', 'operations', 'root.bootstrap',
    'user', ?3, 'succeeded', ?4, NULL)`, [crypto.randomUUID(), now, userId, input.correlationId]);
  // Adapter contract: all statements commit together, including the mandatory audit.
  await input.database.batch(statements);
  return { userId, status: 'pending', activationGrant, expiresAt };
}

export async function bootstrapRootCore(input) {
  const { email, now } = validateBootstrapInput(input);
  let root = await liveRoot(input.database);
  if (root?.status === 'active' || root && root.email !== email) throw new Error('A live root already exists');
  if (!root) {
    try { return await issue(input, crypto.randomUUID(), now, { newRootEmail: email }); }
    catch {
      root = await liveRoot(input.database);
      if (!root || root.status !== 'pending' || root.email !== email) throw new Error('A live root already exists');
    }
  }
  const existing = await bootstrapFlow(input.database, root.userId);
  if (usable(existing, now)) return resultFor(input.authSecret, root.userId, existing);
  try { return await issue(input, root.userId, now, existing ? { expiredFlowId: existing.id } : {}); }
  catch {
    const raced = await bootstrapFlow(input.database, root.userId);
    if (usable(raced, now)) return resultFor(input.authSecret, root.userId, raced);
    throw new Error('Root activation could not be issued');
  }
}
