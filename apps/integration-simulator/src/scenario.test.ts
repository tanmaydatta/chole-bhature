import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EvaluationRequestSchema, RedemptionRequestSchema } from '@incentives/contracts';
import { runScenario } from './scenario.js';
import { runCli } from './index.js';

const secret = 'sk_simulator_test_private_material_00000000001';
const expectedPrice = { currency: 'GBP', originalMerchandiseSubtotal: 10_001,
  discountAllocations: [
    { programRef: 'quarter', programRevision: 2, rewardRuleRef: 'capped', discountMinorUnits: 1_500 },
    { programRef: 'line', programRevision: 1, rewardRuleRef: 'per-unit', discountMinorUnits: 1_500,
      lineAllocations: [{ lineRef: 'a', discountMinorUnits: 500 }, { lineRef: 'b', discountMinorUnits: 1_000 }] },
  ], totalDiscount: 3_000, discountedMerchandiseSubtotal: 7_001 };
const decisions = [
  { programRef: 'quarter', programRevision: 2, programType: 'promo', outcome: 'qualified', rewardRuleRef: 'capped',
    effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
      maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 } }], reasonCodes: [], commitRequired: true },
  { programRef: 'line', programRevision: 1, programType: 'promo', outcome: 'qualified', rewardRuleRef: 'per-unit',
    effects: [{ type: 'line_item_discount', productRef: 'same', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 500 } }],
    reasonCodes: [], commitRequired: true },
];
const nativeCart = { currency: 'GBP', total_pence: 10_001, items: [
  { line_id: 'a', sku: 'same', count: 1, unit_pence: 4_001 },
  { line_id: 'b', sku: 'same', count: 2, unit_pence: 1_500 },
  { line_id: 'c', sku: 'other', count: 1, unit_pence: 3_000 },
] };
const fixture = [{ programRef: 'quarter', programRevision: 2, rewardRuleRef: 'capped' },
  { programRef: 'line', programRevision: 1, rewardRuleRef: 'per-unit' }];
type Seen = { method: string; path: string; body?: unknown; authorization?: string };
type Options = { marker?: unknown; markerStatus?: number; redirect?: boolean; redirectTo?: string; schemaVersion?: number;
  revision?: number; malformedEvaluation?: boolean; foreignLine?: boolean; failureCode?: string; failureMessage?: string; changedRetry?: boolean };

async function boundary(options: Options = {}) {
  const seen: Seen[] = [];
  let version = 1;
  let evaluations = 0;
  let committed = false;
  let redemption: unknown;
  const server: Server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk.toString();
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const path = request.url!;
    seen.push({ method: request.method!, path, ...(body === undefined ? {} : { body }), authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    response.setHeader('x-correlation-id', request.headers['x-correlation-id']!);
    const reply = (value: unknown, status = 200) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    const failure = (code: string, status: number) => reply({ error: { code,
      message: options.failureMessage ?? 'Safe server message', correlationId: request.headers['x-correlation-id'], retryable: false } }, status);
    if (path === '/v1/runtime-capabilities') {
      if (options.redirect) { response.setHeader('location', options.redirectTo ?? '/v1/schema/published'); reply({}, 302); }
      else if (options.markerStatus) failure('NOT_FOUND', options.markerStatus);
      else reply(options.marker ?? { environment: 'local', simulatorAllowed: true });
    } else if (path === '/v1/schema/published') reply({ version: options.schemaVersion ?? 3,
      publishedAt: '2026-10-14T00:00:00Z', definitions: [], jsonSchema: {}, sample: {} });
    else if (path === '/v1/customers/buyer' && request.method === 'GET') {
      if (version === 0) failure('NOT_FOUND', 404);
      else reply({ externalRef: 'buyer', version, attributes: {}, updatedAt: '2026-10-14T00:00:00Z' });
    } else if (path === '/v1/customers/buyer' && request.method === 'PATCH') {
      const patch = body as { attributes: unknown; expectedVersion?: number };
      expect(patch.expectedVersion).toBe(version === 0 ? undefined : version);
      version++;
      reply({ externalRef: 'buyer', version, attributes: patch.attributes, updatedAt: '2026-10-14T00:00:00Z' });
    } else if (path === '/v1/evaluate') {
      EvaluationRequestSchema.parse(body);
      evaluations++;
      const selected = decisions.map((decision, index) => ({ ...decision,
        programRevision: index === 0 ? (options.revision ?? 2) : 1 }));
      const evaluated = EvaluationRequestSchema.parse(body);
      const price = structuredClone(expectedPrice);
      if (options.foreignLine) price.discountAllocations[1]!.lineAllocations![0]!.lineRef = 'foreign-line';
      reply(options.malformedEvaluation ? { customerAttributes: 'must-not-leak' } : {
        evaluationId: `evaluation-${evaluations}`,
        ...(evaluated.customerRef === undefined ? {} : { customerRef: 'buyer', customerVersion: version }),
        schemaVersion: 3, expiresAt: '2099-01-01T00:00:00Z', decisions: committed ? [] : selected,
        priceBreakdown: committed ? { currency: 'GBP', originalMerchandiseSubtotal: 10_001,
          discountAllocations: [], totalDiscount: 0, discountedMerchandiseSubtotal: 10_001 } : price,
      });
    } else if (path === '/v1/redemptions') {
      const redemptionRequest = RedemptionRequestSchema.parse(body);
      if (redemptionRequest.evaluationId === 'evaluation-3') failure(options.failureCode ?? 'EXHAUSTED', 409);
      else if (committed) reply(options.changedRetry ? { ...(redemption as object), redemptionId: 'changed' } : redemption);
      else {
        committed = true;
        redemption = { ...redemptionRequest, redemptionId: 'receipt-1', status: 'committed',
          entries: decisions.map(({ programRef, programRevision, rewardRuleRef, effects }) => ({ programRef, programRevision, rewardRuleRef, effects })),
          priceBreakdown: expectedPrice };
        reply(redemption);
      }
    } else failure('NOT_FOUND', 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = { origin, environment: 'local', secretKey: secret, schemaVersion: 3, fixture,
    customer: { shopper_id: 'buyer', profile: { tier: 'gold', note: 'private-customer-attribute' } },
    updatedProfile: { tier: 'silver', note: 'private-updated-attribute' }, cart: nativeCart,
    context: {}, codes: ['QUARTER', 'LINE'], order: { order_id: 'order-1', retry_key: 'attempt-1' } };
  return { config, seen, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

describe('public HTTP checkout simulator', () => {
  // Break caught: locally recomputing discounts, wrong native identities, or capture before commit/retry verification.
  test('maps exact authoritative allocations and versions, commits before fake capture, retries and reprices exhaustion', async () => {
    const api = await boundary();
    const captures: unknown[] = [];
    try {
      const result = await runScenario({ ...api.config, capture: (value: unknown) => {
        expect(api.seen.filter(request => request.path === '/v1/redemptions')).toHaveLength(2);
        captures.push(value);
      } });
      expect(result.customerVersions).toEqual([2, 3]);
      expect(result.evaluation.priceBreakdown).toEqual(expectedPrice);
      expect(result.redemption.priceBreakdown).toEqual(expectedPrice);
      expect(result.retry).toEqual(result.redemption);
      expect(result.applied).toEqual({ currency: 'GBP', original_total_pence: 10_001, discount_pence: 3_000, total_pence: 7_001,
        allocations: [{ promo_id: 'quarter', revision: 2, rule_id: 'capped', pence: 1_500 },
          { promo_id: 'line', revision: 1, rule_id: 'per-unit', pence: 1_500,
            line_allocations: [{ line_id: 'a', pence: 500 }, { line_id: 'b', pence: 1_000 }] }] });
      expect(captures).toEqual([{ order_id: 'order-1', currency: 'GBP', merchandise_total_pence: 7_001 }]);
      expect(result.repriced.total_pence).toBe(10_001);
      expect(result.trace.map((entry: { phase: string }) => entry.phase)).toContain('exhausted');
      const evaluations = api.seen.filter(request => request.path === '/v1/evaluate');
      expect(evaluations).toHaveLength(4);
      expect(evaluations[1]?.body).toEqual({ customerRef: 'buyer', codes: ['QUARTER', 'LINE'], context: {},
        cart: { currency: 'GBP', subtotal: 10_001, items: [
          { lineRef: 'a', productRef: 'same', quantity: 1, unitPrice: 4_001 },
          { lineRef: 'b', productRef: 'same', quantity: 2, unitPrice: 1_500 },
          { lineRef: 'c', productRef: 'other', quantity: 1, unitPrice: 3_000 },
        ] } });
      const redemptions = api.seen.filter(request => request.path === '/v1/redemptions');
      expect(redemptions).toHaveLength(3);
      expect(redemptions[0]?.body).toEqual({ evaluationId: 'evaluation-2', externalOrderRef: 'order-1', idempotencyKey: 'attempt-1' });
      expect(redemptions[1]?.body).toEqual(redemptions[0]?.body);
      expect(redemptions[2]?.body).toEqual({ evaluationId: 'evaluation-3', externalOrderRef: 'order-1:stale', idempotencyKey: 'attempt-1:stale' });
      expect(JSON.stringify(result.trace)).not.toMatch(/sk_simulator|private-customer|private-updated|buyer|same|QUARTER/u);
      expect(api.seen.every(request => request.authorization === `Bearer ${secret}`)).toBe(true);
    } finally { await api.close(); }
  });

  // Break caught: trusting labels/hostname, malformed permissions or a redirect before business writes.
  test.each([
    { marker: { environment: 'production', simulatorAllowed: false } },
    { marker: { environment: 'ci', simulatorAllowed: false } },
    { marker: { environment: 'unknown', simulatorAllowed: false } },
    { marker: { environment: 'production', simulatorAllowed: true } },
    { marker: { environment: 'local', simulatorAllowed: 'true' } },
    { marker: { environment: 'local', simulatorAllowed: true, bypass: true } },
    { marker: {} }, { markerStatus: 404 }, { redirect: true },
    { marker: { environment: 'staging', simulatorAllowed: true } },
  ])('refuses unsafe/missing/inconsistent capabilities before any business request', async options => {
    const api = await boundary(options);
    try {
      await expect(runScenario(api.config)).rejects.toMatchObject({ code: expect.stringMatching(/ENVIRONMENT_REFUSED|INVALID_RESPONSE|REDIRECT_REFUSED|NOT_FOUND/u) });
      expect(api.seen.map(request => request.path)).toEqual(['/v1/runtime-capabilities']);
    } finally { await api.close(); }
  });

  test('allows staging only with the actual matching server marker', async () => {
    const api = await boundary({ marker: { environment: 'staging', simulatorAllowed: true } });
    try { expect((await runScenario({ ...api.config, environment: 'staging' })).repriced.total_pence).toBe(10_001); }
    finally { await api.close(); }
  });

  test.each(['https://user:password@example.test', 'https://example.test/path', 'https://example.test?key=x',
    'https://example.test/#fragment', 'http://example.test', ' https://example.test', 'https://example.test\\other'])('rejects ambiguous targets without HTTP', async origin => {
    const api = await boundary();
    try { await expect(runScenario({ ...api.config, origin })).rejects.toMatchObject({ code: 'INVALID_CONFIG' }); expect(api.seen).toEqual([]); }
    finally { await api.close(); }
  });

  test('refuses the wrong published schema before customer mutations', async () => {
    const api = await boundary({ schemaVersion: 2 });
    try { await expect(runScenario(api.config)).rejects.toMatchObject({ code: 'FIXTURE_MISMATCH' });
      expect(api.seen.some(request => request.method === 'PATCH' || request.method === 'POST')).toBe(false); }
    finally { await api.close(); }
  });

  test('refuses a different published Promo revision before redemption/capture', async () => {
    const api = await boundary({ revision: 3 });
    try { await expect(runScenario(api.config)).rejects.toMatchObject({ code: 'FIXTURE_MISMATCH' });
      expect(api.seen.some(request => request.path === '/v1/redemptions' || request.method === 'PATCH')).toBe(false); }
    finally { await api.close(); }
  });

  test('rejects malformed evaluation without exposing its body', async () => {
    const api = await boundary({ malformedEvaluation: true });
    try { await expect(runScenario(api.config)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' }); }
    finally { await api.close(); }
  });

  test('fails closed on a non-exhaustion conflict and suppresses raw error data', async () => {
    const api = await boundary({ failureCode: 'VERSION_CONFLICT', failureMessage: `${secret}:private-updated-attribute:SQL:stack` });
    try { let failure: unknown; try { await runScenario(api.config); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ phase: 'stale-redemption', code: 'VERSION_CONFLICT', status: 409 });
      expect(String(failure)).not.toMatch(/sk_simulator|private-updated|SQL|stack/u);
      expect(api.seen.filter(request => request.path === '/v1/evaluate')).toHaveLength(3); }
    finally { await api.close(); }
  });

  test('does not capture after a mismatched retry receipt', async () => {
    const api = await boundary({ changedRetry: true });
    let captures = 0;
    try { await expect(runScenario({ ...api.config, capture: () => { captures++; } })).rejects.toMatchObject({ code: 'RECEIPT_MISMATCH' });
      expect(captures).toBe(0); }
    finally { await api.close(); }
  });

  test('rejects allocations for foreign line identities before customer mutation or capture', async () => {
    const api = await boundary({ foreignLine: true });
    try { await expect(runScenario(api.config)).rejects.toMatchObject({ code: 'FIXTURE_MISMATCH' });
      expect(api.seen.some(request => request.method === 'PATCH' || request.path === '/v1/redemptions')).toBe(false); }
    finally { await api.close(); }
  });

  test.each(['USAGE_CAP_EXHAUSTED', 'BUDGET_EXHAUSTED', 'PER_CUSTOMER_CAP_EXHAUSTED'])('reprices existing canonical409%s without hiding its code', async failureCode => {
    const api = await boundary({ failureCode });
    try { const result = await runScenario(api.config);
      expect(result.trace.find(entry => entry.phase === 'exhausted')).toEqual({ phase: 'exhausted', status: 409, code: failureCode });
      expect(result.repriced.total_pence).toBe(10_001); expect(result.captures).toHaveLength(1); }
    finally { await api.close(); }
  });

  test('never forwards merchant credentials to a redirected origin', async () => {
    const other = await boundary(); const api = await boundary({ redirect: true, redirectTo: other.config.origin });
    try { await expect(runScenario(api.config)).rejects.toMatchObject({ code: 'REDIRECT_REFUSED' });
      expect(api.seen).toHaveLength(1); expect(other.seen).toEqual([]); }
    finally { await api.close(); await other.close(); }
  });
  test('unknown conflict codes cannot leak raw text or trigger exhaustion recovery', async () => {
    const api = await boundary({ failureCode: 'SECRET_CUSTOMER_SQL_PAYLOAD', failureMessage: secret });
    try { await expect(runScenario(api.config)).rejects.toMatchObject({ code: 'API_FAILURE', status: 409 });
      expect(api.seen.filter(request => request.path === '/v1/evaluate')).toHaveLength(3); }
    finally { await api.close(); }
  });
  test('CLI succeeds with private process key and prints only safe diagnostics plus merchandise summary', async () => {
    const api = await boundary(); const directory = await mkdtemp(path.join(tmpdir(), 'simulator-success-test-'));
    try {
      const { origin, environment, secretKey: _secret, ...scenario } = api.config;
      const file = path.join(directory, 'scenario.json'); await writeFile(file, JSON.stringify(scenario), { mode: 0o600 });
      const output: string[] = [];
      expect(await runCli(['--origin', origin, '--environment', environment, '--scenario', file],
        { INCENTIVES_SECRET_KEY: secret }, value => output.push(value))).toBe(0);
      const rows = output.join('').trim().split('\n').map(line => JSON.parse(line));
      expect(rows.at(-1)).toEqual({ status: 'completed', currency: 'GBP', originalMerchandiseSubtotal: 10_001,
        totalDiscount: 3_000, discountedMerchandiseSubtotal: 7_001, repricedMerchandiseSubtotal: 10_001, captures: 1 });
      for (const row of rows.slice(0, -1)) expect(Object.keys(row).every(key => ['phase', 'status', 'code', 'correlationId'].includes(key))).toBe(true);
      expect(output.join('')).not.toMatch(/sk_simulator|private-customer|private-updated|buyer|same|QUARTER|effects|profile/u);
    } finally { await api.close(); await rm(directory, { recursive: true }); }
  });
});
