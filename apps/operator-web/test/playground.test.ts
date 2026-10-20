import type { OperatorCallContext, OperatorPrincipal } from '@incentives/contracts';
import { describe, expect, test, vi } from 'vitest';

import { ROLE_PERMISSIONS } from '../../identity/src/authorization/registry.js';
import { createOperatorWebWorker } from '../src/worker.js';
import type { CoreRpcService, OperatorWebEnv } from '../src/routes/types.js';
import { selectionCookie } from '../src/session.js';

const input = { cart: { currency: 'GBP', subtotal: 10_000, items: [
  { lineRef: 'line-a', productRef: 'product-a', quantity: 2, unitPrice: 5_000 },
] } };
const output = { evaluationId: 'eval-a', schemaVersion: 1, expiresAt: '2026-10-14T13:05:00.000Z',
  decisions: [], priceBreakdown: { currency: 'GBP', originalMerchandiseSubtotal: 10_000,
    discountAllocations: [], totalDiscount: 0, discountedMerchandiseSubtotal: 10_000 },
};
const principal: OperatorPrincipal = {
  userId: 'viewer-a', sessionId: 'session-a', authenticationMethods: ['magic-link'],
  authenticatedAt: '2026-10-14T13:00:00.000Z', organizationId: 'org-a',
  merchantId: 'merchant-a', membershipId: 'membership-a', permissions: [...ROLE_PERMISSIONS.viewer],
};
async function unsupported(): Promise<never> { throw new Error('Unexpected test dependency'); }
function fixture(identity: unknown = principal, result: unknown = output) {
  const evaluate = vi.fn(async (_context: OperatorCallContext, _body: unknown) => result);
  const core = {
    evaluate,
    createCredential: unsupported, listCredentials: unsupported, revokeCredential: unsupported,
    listSchemaDefinitions: unsupported, getPublishedSchema: unsupported,
    createSchemaDefinition: unsupported, updateSchemaDefinition: unsupported,
    deleteSchemaDefinition: unsupported, previewSchemaDefinitionImpact: unsupported,
    deprecateSchemaDefinition: unsupported, publishSchema: unsupported,
    getCustomer: unsupported, upsertCustomer: unsupported,
    listPrograms: unsupported, createProgramDraft: unsupported, getProgram: unsupported,
    updateProgramDraft: unsupported, publishProgram: unsupported,
    pauseProgram: unsupported, resumeProgram: unsupported, endProgram: unsupported,
  } satisfies CoreRpcService & { evaluate: typeof evaluate };
  const env: OperatorWebEnv = {
    APP_ENV: 'local', PUBLIC_APP_ORIGIN: 'https://operator.example.test',
    OPERATOR_SELECTION_SECRET: 'playground-selection-test-secret-at-least-thirty-two',
    CORE: core, ASSETS: { fetch: unsupported }, IDENTITY_AUTH: { fetch: unsupported },
    IDENTITY: {
      resolveBrowserSession: unsupported,
      resolveBrowserPrincipal: vi.fn(async () => identity),
      getE2eCapabilities: unsupported, listClients: unsupported, getProvisioningForRoot: unsupported,
      listMembers: unsupported, listInvitations: unsupported, provisionClient: unsupported,
      getProvisioning: unsupported, createInvitation: unsupported, retryInvitation: unsupported,
      acceptInvitation: unsupported, removeMember: unsupported, changeMemberRole: unsupported,
      previewE2eRun: unsupported, disposeE2eRun: unsupported, inspectE2eRun: unsupported,
      createE2eAccount: unsupported,
    },
  };
  return { env, evaluate };
}
async function dispatch(env: OperatorWebEnv, body: unknown = input, headers: Record<string, string> = {}, path = '/operator/v1/playground/evaluate') {
  const request = new Request(`https://operator.example.test${path}`, { method: 'POST',
    headers: { origin: env.PUBLIC_APP_ORIGIN, cookie: 'incentives-local.session_token=test-session',
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-correlation-id': 'corr-playground', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return createOperatorWebWorker().fetch!(request, env, {} as ExecutionContext);
}

describe('operator evaluation boundary', () => {
  // Break caught: accepting browser authority or bypassing Identity changes which merchant reaches Core.
  test.each(['admin', 'operator', 'viewer'] as const)('%s evaluates using only Identity authority', async role => {
    const { env, evaluate } = fixture({ ...principal, permissions: [...ROLE_PERMISSIONS[role]] });
    const response = await dispatch(env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(output);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(evaluate).toHaveBeenCalledWith({ actorUserId: 'viewer-a', actorKind: 'member',
      merchantId: 'merchant-a', permission: 'evaluations:run', correlationId: 'corr-playground' }, input);
  });

  test.each([{ merchantId: 'merchant-b' }, { actorUserId: 'root' }, { permission: 'evaluations:run' }, { customer: { tier: 'gold' } }])('refuses injected authority/customer attributes %j', async injected => {
    const { env, evaluate } = fixture();
    const response = await dispatch(env, { ...input, ...injected });
    expect(response.status).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('refuses anonymous and missing-permission calls before Core', async () => {
    for (const [identity, status] of [[{ error: { code: 'UNAUTHORIZED', message: 'Sign in required',
      correlationId: 'corr-playground', retryable: false } }, 401], [{ ...principal, permissions: [] }, 403]] as const) {
      const { env, evaluate } = fixture(identity);
      expect((await dispatch(env)).status).toBe(status);
      expect(evaluate).not.toHaveBeenCalled();
    }
  });

  test('refuses missing ROOT selection and crossed selection authority', async () => {
    const { env, evaluate } = fixture({ userId: 'root-a', sessionId: 'root-session', platformRole: 'root',
      authenticationMethods: ['passkey'], authenticatedAt: principal.authenticatedAt, permissions: [] });
    const missing = await dispatch(env);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'MERCHANT_SELECTION_REQUIRED' } });
    const root: OperatorPrincipal = { userId: 'root-a', sessionId: 'root-session', platformRole: 'root',
      authenticationMethods: ['passkey'], authenticatedAt: principal.authenticatedAt, permissions: [] };
    const selected = await selectionCookie(env, root, 'merchant-a');
    env.IDENTITY.resolveBrowserPrincipal = vi.fn()
      .mockResolvedValueOnce(root).mockResolvedValueOnce({ ...root, merchantId: 'merchant-b' });
    expect((await dispatch(env, input, { cookie: `incentives-local.session_token=test-session; ${selected}` })).status).toBe(403);
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('preserves Origin, fetch-site, query, bounded body and JSON validation', async () => {
    const { env, evaluate } = fixture();
    expect((await dispatch(env, input, { origin: 'https://foreign.test' })).status).toBe(403);
    expect((await dispatch(env, input, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await dispatch(env, input, {}, '/operator/v1/playground/evaluate?merchantId=foreign')).status).toBe(400);
    expect((await dispatch(env, '{')).status).toBe(400);
    expect((await dispatch(env, JSON.stringify({ ...input, context: { oversized: 'a'.repeat(65_536) } }))).status).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('rejects malformed output and maps private failures without reflecting their content', async () => {
    const { env, evaluate } = fixture(principal, { ...output, secret: 'private-result' });
    let response = await dispatch(env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'CORE_UNAVAILABLE',
      message: 'Core is temporarily unavailable', retryable: true, correlationId: 'corr-playground' } });
    evaluate.mockRejectedValue(new Error('SQL customer/promo payload secret'));
    response = await dispatch(env);
    expect(await response.text()).not.toMatch(/SQL|payload|secret/u);
  });

  test.each([
    [404, 'NOT_FOUND', 'The requested resource was not found', false],
    [400, 'INVALID_REQUEST', 'Request validation failed', false],
    [503, 'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true],
  ])('preserves canonical safe Core failure status %s', async (status, code, message, retryable) => {
    const error = { error: { code, message, retryable, correlationId: 'corr-playground' } };
    const { env } = fixture(principal, error);
    const response = await dispatch(env);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(error);
  });

  test('exposes no playground redemption or commit route', async () => {
    const { env, evaluate } = fixture();
    for (const action of ['redeem', 'commit']) expect((await dispatch(env, {}, {}, `/operator/v1/playground/${action}`)).status).toBe(404);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
