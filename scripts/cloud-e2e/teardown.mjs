import { createCloudflareClient } from './cloudflare.mjs';
import { checkpoint, validateInventory } from './inventory.mjs';
import { parseStackKey } from './key.mjs';

const sessions = new WeakMap();

function runId(key) { return JSON.stringify(parseStackKey(key)); }

export function registerMockSession(session) {
  let runs = sessions.get(session.store);
  if (!runs) { runs = new Map(); sessions.set(session.store, runs); }
  const id = runId(session.key);
  if (runs.has(id)) throw new TypeError('Run already has a local mock controller session.');
  const value = { ...session, phase: 'provisioning', receipts: {}, pending: new Set(), cleanupPromise: null, cleanupResult: null };
  runs.set(id, value);
  return value;
}

function remaining(inventory) {
  return [
    ...Object.keys(inventory.betaWorkerIds ?? {}).map(role => `beta-worker:${role}`),
    ...Object.keys(inventory.cloudflare.accessAppIds).map(role => `access-app:${role}`),
    ...(inventory.cloudflare.tokenId ? ['service-token'] : []),
    ...Object.keys(inventory.cloudflare.d1Ids).map(role => `d1:${role}`),
  ];
}

function client(session) {
  return createCloudflareClient({ accountId: session.accountId, inventory: session.inventory, transport: { request: request => session.provider.request(request) }, store: session.store, now: session.now });
}

async function cleanup(session) {
  const removed = [];
  const failures = [];
  const workerPresent = Object.keys(session.inventory.betaWorkerIds ?? {}).length > 0 || session.pending.size > 0;
  // A local receipt cannot prove that an Operator service graph or alternate
  // URL remains safe after Access removal. Preserve the entire dependency tree.
  if (workerPresent) return { status: 'unsupported', reason: 'worker-graph-unresolved', removed, remaining: [...session.pending].map(value => `ambiguous:${value}`).concat(remaining(session.inventory)) };
  for (const role of ['auth', 'product']) {
    const id = session.inventory.cloudflare.d1Ids[role];
    if (!id) continue;
    try {
      const guarded = client(session);
      const result = await guarded.deleteD1(role);
      if (result.status === 'deleted') {
        const readback = await guarded.getD1(id);
        if (!readback.missing) throw new TypeError('D1 deletion has no observed absence.');
      }
      if (result.status !== 'deleted' && result.status !== 'missing') throw new TypeError('D1 deletion is unresolved.');
      removed.push(`d1:${role}`);
      const next = validateInventory({ ...session.inventory, cloudflare: { ...session.inventory.cloudflare, d1Ids: Object.fromEntries(Object.entries(session.inventory.cloudflare.d1Ids).filter(([entry]) => entry !== role)) }, updatedAt: session.now() });
      await checkpoint(next, session.store);
      session.inventory = next;
    } catch {
      failures.push(`d1:${role}`);
      break;
    }
  }
  const left = remaining(session.inventory);
  if (failures.length) return { status: 'failed', reason: 'mock-cleanup-failed', removed, remaining: left, failed: failures };
  return { status: 'local-cleanup-observed', complete: false, removed, remaining: left };
}

export async function cleanupMockSession(session) {
  session.phase = 'closing';
  if (session.cleanupResult) return session.cleanupResult;
  if (session.cleanupPromise) return session.cleanupPromise;
  session.cleanupPromise = cleanup(session).catch(() => ({ status: 'failed', reason: 'mock-cleanup-failed', remaining: remaining(session.inventory) }));
  session.cleanupResult = await session.cleanupPromise;
  session.phase = 'closed';
  return session.cleanupResult;
}

export async function teardownMockStack({ key, accountId, store }) {
  let id;
  try { id = runId(key); } catch { return { status: 'refused', reason: 'invalid-run-key' }; }
  const session = sessions.get(store)?.get(id);
  if (!session || session.accountId !== accountId) return { status: 'refused', reason: 'unproven-run-or-account' };
  if (session.phase === 'provisioning') return { status: 'refused', reason: 'run-in-progress' };
  return cleanupMockSession(session);
}
