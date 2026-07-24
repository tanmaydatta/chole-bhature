import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { INVITATION_ACCEPT_PATH, invitationAcceptanceUrl } from '@incentives/contracts';

import App from '../App';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ToastProvider } from '../components/common/Toast';

const originalCredentialsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'credentials');

const allPermissions = [
  'members:read', 'members:manage', 'schemas:read', 'schemas:manage', 'schemas:publish',
  'customers:read', 'customers:manage', 'programs:read', 'programs:manage',
  'programs:publish', 'evaluations:run', 'redemptions:commit', 'credentials:read',
  'credentials:manage', 'audit:read',
];

const sessions = {
  admin: {
    userId: 'user-admin', authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', organizationId: 'org-a',
    merchantId: 'merchant-a', membershipId: 'membership-admin',
    permissions: allPermissions, merchantSelectionRequired: false,
  },
  operator: {
    userId: 'user-operator', authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', organizationId: 'org-a',
    merchantId: 'merchant-a', membershipId: 'membership-operator',
    permissions: [
      'schemas:read', 'schemas:manage', 'schemas:publish', 'customers:read',
      'customers:manage', 'programs:read', 'programs:manage', 'programs:publish',
      'evaluations:run', 'redemptions:commit', 'audit:read',
    ], merchantSelectionRequired: false,
  },
  viewer: {
    userId: 'user-viewer', authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', organizationId: 'org-a',
    merchantId: 'merchant-a', membershipId: 'membership-viewer',
    permissions: ['schemas:read', 'programs:read', 'evaluations:run', 'audit:read'],
    merchantSelectionRequired: false,
  },
  root: {
    userId: 'user-root', authenticationMethods: ['passkey'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', platformRole: 'root',
    permissions: [], merchantSelectionRequired: true,
  },
  rootSelected: {
    userId: 'user-root', authenticationMethods: ['passkey'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', platformRole: 'root',
    merchantId: 'merchant-a', permissions: [], merchantSelectionRequired: false,
  },
};

const team = {
  members: [
    { id: 'membership-admin', organizationId: 'org-a', userId: 'user-admin', email: 'admin@example.test', role: 'admin', status: 'active' },
    { id: 'membership-viewer', organizationId: 'org-a', userId: 'user-viewer', email: 'viewer@example.test', role: 'viewer', status: 'active' },
  ],
  invitations: [
    { id: 'invitation-failed', organizationId: 'org-a', email: 'new@example.test', role: 'viewer', status: 'delivery_failed', expiresAt: '2026-07-21T10:00:00.000Z' },
  ],
};

const credentials = [{
  id: 'credential-old', name: 'Old secret', merchantId: 'merchant-a', environment: 'local',
  scopes: ['schema:read'], createdAt: '2026-07-20T10:00:00.000Z',
  createdBy: 'user-admin', status: 'active', suffix: 'abcd', kind: 'secret',
}, {
  id: 'credential-browser', name: 'Browser key', merchantId: 'merchant-a', environment: 'production',
  scopes: ['schema:read', 'evaluations:write'], allowedOrigins: ['https://shop.example', 'https://checkout.example'],
  expiresAt: '2026-12-31T23:59:00.000Z', createdAt: '2026-07-20T11:00:00.000Z',
  createdBy: 'user-admin', lastUsedAt: '2026-07-20T12:00:00.000Z', status: 'active',
  suffix: 'wxyz', kind: 'publishable', requestsPerMinute: 120,
}, {
  id: 'credential-expired', name: 'Expired secret', merchantId: 'merchant-a', environment: 'local',
  scopes: ['schema:read'], expiresAt: '2000-01-01T00:00:00.000Z',
  createdAt: '2026-07-19T10:00:00.000Z', createdBy: 'user-admin', status: 'expired',
  suffix: 'deadbeef', kind: 'secret',
}];

function json(value: unknown, status = 200, correlationId = 'corr-ui') {
  return Response.json(value, { status, headers: { 'x-correlation-id': correlationId } });
}

function canonicalError(status: number, code: string, message: string, retryable = false) {
  return json({ error: { code, message, retryable, correlationId: 'corr-ui-error' } }, status);
}

function installFetch(session: object | null, overrides: Record<string, unknown> = {}) {
  let liveSession = session;
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${path}`;
    const override = overrides[key];
    if (override instanceof Response) return override;
    if (typeof override === 'function') return (override as () => Promise<Response> | Response)();
    if (path === '/operator/v1/session') {
      return liveSession
        ? json(liveSession)
        : canonicalError(401, 'UNAUTHORIZED', 'Authentication is required');
    }
    if (path === '/auth/sign-in/magic-link') return json({ ok: true });
    if (path === '/auth/passkey/generate-authenticate-options') return json({
      challenge: 'Y2hhbGxlbmdl', rpId: 'operator.example.test', timeout: 60_000,
      allowCredentials: [{ id: 'Y3JlZGVudGlhbC1h', type: 'public-key', transports: ['internal'] }],
      userVerification: 'required',
    });
    if (path === '/auth/passkey/verify-authentication') {
      liveSession = sessions.root;
      return json({ ok: true });
    }
    if (path === '/auth/root/recovery') return json({
      grant: 'g'.repeat(43), expiresAt: Date.now() + 600_000,
    });
    if (path === '/auth/root/recovery/exchange') return json({ ok: true });
    if (path === '/auth/passkey/generate-register-options') return json({
      challenge: 'Y2hhbGxlbmdl',
      rp: { id: 'operator.example.test', name: 'Incentives' },
      user: { id: 'cm9vdC0x', name: 'root-1', displayName: 'Platform Root' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000,
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      attestation: 'none', excludeCredentials: [],
    });
    if (path === '/auth/passkey/verify-registration') return json({ ok: true });
    if (path === '/auth/root/recovery/rotate-codes') return json({
      userId: 'root-1',
      codes: Array.from({ length: 8 }, (_, index) => `${String(index).padStart(2, '0')}${'r'.repeat(41)}`),
    });
    if (path === '/auth/sign-out') {
      liveSession = null;
      return json({ ok: true });
    }
    if (path === '/operator/v1/invitations/accept') return json({
      id: 'membership-new', organizationId: 'org-a', userId: 'user-new', role: 'viewer', status: 'active',
    });
    if (path === '/operator/v1/platform/clients') return method === 'POST'
      ? json({ provisioningId: 'provision-new', merchantId: 'merchant-new', organizationId: 'org-new', name: body.name, status: 'active', failedStep: null, retryable: false }, 201)
      : json({ clients: [
        { provisioningId: 'provision-a', merchantId: 'merchant-a', organizationId: 'org-a', name: 'Client A', status: 'active', failedStep: null, retryable: false },
        { provisioningId: 'provision-failed', merchantId: 'merchant-failed', organizationId: null, name: 'Failed client', status: 'failed', failedStep: 'core_provision', retryable: true },
      ] });
    if (path.endsWith('/retry') && path.includes('/platform/provisionings/')) return json({
      provisioningId: 'provision-failed', merchantId: 'merchant-failed', organizationId: 'org-failed', name: 'Failed client', status: 'active', failedStep: null, retryable: false,
    });
    if (path === '/operator/v1/platform/merchant-selection') {
      liveSession = { ...sessions.root, merchantId: body.merchantId, merchantSelectionRequired: false };
      return new Response(null, { status: 204 });
    }
    if (path === '/operator/v1/team') return json(team);
    if (path === '/operator/v1/team/invitations') return json({
      id: 'invitation-new', organizationId: 'org-a', email: body.email, role: body.role,
      status: 'sent', expiresAt: '2026-07-21T10:00:00.000Z',
    }, 201);
    if (path.endsWith('/retry') && path.includes('/team/invitations/')) return json({
      ...team.invitations[0], status: 'sent',
    });
    if (path.includes('/team/members/')) return method === 'DELETE'
      ? json({ ...team.members[1], status: 'removed' })
      : json({ ...team.members[1], role: body.role });
    if (path === '/operator/v1/credentials') return method === 'POST'
      ? json({ credential: {
        id: 'credential-new', name: body.name, merchantId: 'merchant-a',
        environment: body.environment, scopes: body.scopes,
        createdAt: '2026-07-20T10:00:00.000Z', createdBy: 'user-admin', status: 'active',
        suffix: 'new1', kind: body.kind,
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        ...(body.kind === 'publishable' ? {
          allowedOrigins: body.allowedOrigins ?? [], requestsPerMinute: body.requestsPerMinute,
        } : {}),
      }, token: `${body.kind === 'publishable' ? 'pk' : 'sk'}_${'a'.repeat(32)}` }, 201)
      : json(credentials);
    if (path === '/operator/v1/programs') return json({ programs: [] });
    if (path === '/operator/v1/programs/promo-draft-1') return json({
      configuration: {
        id: 'promo-draft-1', type: 'promo', name: 'Draft Summer Sale', status: 'draft',
        eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
        fallbackReward: { id: 'fallback', name: 'Shipping', reward: { type: 'free_shipping' } },
        stackable: false, priority: 10, autoApply: true,
      },
      draftConfiguration: {
        id: 'promo-draft-1', type: 'promo', name: 'Draft Summer Sale', status: 'draft',
        eligibility: { match: 'ALL', conditions: [] }, rewardRules: [],
        fallbackReward: { id: 'fallback', name: 'Shipping', reward: { type: 'free_shipping' } },
        stackable: false, priority: 10, autoApply: true,
      },
      lifecycle: {
        programRef: 'promo-draft-1', status: 'draft', draftRevision: 1,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    });
    if (path === '/operator/v1/schema/definitions') return json({
      definitions: [{
        id: 'definition-country', readOnly: false, referenced: false,
        definition: {
          key: 'customer.country', label: 'Customer country', source: 'customer',
          type: 'string', required: false,
        },
      }], draftVersion: 1,
    });
    if (path.includes('/operator/v1/credentials/')) return json({ ...credentials[0], status: 'revoked' });
    throw new Error(`Unexpected BFF call: ${key}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

function renderApp(path = '/') {
  return render(<ThemeProvider><ToastProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></ToastProvider></ThemeProvider>);
}

function installWebAuthn() {
  const credential = {
    id: 'credential-a',
    rawId: new Uint8Array([1, 2, 3, 4]).buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
  };
  const get = vi.fn(async () => ({
    ...credential,
    response: {
      clientDataJSON: new Uint8Array([5, 6]).buffer,
      authenticatorData: new Uint8Array([7, 8]).buffer,
      signature: new Uint8Array([9, 10]).buffer,
      userHandle: null,
    },
  }));
  const create = vi.fn(async () => ({
    ...credential,
    response: {
      clientDataJSON: new Uint8Array([5, 6]).buffer,
      attestationObject: new Uint8Array([11, 12]).buffer,
      getTransports: () => ['internal'],
    },
  }));
  vi.stubGlobal('PublicKeyCredential', class PublicKeyCredential {});
  Object.defineProperty(navigator, 'credentials', {
    configurable: true, value: { get, create },
  });
  return { get, create };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCredentialsDescriptor) {
    Object.defineProperty(navigator, 'credentials', originalCredentialsDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'credentials');
  }
});

describe('operator access flow', () => {
  test('shows loading, neutral passwordless sign-in confirmation, authenticated refresh, and sign-out', async () => {
    const { calls } = installFetch(null);
    renderApp('/');
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    const email = await screen.findByLabelText('Work email');
    await userEvent.type(email, 'someone@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByText('If that address can sign in, a link is on its way.')).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: '/auth/sign-in/magic-link', method: 'POST',
      body: { email: 'someone@example.test', callbackURL: '/' },
    });

    cleanup();
    const signedIn = installFetch(sessions.admin);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Team' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Work email')).toBeInTheDocument();
    expect(signedIn.calls).toContainEqual({ path: '/auth/sign-out', method: 'POST', body: {} });
  });

  test('preserves the authenticated session when sign-out fails and retries sign-out safely', async () => {
    let attempts = 0;
    const { calls } = installFetch(sessions.admin, {
      'POST /auth/sign-out': () => {
        attempts += 1;
        return attempts === 1
          ? canonicalError(503, 'IDENTITY_UNAVAILABLE', 'Sign-out is temporarily unavailable', false)
          : json({ ok: true });
      },
    });
    renderApp('/settings/team');
    await screen.findByRole('heading', { name: 'Team', level: 2 });

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-out is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText('Correlation: corr-ui-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Work email')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Work email')).toBeInTheDocument();
    expect(calls.filter(call => call.path === '/auth/sign-out')).toHaveLength(2);
  });

  test('accepts an invitation once and removes its token from browser history', async () => {
    const token = 'a'.repeat(43);
    const capturedLocalEmailLink = new URL(invitationAcceptanceUrl('http://localhost:5173', token));
    const { calls } = installFetch(null);
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderApp(`${capturedLocalEmailLink.pathname}${capturedLocalEmailLink.search}`);

    const invitedEmail = await screen.findByLabelText('Invited email');
    expect(invitedEmail).toHaveValue('');
    await userEvent.type(invitedEmail, 'new@example.test');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText('Invitation accepted. You can now sign in.')).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: '/operator/v1/invitations/accept', method: 'POST',
      body: { token, email: 'new@example.test' },
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', INVITATION_ACCEPT_PATH);
    await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Work email')).toBeInTheDocument();
  });

  test('scrubs an invitation token from the URL before any submission', async () => {
    const token = 'b'.repeat(43);
    installFetch(null);
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const capturedLocalEmailLink = new URL(invitationAcceptanceUrl('http://localhost:5173', token));
    renderApp(`${capturedLocalEmailLink.pathname}${capturedLocalEmailLink.search}`);

    await screen.findByRole('button', { name: 'Accept invitation' });
    expect(replaceState).toHaveBeenCalledWith(null, '', INVITATION_ACCEPT_PATH);
    expect(window.location.search).toBe('');
    expect(screen.getByLabelText('Invited email')).toHaveValue('');
  });

  test('signs an active root in with a verified platform passkey', async () => {
    const { get } = installWebAuthn();
    const { calls } = installFetch(null);
    renderApp('/');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with passkey' }));

    expect(await screen.findByRole('link', { name: 'Clients' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({
      rpId: 'operator.example.test', userVerification: 'required',
      challenge: expect.any(ArrayBuffer),
    }) }));
    const verification = calls.find(call => call.path === '/auth/passkey/verify-authentication');
    expect(verification?.body).toEqual({ response: expect.objectContaining({
      id: 'credential-a', rawId: 'AQIDBA', type: 'public-key',
      response: expect.objectContaining({
        clientDataJSON: 'BQY', authenticatorData: 'Bwg', signature: 'CQo',
      }),
    }) });
  });

  test('exchanges a root activation grant, registers a passkey, and shows recovery codes once', async () => {
    const { create } = installWebAuthn();
    const { calls } = installFetch(null);
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Root setup or recovery' }));
    await userEvent.type(screen.getByLabelText('Activation grant'), 'a'.repeat(43));
    await userEvent.click(screen.getByRole('button', { name: 'Set up root passkey' }));

    expect(await screen.findByText(`00${'r'.repeat(41)}`)).toBeInTheDocument();
    expect(screen.getByText('root-1')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({
      challenge: expect.any(ArrayBuffer), user: expect.objectContaining({ id: expect.any(ArrayBuffer) }),
    }) }));
    expect(calls).toContainEqual({
      path: '/auth/root/recovery/exchange', method: 'POST', body: { grant: 'a'.repeat(43) },
    });
    expect(calls.some(call => call.path === '/auth/passkey/verify-registration')).toBe(true);
    expect(calls.some(call => call.path === '/auth/root/recovery/rotate-codes')).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain('rrrr');
    expect(JSON.stringify(sessionStorage)).not.toContain('rrrr');

    await userEvent.click(screen.getByLabelText('I have stored these recovery codes securely'));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(screen.queryByText(`00${'r'.repeat(41)}`)).not.toBeInTheDocument();
    expect(screen.getByText('Recovery complete. Sign in with your passkey.')).toBeInTheDocument();
  });

  test('begins active-root recovery with a code and keeps recovery material out of storage', async () => {
    installWebAuthn();
    const { calls } = installFetch(null);
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Root setup or recovery' }));
    await userEvent.type(screen.getByLabelText('Root user id'), 'root-1');
    await userEvent.type(screen.getByLabelText('Recovery code'), 'c'.repeat(43));
    await userEvent.click(screen.getByRole('button', { name: 'Recover root' }));

    expect(await screen.findByText(`00${'r'.repeat(41)}`)).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: '/auth/root/recovery', method: 'POST',
      body: { userId: 'root-1', code: 'c'.repeat(43) },
    });
    expect(JSON.stringify(localStorage)).not.toContain('c'.repeat(43));
    expect(JSON.stringify(sessionStorage)).not.toContain('c'.repeat(43));
  });

  test('shows a safe unavailable state when this browser cannot use passkeys', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: undefined });
    installFetch(null);
    renderApp('/');

    expect(await screen.findByText('Passkeys are not available in this browser.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with passkey' })).toBeDisabled();
  });

  test('gives root a selection-required platform flow, retry, and persistent selected banner', async () => {
    const { calls } = installFetch(sessions.root);
    renderApp('/platform/clients');
    expect(await screen.findByText('Select a client to use merchant settings.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credentials' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry Failed client' }));
    const failedClient = screen.getByText('Failed client').closest('li');
    expect(failedClient).not.toBeNull();
    expect(await within(failedClient as HTMLElement).findByText('Active')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Client name'), 'New Client');
    await userEvent.click(screen.getByRole('button', { name: 'Provision client' }));
    const provisionCall = calls.find(call => call.path === '/operator/v1/platform/clients' && call.method === 'POST');
    expect(provisionCall?.body).toEqual(expect.objectContaining({ name: 'New Client', idempotencyKey: expect.any(String) }));
    expect(provisionCall?.body).not.toEqual(expect.objectContaining({ merchantId: expect.anything() }));

    await userEvent.click(screen.getByRole('button', { name: 'Select Client A' }));
    expect(await screen.findByText('Root access · Client A')).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: '/operator/v1/platform/merchant-selection', method: 'POST',
      body: { merchantId: 'merchant-a' },
    });
  });

  test('never carries merchant A name across an authoritative A to B session refresh', async () => {
    let selectedMerchantId = 'merchant-a';
    let clientReads = 0;
    let rejectMerchantBClients: ((reason?: unknown) => void) | undefined;
    const merchantBClients = new Promise<Response>((_resolve, reject) => {
      rejectMerchantBClients = reject;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      if (path === '/operator/v1/session') return json({
        ...sessions.rootSelected, merchantId: selectedMerchantId,
      });
      if (path === '/operator/v1/platform/merchant-selection') {
        selectedMerchantId = 'merchant-b';
        return new Response(null, { status: 204 });
      }
      if (path === '/operator/v1/platform/clients') {
        clientReads += 1;
        if (clientReads <= 2) return json({ clients: [
          { provisioningId: 'provision-a', merchantId: 'merchant-a', organizationId: 'org-a', name: 'Client A', status: 'active', failedStep: null, retryable: false },
          { provisioningId: 'provision-b', merchantId: 'merchant-b', organizationId: 'org-b', name: 'Client B', status: 'active', failedStep: null, retryable: false },
        ] });
        return merchantBClients;
      }
      throw new Error(`Unexpected BFF call: ${method} ${path}`);
    }));

    renderApp('/platform/clients');
    expect(await screen.findByText('Root access · Client A')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Select Client B' }));
    await waitFor(() => expect(clientReads).toBe(3));
    rejectMerchantBClients?.(new Error('client directory unavailable'));
    expect(await screen.findByText('The operator service is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText('Root access · merchant-b')).toBeInTheDocument();
    expect(screen.queryByText('Root access · Client A')).not.toBeInTheDocument();

    cleanup();
    renderApp('/');
    expect(await screen.findByText('The operator service is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText('Root access · merchant-b')).toBeInTheDocument();
    expect(screen.queryByText('Root access · Client A')).not.toBeInTheDocument();
  });

  test.each([
    ['admin', true, true],
    ['operator', false, false],
    ['viewer', false, false],
  ] as const)('renders permission-derived navigation and actions for %s', async (role, teamVisible, credentialsVisible) => {
    installFetch(sessions[role]);
    renderApp('/');
    await screen.findByText('Demo data');
    expect(screen.queryByRole('link', { name: 'Team' }) !== null).toBe(teamVisible);
    expect(screen.queryByRole('link', { name: 'Credentials' }) !== null).toBe(credentialsVisible);
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem/i })).not.toBeInTheDocument();
  });

  test('denies a non-root direct client route without fetching platform clients', async () => {
    const { calls } = installFetch(sessions.admin);
    renderApp('/platform/clients');

    expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
    expect(calls.some(call => call.path === '/operator/v1/platform/clients')).toBe(false);
  });

  test.each([
    ['/settings/team', '/operator/v1/team'],
    ['/settings/credentials', '/operator/v1/credentials'],
  ] as const)('denies an under-permissioned direct route %s before its BFF fetch', async (path, bffPath) => {
    const { calls } = installFetch(sessions.operator);
    renderApp(path);

    expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
    expect(calls.some(call => call.path === bffPath)).toBe(false);
  });

  test('does not fetch or expose a Promo code or trigger controls without program access', async () => {
    const underPermissioned = {
      ...sessions.viewer,
      permissions: ['schemas:read'],
    };
    const { calls } = installFetch(underPermissioned);
    renderApp('/promo/coded-secret');

    expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
    expect(calls.some(call => call.path === '/operator/v1/programs/coded-secret')).toBe(false);
    expect(screen.queryByText('GATECSECRET')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Automatic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Code-triggered' })).not.toBeInTheDocument();
  });

  test('requires root to select a client before merchant routes and keeps both context markers visible', async () => {
    const { calls } = installFetch(sessions.root);
    renderApp('/affiliates/new');

    expect(await screen.findByText('Root access · No client selected')).toBeInTheDocument();
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(screen.getByText('Select a client before using merchant settings.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Select a client' })).toHaveAttribute('href', '/platform/clients');
    expect(screen.queryByText('New program')).not.toBeInTheDocument();
    expect(calls).toEqual([{ path: '/operator/v1/session', method: 'GET' }]);
  });

  test('shows selected root context on full-screen builders alongside the demo marker', async () => {
    installFetch(sessions.rootSelected);
    renderApp('/affiliates/new');

    expect(await screen.findByText('Root access · Client A')).toBeInTheDocument();
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(screen.getByText('New program')).toBeInTheDocument();
  });

  test.each([
    ['/promo', 'New promo'],
    ['/affiliates', 'New affiliate'],
    ['/referrals', 'New referral'],
    ['/loyalty', 'New loyalty'],
    ['/', 'New program'],
  ] as const)('lets a viewer read %s without exposing program mutation controls', async (path, actionName) => {
    installFetch(sessions.viewer);
    renderApp(path);

    if (path === '/promo') await screen.findByText('No Promos match this filter.');
    else await screen.findByText('Demo data');
    expect(screen.queryByRole('button', { name: new RegExp(actionName, 'i') })).not.toBeInTheDocument();
  });

  test('lets a viewer inspect a draft but not edit it', async () => {
    installFetch(sessions.viewer);
    renderApp('/promo/promo-draft-1');

    expect((await screen.findAllByText('Draft Summer Sale')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  test.each([
    ['/variables', 'New variable', 'Impact customer.country'],
    ['/events', 'New event', 'Edit'],
  ] as const)('lets a viewer inspect %s without local schema mutation controls', async (path, newAction, editAction) => {
    installFetch(sessions.viewer);
    renderApp(path);

    if (path === '/variables') await screen.findByText('Draft version 1');
    else await screen.findByText('Demo data');
    expect(screen.queryByRole('button', { name: new RegExp(newAction, 'i') })).not.toBeInTheDocument();
    if (path === '/variables') {
      expect(screen.getByRole('button', { name: editAction })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save variable' })).not.toBeInTheDocument();
    } else {
      expect(screen.queryByRole('button', { name: editAction })).not.toBeInTheDocument();
    }
  });

  test.each(['/promo/new', '/affiliates/new', '/referrals/new', '/loyalty/new'] as const)(
    'denies a viewer direct builder route %s while retaining its demo marker',
    async path => {
      const { calls } = installFetch(sessions.viewer);
      renderApp(path);

      expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
      if (path === '/promo/new') expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
      else expect(screen.getByText('Demo data')).toBeInTheDocument();
      expect(calls.filter(call => call.method !== 'GET')).toEqual([]);
    },
  );

  test('manages team invitations, retries delivery, roles, removals, and shows conflicts with correlation id', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { calls } = installFetch(sessions.admin, {
      'PATCH /operator/v1/team/members/membership-admin': canonicalError(
        409, 'OPERATION_FAILED', 'The last Admin cannot be demoted', false,
      ),
    });
    renderApp('/settings/team');
    expect(await screen.findByText('new@example.test')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Invite email'), 'other@example.test');
    await userEvent.selectOptions(screen.getByLabelText('Invite role'), 'operator');
    await userEvent.click(screen.getByRole('button', { name: 'Invite user' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry new@example.test' }));
    await userEvent.selectOptions(screen.getByLabelText('Role for viewer@example.test'), 'operator');
    await userEvent.click(screen.getByRole('button', { name: 'Remove viewer@example.test' }));
    await userEvent.selectOptions(screen.getByLabelText('Role for admin@example.test'), 'viewer');
    expect(await screen.findByText('The last Admin cannot be demoted')).toBeInTheDocument();
    expect(screen.getByText('Correlation: corr-ui-error')).toBeInTheDocument();
    expect(calls.some(call => call.path.endsWith('/retry'))).toBe(true);
  });

  test('creates a show-once credential, supports replacement rotation, and revokes immediately without persistence', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { calls } = installFetch(sessions.admin);
    renderApp('/settings/credentials');
    expect(await screen.findByText('Old secret')).toBeInTheDocument();
    expect(screen.getByText('Secret key')).toBeInTheDocument();
    expect(screen.queryByText(`sk_${'a'.repeat(32)}`)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Credential name'), 'Replacement key');
    await userEvent.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(await screen.findByText(`sk_${'a'.repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText('This token is shown once and will be lost when dismissed or you leave this page.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss token' }));
    expect(screen.queryByText(`sk_${'a'.repeat(32)}`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Replace Old secret' }));
    expect(screen.getByLabelText('Credential name')).toHaveValue('Old secret replacement');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Old secret' }));
    expect(calls).toContainEqual({
      path: '/operator/v1/credentials/credential-old', method: 'DELETE',
    });
    expect([...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index) ?? '')))
      .not.toContain(`sk_${'a'.repeat(32)}`);
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index)))
      .not.toContain('session');
    expect(sessionStorage.length).toBe(0);
  });

  test('shows credential operations and submits a policy-safe multi-origin publishable key', async () => {
    const { calls } = installFetch(sessions.admin);
    renderApp('/settings/credentials');
    expect(await screen.findByText('Browser key')).toBeInTheDocument();
    expect(screen.getByText('https://shop.example')).toBeInTheDocument();
    expect(screen.getByText('https://checkout.example')).toBeInTheDocument();
    expect(screen.getByText(/schema:read.*evaluations:write/)).toBeInTheDocument();
    expect(screen.getAllByText(/Created by user-admin/)).toHaveLength(3);
    expect(screen.getByText(/Last used/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Expires /, { selector: 'p' })).toHaveLength(2);

    await userEvent.type(screen.getByLabelText('Credential name'), 'Web storefront');
    await userEvent.selectOptions(screen.getByLabelText('Credential kind'), 'publishable');
    await userEvent.selectOptions(screen.getByLabelText('Credential environment'), 'production');
    expect(screen.getByLabelText('customers:write')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('evaluations:write'));
    await userEvent.type(
      screen.getByLabelText('Allowed exact origins'),
      'https://shop.example\nhttps://checkout.example',
    );
    await userEvent.type(screen.getByLabelText('Expires at'), '2026-12-31T23:59');
    await userEvent.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(screen.getByText(`pk_${'a'.repeat(32)}`)).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: '/operator/v1/credentials', method: 'POST', body: {
        name: 'Web storefront', kind: 'publishable', environment: 'production',
        scopes: ['schema:read', 'evaluations:write'],
        allowedOrigins: ['https://shop.example', 'https://checkout.example'],
        requestsPerMinute: 60, expiresAt: '2026-12-31T23:59:00.000Z',
      },
    });
  });

  test('shows effective expired credentials without active replacement or revocation controls', async () => {
    installFetch(sessions.admin);
    renderApp('/settings/credentials');

    const expired = (await screen.findByText('Expired secret')).closest('li');
    expect(expired).not.toBeNull();
    expect(within(expired as HTMLElement).getByText(/expired · local/i)).toBeInTheDocument();
    expect(within(expired as HTMLElement).queryByRole('button', { name: 'Replace Expired secret' })).not.toBeInTheDocument();
    expect(within(expired as HTMLElement).queryByRole('button', { name: 'Revoke Expired secret' })).not.toBeInTheDocument();
  });

  test.each([
    [401, 'UNAUTHORIZED', 'Authentication is required', 'Work email'],
    [403, 'FORBIDDEN', 'Operation is not permitted', 'You do not have permission to view this page.'],
    [503, 'CORE_UNAVAILABLE', 'Core is temporarily unavailable', 'Try again'],
  ] as const)('handles canonical %i BFF failures without unsafe details', async (status, code, message, expected) => {
    installFetch(sessions.admin, {
      'GET /operator/v1/team': canonicalError(status, code, message, status >= 500),
    });
    renderApp('/settings/team');
    expect(await screen.findByText(expected)).toBeInTheDocument();
    if (status !== 401) expect(screen.getByText('Correlation: corr-ui-error')).toBeInTheDocument();
  });

  test('marks retained demo pages and never sends a production mutation from them', async () => {
    const { calls } = installFetch(sessions.viewer);
    renderApp('/affiliates');
    expect(await screen.findByText('Demo data')).toBeInTheDocument();
    expect(calls.filter(call => call.method !== 'GET')).toEqual([]);
    expect(screen.queryByRole('button', { name: /redeem/i })).not.toBeInTheDocument();
  });

  test('marks a full-screen demo builder and does not call a production mutation', async () => {
    const { calls } = installFetch(sessions.viewer);
    renderApp('/affiliates/new');
    expect(await screen.findByText('Demo data')).toBeInTheDocument();
    expect(calls.filter(call => call.method !== 'GET')).toEqual([]);
  });
});
