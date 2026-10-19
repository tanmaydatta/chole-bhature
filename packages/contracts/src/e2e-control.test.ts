import { describe, expect, test } from 'vitest';
import type { z } from './zod.js';
import * as control from './e2e-control.js';
import * as contracts from './index.js';

const envelope = {
  protocol: 'incentives-e2e-control', version: 2,
  generation: 'a'.repeat(40), targetId: 'b'.repeat(64),
  requestId: '11111111-1111-4111-8111-111111111111',
};
const runId = 'e2e_0123456789abcdef01234567';
const proof = 'A'.repeat(43);
const controllerToken = `${'B'.repeat(42)}A`;
const lease = {
  runId, merchantId: '22222222-2222-4222-8222-222222222222',
  provisioningId: '33333333-3333-4333-8333-333333333333',
  generation: envelope.generation, targetId: envelope.targetId,
  issuedAt: 1_800_000_000_000, expiresAt: 1_800_000_900_000, phase: 'reserved',
};
const stored = {
  ...lease, proofHash: 'c'.repeat(64), controllerHash: 'd'.repeat(64),
  requestId: envelope.requestId, payloadHash: 'e'.repeat(64), accountQuota: 3,
};
const cleanup = {
  id: '44444444-4444-4444-8444-444444444444', runId,
  proofHash: 'c'.repeat(64), currentGeneration: envelope.generation,
  issuedAt: 1_800_001_000_000, expiresAt: 1_800_001_300_000,
};
const bootstrap = { operation: 'bootstrap', envelope, runId, proof, controllerToken, name: 'Synthetic shop' };
const action = { envelope, runId, proof, operation: 'status' };
const query = { evaluationId: 'evaluation', idempotencyKey: 'idempotency', programRefs: ['promo'] };
const runtime = { environment: 'local', generation: envelope.generation, targetId: envelope.targetId };
const capabilities = {
  protocol: 'incentives-e2e-control', version: 2, runtime,
  operator: 2, identity: 2, product: 2,
  migrations: { auth: ['auth.sql'], product: ['product.sql'] }, fencing: true, recovery: true,
};
const view = { lease, auth: { sessions: 0 }, product: { merchants: 1 } };
const account = {
  runId, merchantId: lease.merchantId, organizationId: 'organization', userId: 'user',
  membershipId: 'membership', email: 'member@example.test', role: 'admin',
  sessionId: 'better-auth-opaque-session', cookieHeader: 'member=test-only',
  cookieAttributes: { name: 'session', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expiresAt: lease.expiresAt },
};
const error = { error: { code: 'UNAUTHORIZED', correlationId: envelope.requestId, retryable: false } };

function accepts(schema: z.ZodType, value: unknown) {
  return schema.safeParse(value).success;
}

describe('isolated control wire contract', () => {
  test.each([
    ['runtime', control.E2eControlRuntimeSchema, { ...runtime, enabled: true, accountQuota: 3, cleanupGenerations: [] }],
    ['envelope', control.E2eControlEnvelopeSchema, envelope],
    ['lease', control.E2eControlLeaseSchema, lease],
    ['stored lease', control.StoredControlLeaseSchema, stored],
    ['bootstrap', control.E2eControlBootstrapSchema, bootstrap],
    ['action', control.E2eControlActionSchema, action],
    ['capabilities', control.E2eControlCapabilitiesSchema, capabilities],
    ['run view', control.E2eControlRunViewSchema, view],
    ['account', control.E2eControlAccountSchema, account],
    ['bootstrap result', control.E2eControlBootstrapResultSchema, { lease, admin: account }],
    ['Identity call', control.IdentityControlCallSchema, { authorization: { kind: 'setup', value: 'test-only-setup' }, input: bootstrap }],
    ['Core call', control.CoreControlCallSchema, { envelope, operation: 'reserve', reservation: stored }],
    ['Core reply', control.CoreControlReplySchema, { lease, product: { merchants: 1 } }],
    ['cleanup', control.CleanupInvocationSchema, cleanup],
    ['error', control.E2eControlErrorSchema, error],
    ['reply', control.E2eControlReplySchema, view],
  ])('%s accepts its documented shape without changing input', (_name, schema, value) => {
    expect(schema.parse(value)).toEqual(value);
  });

  test.each([
    ['runtime', control.E2eControlRuntimeSchema, { ...runtime, enabled: true, accountQuota: 3, cleanupGenerations: [] }],
    ['envelope', control.E2eControlEnvelopeSchema, envelope],
    ['lease', control.E2eControlLeaseSchema, lease],
    ['stored lease', control.StoredControlLeaseSchema, stored],
    ['bootstrap', control.E2eControlBootstrapSchema, bootstrap],
    ['action', control.E2eControlActionSchema, action],
    ['capabilities', control.E2eControlCapabilitiesSchema, capabilities],
    ['view', control.E2eControlRunViewSchema, view],
    ['account', control.E2eControlAccountSchema, account],
    ['bootstrap result', control.E2eControlBootstrapResultSchema, { lease, admin: account }],
    ['Identity call', control.IdentityControlCallSchema, { authorization: { kind: 'setup', value: 'test-only-setup' }, input: bootstrap }],
    ['Core call', control.CoreControlCallSchema, { envelope, operation: 'reserve', reservation: stored }],
    ['Core reply', control.CoreControlReplySchema, { lease, product: {} }],
    ['cleanup', control.CleanupInvocationSchema, cleanup],
    ['error', control.E2eControlErrorSchema, error],
    ['reply', control.E2eControlReplySchema, view],
  ])('%s rejects an extra wire key', (_name, schema, value) => {
    expect(accepts(schema, { ...value, unexpected: true })).toBe(false);
  });

  test('rejects protocol v1 independently of the release generation', () => {
    expect(accepts(control.E2eControlEnvelopeSchema, { ...envelope, version: 1 })).toBe(false);
    expect(accepts(control.E2eControlEnvelopeSchema, { ...envelope, protocol: 'incentives-e2e' })).toBe(false);
  });

  test.each([
    ['generation', 'A'.repeat(40)], ['generation', 'a'.repeat(39)],
    ['generation', ` ${'a'.repeat(40)}`], ['targetId', 'b'.repeat(63)],
    ['targetId', 'B'.repeat(64)], ['requestId', 'not-a-uuid'],
  ])('rejects invalid %s without normalization (%s)', (field, value) => {
    expect(accepts(control.E2eControlEnvelopeSchema, { ...envelope, [field]: value })).toBe(false);
  });

  test.each(['production', 'cloud-ci', 'unknown', 'LOCAL'])('refuses runtime environment %s', environment => {
    expect(accepts(control.E2eControlRuntimeSchema, { ...runtime, environment, enabled: true, accountQuota: 3, cleanupGenerations: [] })).toBe(false);
  });

  test('defaults only the deployment account quota to three', () => {
    expect(control.E2eControlRuntimeSchema.parse({ ...runtime, enabled: true, cleanupGenerations: [] })).toEqual({ ...runtime, enabled: true, accountQuota: 3, cleanupGenerations: [] });
  });

  test.each([0, 33, 1.5, '3'])('rejects invalid account quota %s', accountQuota => {
    expect(accepts(control.E2eControlRuntimeSchema, { ...runtime, enabled: true, accountQuota, cleanupGenerations: [] })).toBe(false);
    expect(accepts(control.StoredControlLeaseSchema, { ...stored, accountQuota })).toBe(false);
  });

  test.each([1, 32])('accepts quota boundary %s', accountQuota => {
    expect(accepts(control.E2eControlRuntimeSchema, { ...runtime, enabled: false, accountQuota, cleanupGenerations: [] })).toBe(true);
  });

  test('validates each compatible cleanup generation', () => {
    expect(accepts(control.E2eControlRuntimeSchema, { ...runtime, enabled: true, cleanupGenerations: ['bad'] })).toBe(false);
  });
});

describe('bootstrap and lease limits', () => {
  test.each(['proof', 'controllerToken'])('validates %s independently', field => {
    for (const value of ['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}B`, ` ${'A'.repeat(42)}`]) {
      expect(accepts(control.E2eControlBootstrapSchema, { ...bootstrap, [field]: value })).toBe(false);
    }
  });

  test('refuses a shared proof and controller token', () => {
    expect(accepts(control.E2eControlBootstrapSchema, { ...bootstrap, controllerToken: proof })).toBe(false);
  });

  test('accepts a 120-character bootstrap name and refuses overflow or empty', () => {
    expect(accepts(control.E2eControlBootstrapSchema, { ...bootstrap, name: 'n'.repeat(120) })).toBe(true);
    expect(accepts(control.E2eControlBootstrapSchema, { ...bootstrap, name: 'n'.repeat(121) })).toBe(false);
    expect(accepts(control.E2eControlBootstrapSchema, { ...bootstrap, name: '' })).toBe(false);
  });

  test.each(['merchantId', 'organizationId', 'provisioningId', 'ownerId', 'tenantId'])('bootstrap refuses caller-provided %s', field => {
    expect(accepts(control.E2eControlBootstrapSchema, { ...bootstrap, [field]: lease.merchantId })).toBe(false);
  });

  test.each(['reserved', 'product-provisioned', 'auth-provisioned', 'active', 'fencing', 'disposing', 'disposed', 'quarantined'])('accepts lease phase %s', phase => {
    expect(accepts(control.E2eControlLeaseSchema, { ...lease, phase })).toBe(true);
  });

  test.each([
    ['runId', 'manual'], ['merchantId', 'merchant'], ['provisioningId', 'provisioning'],
    ['organizationId', 'organization'], ['phase', 'renewed'], ['issuedAt', -1],
    ['issuedAt', 1.5], ['expiresAt', 1_800_000_899_999], ['expiresAt', 1_800_000_900_001],
  ])('refuses malformed lease %s (%s)', (field, value) => {
    expect(accepts(control.E2eControlLeaseSchema, { ...lease, [field]: value })).toBe(false);
  });

  test.each(['proofHash', 'controllerHash', 'payloadHash'])('validates stored %s', field => {
    expect(accepts(control.StoredControlLeaseSchema, { ...stored, [field]: 'not-a-hash' })).toBe(false);
  });

  test.each([
    ['id', 'not-a-uuid'], ['runId', 'manual'], ['proofHash', 'bad'], ['currentGeneration', 'bad'],
    ['issuedAt', -1], ['expiresAt', 1_800_001_299_999], ['expiresAt', 1_800_001_300_001],
  ])('refuses invalid cleanup %s (%s)', (field, value) => {
    expect(accepts(control.CleanupInvocationSchema, { ...cleanup, [field]: value })).toBe(false);
  });
});

describe('discriminated actions and binding calls', () => {
  test.each(['status', 'cancel', 'dispose'])('accepts exact %s action', operation => {
    expect(accepts(control.E2eControlActionSchema, { ...action, operation })).toBe(true);
  });

  test.each(['admin', 'operator', 'viewer'])('accepts account role %s without a per-role uniqueness rule', role => {
    expect(accepts(control.E2eControlActionSchema, { ...action, operation: 'account', slug: 'member_2', role })).toBe(true);
  });

  test.each([
    { ...action, operation: 'account', role: 'admin' },
    { ...action, operation: 'account', slug: 'member' },
    { ...action, operation: 'account', slug: 'Upper', role: 'admin' },
    { ...action, operation: 'account', slug: 'a'.repeat(41), role: 'admin' },
    { ...action, operation: 'account', slug: 'member', role: 'root' },
    { ...action, operation: 'status', slug: 'member' },
    { ...action, operation: 'inspect' },
    { ...action, operation: 'bootstrap' },
    { ...action, proof: 'bad' },
    { ...action, operation: undefined },
  ])('refuses missing or inappropriate operation fields %#', input => {
    expect(accepts(control.E2eControlActionSchema, input)).toBe(false);
  });

  test.each([1, 4])('inspection preserves %s program reference boundary', count => {
    expect(accepts(control.E2eControlActionSchema, { ...action, operation: 'inspect', ...query, programRefs: Array(count).fill('promo') })).toBe(true);
  });

  test.each([0, 5])('inspection rejects %s program references', count => {
    expect(accepts(control.E2eControlActionSchema, { ...action, operation: 'inspect', ...query, programRefs: Array(count).fill('promo') })).toBe(false);
  });

  test.each([
    { authorization: { kind: 'setup', value: 'test-only', cookieHeader: 'forbidden' }, input: bootstrap },
    { authorization: { kind: 'root', value: 'test-only' }, input: bootstrap },
    { authorization: { kind: 'controller', value: 'bad' }, input: action },
    { authorization: { kind: 'setup', value: '' }, input: bootstrap },
    { authorization: { kind: 'setup', value: 'test-only' }, input: { ...bootstrap, envelope: { ...envelope, extra: true } } },
    { authorization: { kind: 'setup', value: 'test-only' }, input: { envelope } },
  ])('Identity rejects malformed nested authorization/input %#', call => {
    expect(accepts(control.IdentityControlCallSchema, call)).toBe(false);
  });

  test('Identity supports the read-only capability discriminator', () => {
    expect(accepts(control.IdentityControlCallSchema, { authorization: { kind: 'setup', value: 'test-only' }, input: { operation: 'capabilities', envelope } })).toBe(true);
  });

  test.each(['reserve', 'provision', 'activate', 'status', 'fence'])('Core %s requires the complete stored reservation', operation => {
    expect(accepts(control.CoreControlCallSchema, { envelope, operation, reservation: stored })).toBe(true);
    expect(accepts(control.CoreControlCallSchema, { envelope, operation })).toBe(false);
    expect(accepts(control.CoreControlCallSchema, { envelope, operation, reservation: lease })).toBe(false);
  });

  test('Core capabilities allows only envelope and discriminator', () => {
    expect(accepts(control.CoreControlCallSchema, { envelope, operation: 'capabilities' })).toBe(true);
    expect(accepts(control.CoreControlCallSchema, { envelope, operation: 'capabilities', reservation: stored })).toBe(false);
  });

  test('Core inspect requires a strict bounded query', () => {
    const call = { envelope, operation: 'inspect', reservation: stored, query };
    expect(accepts(control.CoreControlCallSchema, call)).toBe(true);
    expect(accepts(control.CoreControlCallSchema, { ...call, query: undefined })).toBe(false);
    expect(accepts(control.CoreControlCallSchema, { ...call, query: { ...query, extra: true } })).toBe(false);
    expect(accepts(control.CoreControlCallSchema, { ...call, query: { ...query, programRefs: [] } })).toBe(false);
  });

  test('Core dispose requires its bounded cleanup invocation', () => {
    const call = { envelope, operation: 'dispose', reservation: stored, cleanup };
    expect(accepts(control.CoreControlCallSchema, call)).toBe(true);
    expect(accepts(control.CoreControlCallSchema, { ...call, cleanup: undefined })).toBe(false);
    expect(accepts(control.CoreControlCallSchema, { ...call, cleanup: { ...cleanup, cookieHeader: 'forbidden' } })).toBe(false);
  });

  test('Core fence accepts optional cleanup authority for exact-run recovery', () => {
    const call = { envelope, operation: 'fence', reservation: stored, cleanup };
    expect(accepts(control.CoreControlCallSchema, call)).toBe(true);
    expect(accepts(control.CoreControlCallSchema, { ...call, cleanup: { ...cleanup, expiresAt: 1_800_001_300_001 } })).toBe(false);
    expect(accepts(control.CoreControlCallSchema, { ...call, cleanup: { ...cleanup, proof: 'forbidden' } })).toBe(false);
  });

  test.each(['capabilities', 'reserve', 'provision', 'activate', 'status', 'inspect'])('Core %s refuses recovery cleanup authority', operation => {
    const call = operation === 'capabilities'
      ? { envelope, operation, cleanup }
      : { envelope, operation, reservation: stored, cleanup, ...(operation === 'inspect' ? { query } : {}) };
    expect(accepts(control.CoreControlCallSchema, call)).toBe(false);
  });

  test('Core never receives setup authorization', () => {
    expect(accepts(control.CoreControlCallSchema, { envelope, operation: 'reserve', reservation: stored, authorization: { kind: 'setup', value: 'forbidden' } })).toBe(false);
  });
});

describe('strict private account and secret-free public views', () => {
  test.each(['proof', 'controllerToken', 'cookieHeader', 'setupCredential', 'proofHash', 'controllerHash'])('run views refuse %s', field => {
    expect(accepts(control.E2eControlRunViewSchema, { ...view, [field]: 'forbidden' })).toBe(false);
    expect(accepts(control.E2eControlRunViewSchema, { ...view, lease: { ...lease, [field]: 'forbidden' } })).toBe(false);
  });

  test.each([
    { ...view, auth: { sessions: -1 } }, { ...view, product: { merchants: 1.5 } },
    { ...view, auth: { cookieHeader: 'forbidden' } },
  ])('run views reject invalid inventory counts %#', value => {
    expect(accepts(control.E2eControlRunViewSchema, value)).toBe(false);
  });

  test.each([
    { ...account, sessionId: '' }, { ...account, cookieHeader: 'member=test\r\nOther: value' },
    { ...account, cookieAttributes: { ...account.cookieAttributes, httpOnly: false } },
    { ...account, cookieAttributes: { ...account.cookieAttributes, path: '/admin' } },
    { ...account, cookieAttributes: { ...account.cookieAttributes, sameSite: 'None' } },
    { ...account, cookieAttributes: { ...account.cookieAttributes, name: '' } },
    { ...account, cookieAttributes: { ...account.cookieAttributes, expiresAt: -1 } },
    { ...account, cookieAttributes: { ...account.cookieAttributes, extra: true } },
  ])('rejects malformed member account/policy %#', value => {
    expect(accepts(control.E2eControlAccountSchema, value)).toBe(false);
  });

  test('bootstrap result retains private account only in its issuance shape', () => {
    expect(accepts(control.E2eControlBootstrapResultSchema, { lease, admin: { ...account, role: 'viewer' } })).toBe(false);
    expect(accepts(control.E2eControlBootstrapResultSchema, { lease: { ...lease, proofHash: 'c'.repeat(64) }, admin: account })).toBe(false);
  });

  test.each([
    { ...capabilities, version: 1 }, { ...capabilities, operator: 1 },
    { ...capabilities, identity: 1 }, { ...capabilities, product: 1 },
    { ...capabilities, fencing: false }, { ...capabilities, recovery: false },
    { ...capabilities, runtime: { ...runtime, enabled: true } },
    { ...capabilities, migrations: { ...capabilities.migrations, secret: 'forbidden' } },
  ])('refuses incompatible or extra nested capabilities %#', value => {
    expect(accepts(control.E2eControlCapabilitiesSchema, value)).toBe(false);
  });

  test('Core capability reply preserves its narrower shape', () => {
    const value = { protocol: 'incentives-e2e-control', version: 2, runtime, product: 2, migrations: ['product.sql'], fencing: true, recovery: true };
    expect(accepts(control.CoreControlReplySchema, value)).toBe(true);
    expect(accepts(control.CoreControlReplySchema, { ...value, identity: 2 })).toBe(false);
    expect(accepts(control.CoreControlReplySchema, { ...value, product: 1 })).toBe(false);
  });

  test.each(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'INVALID_REQUEST', 'INCOMPATIBLE', 'CONFLICT', 'EXPIRED', 'QUARANTINED', 'UNAVAILABLE'])('accepts closed error code %s', code => {
    expect(accepts(control.E2eControlErrorSchema, { error: { ...error.error, code } })).toBe(true);
  });

  test.each([
    { error: { ...error.error, code: 'INTERNAL' } },
    { error: { ...error.error, message: 'raw failure' } },
    { error: { ...error.error, cookieHeader: 'forbidden' } },
    { error: { ...error.error, correlationId: '' } },
    { error: { ...error.error, retryable: 'false' } },
  ])('refuses raw or malformed errors %#', value => {
    expect(accepts(control.E2eControlErrorSchema, value)).toBe(false);
  });

  test('aggregate replies reject unknown nested fields instead of stripping them', () => {
    expect(accepts(control.E2eControlReplySchema, { ...view, lease: { ...lease, proof: 'forbidden' } })).toBe(false);
    expect(accepts(control.CoreControlReplySchema, { ...view, auth: undefined })).toBe(false);
    expect(accepts(control.E2eControlReplySchema, error)).toBe(true);
  });

  test('package entrypoint exports the full control schema boundary', () => {
    for (const [name, schema] of Object.entries(control)) {
      if (name.endsWith('Schema')) expect((contracts as Record<string, unknown>)[name]).toBe(schema);
    }
  });

  test('legacy version-one fixtures and their existing validation remain unchanged', () => {
    expect(contracts.E2eCapabilitiesSchema.parse({ protocol: 'incentives-e2e', version: 1, operator: { version: 1 }, identity: { version: 1, migrations: ['0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql'] }, product: { version: 1, migrations: ['0008_e2e_tenant_lifecycle.sql'], inspection: true, disposal: true } }).version).toBe(1);
    expect(contracts.E2eRunProofSchema.parse({ runId, proof: 'B'.repeat(43) }).proof).toBe('B'.repeat(43));
    const { cookieAttributes: _attributes, ...legacyAccount } = account;
    expect(contracts.E2eFixtureAccountSchema.parse(legacyAccount).sessionId).toBe('better-auth-opaque-session');
    expect(accepts(contracts.E2eInspectionQuerySchema, { ...query, programRefs: [] })).toBe(false);
    expect(accepts(contracts.E2eInspectionQuerySchema, { ...query, programRefs: Array(5).fill('promo') })).toBe(false);
  });
});
