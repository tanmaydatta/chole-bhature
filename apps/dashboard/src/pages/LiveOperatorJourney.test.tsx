import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import App from '../App';
import { ToastProvider } from '../components/common/Toast';
import { ThemeProvider } from '../theme/ThemeProvider';

const permissions = [
  'members:read', 'members:manage', 'schemas:read', 'schemas:manage', 'schemas:publish',
  'customers:read', 'customers:manage', 'programs:read', 'programs:manage',
  'programs:publish', 'evaluations:run', 'credentials:read', 'credentials:manage', 'audit:read',
];
const session = {
  userId: 'admin-a', authenticationMethods: ['magic-link'],
  authenticatedAt: '2026-07-20T10:00:00.000Z', organizationId: 'org-a',
  merchantId: 'merchant-a', membershipId: 'membership-a', permissions,
  merchantSelectionRequired: false,
};
const publishedDefinitions = [
  { key: 'customer.age', label: 'Age', source: 'customer', type: 'number', required: true },
  { key: 'customer.active', label: 'Active', source: 'customer', type: 'boolean', required: true },
  { key: 'customer.tier', label: 'Tier', source: 'customer', type: 'enum', required: true, enumValues: ['gold', 'silver'] },
  { key: 'customer.birthday', label: 'Birthday', source: 'customer', type: 'date', required: true },
  { key: 'customer.note', label: 'Note', source: 'customer', type: 'string', required: false },
  { key: 'context.channel', label: 'Channel', source: 'context', type: 'string', required: false },
] as const;
const workingDefinitions = [
  ...publishedDefinitions.map((definition, index) => ({
    id: `definition-${index}`, definition, readOnly: false, referenced: false,
  })),
  {
    id: 'builtin-cart-subtotal',
    definition: { key: 'cart.subtotal', label: 'Cart subtotal', source: 'cart', type: 'number', required: true },
    readOnly: true,
    referenced: false,
  },
  {
    id: 'definition-draft-context-locale',
    definition: { key: 'context.locale', label: 'Locale', source: 'context', type: 'string', required: false },
    readOnly: false,
    referenced: false,
  },
  {
    id: 'definition-event-order-created',
    definition: { key: 'event.order_created', label: 'Order created', source: 'event', type: 'boolean', required: false },
    readOnly: false,
    referenced: false,
  },
];
const now = '2026-07-20T10:00:00.000Z';

function response(value: unknown, status = 200, correlationId = 'corr-live') {
  return Response.json(value, { status, headers: { 'x-correlation-id': correlationId } });
}

function error(status: number, code: string, message: string, retryable = false) {
  return response({ error: { code, message, retryable, correlationId: 'corr-live-error' } }, status);
}

function programConfiguration(revisionName = 'Gold launch') {
  return {
    id: 'gold-launch', type: 'promo', name: revisionName, status: 'draft',
    eligibility: { match: 'ALL', conditions: [] },
    rewardRules: [{
      id: 'rule-one', name: 'Large basket',
      conditions: { match: 'ALL', conditions: [{
        id: 'large-basket', variable: 'cart.subtotal', operator: 'gte', value: 10_000,
      }] },
      reward: { type: 'order_discount', calculation: 'percent', basisPoints: 2_000 },
    }, {
      id: 'rule-two', name: 'Gold customer',
      conditions: { match: 'ANY', conditions: [], groups: [{ match: 'ALL', conditions: [{
        id: 'gold-tier', variable: 'customer.tier', operator: 'eq', value: 'gold',
      }] }] },
      reward: {
        type: 'line_item_discount', productRef: 'product-a', calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 500 },
      },
    }],
    fallbackReward: {
      id: 'fallback', name: 'Fallback discount',
      reward: {
        type: 'order_discount', calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 250 },
      },
    },
    budget: { currency: 'GBP', minorUnits: 50_000 }, usageCap: 100,
    perCustomerCap: 2, stackable: false, priority: 10, autoApply: true,
  } as const;
}

function installLiveBff() {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  let definitions = workingDefinitions;
  let draftVersion = 1;
  let publishedVersion: number | undefined;
  let customer: null | { externalRef: string; attributes: Record<string, unknown>; version: number; updatedAt: string } = null;
  let conflictNext = false;
  let program: Record<string, any> = programConfiguration();
  let lifecycle = { programRef: program.id, status: 'draft', draftRevision: 1, updatedAt: now } as {
    programRef: string; status: string; activeRevision?: number; draftRevision?: number; updatedAt: string;
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, ...(body === undefined ? {} : { body }) });
    if (path === '/operator/v1/session') return response(session);
    if (path === '/operator/v1/schema/definitions') {
      if (method === 'POST') {
        const view = { id: 'definition-new', definition: body, readOnly: false, referenced: false };
        definitions = [...definitions, view];
        draftVersion = 2;
        return response(view, 201);
      }
      return response({ definitions, draftVersion, ...(publishedVersion === undefined ? {} : { publishedVersion }) });
    }
    if (path === '/operator/v1/schema/definitions/definition-new/impact') return response({
      publishedVersions: [], referencedProgramRefs: [], storedCustomerCount: 0,
      incompatibleCustomerCount: 0, warnings: [{
        code: 'REQUIRED_LIVE_FIELD', message: 'Required live field context.device may break integrations',
      }],
    });
    if (path === '/operator/v1/schema/publish') {
      publishedVersion = 1;
      return response({
        version: 1, publishedAt: now, definitions: publishedDefinitions,
        jsonSchema: {}, sample: {}, warnings: [{
          code: 'REQUIRED_LIVE_FIELD', message: 'Required live fields affect integrations',
        }],
      });
    }
    if (path === '/operator/v1/schema/published') return response({
      version: 1, publishedAt: now, definitions: publishedDefinitions, jsonSchema: {}, sample: {},
    });
    if (path === '/operator/v1/customers/customer%2Fopaque') {
      if (method === 'GET') return customer ? response(customer) : error(404, 'NOT_FOUND', 'The requested resource was not found');
      if (conflictNext) {
        conflictNext = false;
        return error(409, 'VERSION_CONFLICT', 'The submitted version conflicts');
      }
      customer = {
        externalRef: 'customer/opaque', attributes: body.attributes,
        version: customer ? customer.version + 1 : 1, updatedAt: now,
      };
      return response(customer);
    }
    if (path === '/operator/v1/programs') {
      if (method === 'POST') {
        program = body;
        lifecycle = { programRef: program.id, status: 'draft', draftRevision: 1, updatedAt: now };
        return response({ configuration: program, lifecycle }, 201);
      }
      return response({ programs: [{ configuration: program, lifecycle }] });
    }
    if (path === '/operator/v1/programs/gold-launch') {
      if (method === 'PUT') {
        program = body;
        lifecycle = {
          programRef: program.id, status: lifecycle.status,
          activeRevision: lifecycle.activeRevision, draftRevision: 2, updatedAt: now,
        };
        return response({ configuration: program, lifecycle });
      }
      return response({ configuration: program, lifecycle });
    }
    if (path === '/operator/v1/programs/gold-launch/publish') {
      const revision = lifecycle.draftRevision ?? 1;
      lifecycle = {
        programRef: program.id,
        status: program.startDate && program.startDate > '2026-07-20' ? 'scheduled' : lifecycle.status === 'paused' || lifecycle.status === 'ended' ? lifecycle.status : 'active',
        activeRevision: revision, updatedAt: now,
      };
      program = { ...program, status: lifecycle.status };
      return response({ ...lifecycle, warnings: [{
        code: 'OVERLAPPING_REWARD_RULES', message: 'Two reward rules may overlap',
      }] });
    }
    for (const action of ['pause', 'resume', 'end'] as const) {
      if (path === `/operator/v1/programs/gold-launch/${action}`) {
        lifecycle = {
          ...lifecycle,
          status: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'ended',
          updatedAt: now,
        };
        if (lifecycle.draftRevision === undefined) program = { ...program, status: lifecycle.status };
        return response(lifecycle);
      }
    }
    throw new Error(`Unexpected live BFF call: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    conflictOnce() { conflictNext = true; },
    currentProgram() { return { program, lifecycle }; },
  };
}

function renderApp(path: string) {
  return render(
    <ThemeProvider><ToastProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></ToastProvider></ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live operator authoring journey', () => {
  test('defines and publishes schema, then creates and version-updates one exact typed customer', async () => {
    const server = installLiveBff();
    renderApp('/variables');
    expect(await screen.findByText('Draft version 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New variable' }));
    await userEvent.type(screen.getByLabelText('Key'), 'context.device');
    await userEvent.type(screen.getByLabelText('Label'), 'Device');
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'context');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'string');
    await userEvent.click(screen.getByLabelText('Required'));
    await userEvent.click(screen.getByRole('button', { name: 'Save variable' }));
    expect(server.calls).toContainEqual({
      path: '/operator/v1/schema/definitions', method: 'POST',
      body: { key: 'context.device', label: 'Device', source: 'context', type: 'string', required: true },
    });
    expect(await screen.findByText('Draft version 2')).toBeInTheDocument();
    expect(server.calls.filter(call => call.path === '/operator/v1/schema/definitions' && call.method === 'GET')).toHaveLength(2);
    await userEvent.click(await screen.findByRole('button', { name: 'Impact context.device' }));
    expect(await screen.findByText(/may break integrations/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish schema' }));
    expect(await screen.findByText('Published version 1')).toBeInTheDocument();
    expect(screen.getByText(/affect integrations/i)).toBeInTheDocument();

    cleanup();
    renderApp('/customers');
    await userEvent.type(await screen.findByLabelText('Customer reference'), 'customer/opaque');
    await userEvent.click(screen.getByRole('button', { name: 'Look up customer' }));
    expect(await screen.findByText('No customer exists for this exact reference.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Age'));
    await userEvent.type(screen.getByLabelText('Age'), '42');
    await userEvent.selectOptions(screen.getByLabelText('Active'), 'true');
    await userEvent.selectOptions(screen.getByLabelText('Tier'), 'gold');
    await userEvent.type(screen.getByLabelText('Birthday'), '1990-01-02');
    await userEvent.type(screen.getByLabelText('Note'), 'Opaque support note');
    await userEvent.click(screen.getByRole('button', { name: 'Create customer' }));
    expect(await screen.findByText('Version 1')).toBeInTheDocument();
    expect(server.calls).toContainEqual({
      path: '/operator/v1/customers/customer%2Fopaque', method: 'PATCH', body: {
        attributes: { age: 42, active: true, tier: 'gold', birthday: '1990-01-02', note: 'Opaque support note' },
      },
    });

    await userEvent.clear(screen.getByLabelText('Age'));
    await userEvent.type(screen.getByLabelText('Age'), '43');
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(server.calls).toContainEqual(expect.objectContaining({
      path: '/operator/v1/customers/customer%2Fopaque', method: 'PATCH',
      body: expect.objectContaining({ expectedVersion: 1, attributes: expect.objectContaining({ age: 43 }) }),
    }));

    server.conflictOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('The submitted version conflicts')).toBeInTheDocument();
    expect(screen.getByText('Correlation: corr-live-error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh customer' }));
    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(JSON.stringify(Object.fromEntries(Object.entries(localStorage)))).not.toMatch(/customer\/opaque|Opaque support note/);
    expect(JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))).not.toMatch(/customer\/opaque|Opaque support note/);
  });

  test('publishes Promo revision 1, refreshes, edits the same logical Promo as revision 2, and controls lifecycle', async () => {
    const server = installLiveBff();
    renderApp('/promo/new');
    expect(await screen.findByLabelText('External reference')).toBeInTheDocument();
    expect(server.calls.some(call => call.path === '/operator/v1/schema/definitions' && call.method === 'GET')).toBe(true);
    expect(server.calls.some(call => call.path === '/operator/v1/schema/published')).toBe(false);
    await userEvent.click(screen.getAllByText('＋ Add condition')[0]!);
    expect(screen.getByText('cart.subtotal')).toBeInTheDocument();
    expect(screen.getByText('context.locale')).toBeInTheDocument();
    expect(screen.queryByText('event.order_created')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByText('＋ Add condition')[0]!);
    await userEvent.type(await screen.findByLabelText('External reference'), 'gold-launch');
    await userEvent.type(screen.getByLabelText('Promo name'), 'Gold launch');
    await userEvent.click(screen.getByRole('button', { name: 'Use complete authoring example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft revision 1')).toBeInTheDocument();
    const created = server.calls.find(call => call.path === '/operator/v1/programs' && call.method === 'POST');
    if (!created) throw new Error('Expected the draft creation call');
    expect(created.body).toMatchObject({
      id: 'gold-launch', status: 'draft',
      eligibility: { match: 'ALL' },
      rewardRules: [
        { id: expect.any(String), reward: { basisPoints: 2_000 } },
        { id: expect.any(String), reward: { amount: { currency: 'GBP', minorUnits: 500 } } },
      ],
      fallbackReward: {
        id: expect.any(String),
        reward: {
          type: 'order_discount', calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 250 },
        },
      },
      budget: { currency: 'GBP', minorUnits: 50_000 },
    });
    const createdProgram = created.body as ReturnType<typeof programConfiguration>;
    const createdRuleIds = createdProgram.rewardRules.map(rule => rule.id);
    const createdFallbackId = createdProgram.fallbackReward.id;
    expect(new Set([...createdRuleIds, createdFallbackId]).size).toBe(3);
    expect(screen.queryByRole('textbox', { name: 'Rule id' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Fallback id' })).not.toBeInTheDocument();
    const readsBeforePublish = server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    )).length;
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
    expect(await screen.findByText('Active revision 1')).toBeInTheDocument();
    expect(server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    ))).toHaveLength(readsBeforePublish + 1);
    expect(screen.getByText(/may overlap/i)).toBeInTheDocument();

    cleanup();
    renderApp('/promo');
    const row = await screen.findByText('Gold launch');
    await userEvent.click(row.closest('tr')!);
    expect(await screen.findByText('Active revision 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Edit Promo' }));
    expect(await screen.findByLabelText('Promo name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use complete authoring example' })).not.toBeInTheDocument();
    await userEvent.clear(await screen.findByLabelText('Promo name'));
    await userEvent.type(screen.getByLabelText('Promo name'), 'Gold launch revision 2');
    await userEvent.click(screen.getByRole('button', { name: 'Move reward rule 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft revision 2')).toBeInTheDocument();
    expect(screen.getByText('Active revision 1')).toBeInTheDocument();
    expect(server.currentProgram().program.id).toBe('gold-launch');
    expect(server.currentProgram().program.rewardRules.map((rule: { id: string }) => rule.id)).toEqual([...createdRuleIds].reverse());
    expect(server.currentProgram().program.fallbackReward.id).toBe(createdFallbackId);

    cleanup();
    renderApp('/promo');
    expect(await screen.findByText('Active revision 1')).toBeInTheDocument();
    expect(screen.getByText('Draft revision 2')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Gold launch revision 2').closest('tr')!);
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
    expect(await screen.findByText('Active revision 2')).toBeInTheDocument();

    const readsBeforePause = server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    )).length;
    await userEvent.click(screen.getByRole('button', { name: 'Pause Promo' }));
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    ))).toHaveLength(readsBeforePause + 1);
    await userEvent.click(screen.getByRole('button', { name: 'Resume Promo' }));
    expect(await screen.findByText('Active', { selector: 'span' })).toBeInTheDocument();
    const readsBeforeEnd = server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    )).length;
    await userEvent.click(screen.getByRole('button', { name: 'End Promo' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/cannot be undone/i));
    expect(await screen.findByText('Ended')).toBeInTheDocument();
    expect(server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    ))).toHaveLength(readsBeforeEnd + 1);
    expect(screen.queryByRole('button', { name: 'Resume Promo' })).not.toBeInTheDocument();
  });

  test('switches rule and fallback reward selectors to canonical free shipping', async () => {
    installLiveBff();
    renderApp('/promo/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Use complete authoring example' }));
    const ruleType = screen.getAllByLabelText('Reward type')[0]!;
    const fallbackType = screen.getByLabelText('Fallback type');
    await userEvent.selectOptions(
      ruleType,
      within(ruleType).getByRole('option', { name: 'Free shipping' }),
    );
    await userEvent.selectOptions(
      fallbackType,
      within(fallbackType).getByRole('option', { name: 'Free shipping' }),
    );

    expect(ruleType).toHaveValue('free_shipping');
    expect(fallbackType).toHaveValue('free_shipping');
    expect(screen.getAllByText('Free shipping has no amount fields.')).toHaveLength(2);
  });

  test('shows schema impact before choosing delete or deprecate, then reloads canonical versions', async () => {
    const calls: Array<{ path: string; method: string }> = [];
    let removed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ path, method });
      if (path === '/operator/v1/session') return response(session);
      if (path === '/operator/v1/schema/definitions' && method === 'GET') return response({
        definitions: removed ? [] : [{
          id: 'definition-published',
          definition: { key: 'customer.legacy', label: 'Legacy', source: 'customer', type: 'string', required: false },
          readOnly: false,
          referenced: false,
        }],
        draftVersion: removed ? 2 : 1,
        publishedVersion: 1,
      });
      if (path === '/operator/v1/schema/definitions/definition-published/impact') return response({
        publishedVersions: [1], referencedProgramRefs: [], storedCustomerCount: 0,
        incompatibleCustomerCount: 0, warnings: [],
      });
      if (path === '/operator/v1/schema/definitions/definition-published/deprecate' && method === 'POST') {
        removed = true;
        return response(null);
      }
      throw new Error(`Unexpected ${method} ${path}`);
    }));

    renderApp('/variables');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Published versions: 1.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm deprecate customer.legacy' })).toBeInTheDocument();
    expect(calls.some(call => call.path.endsWith('/deprecate'))).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm deprecate customer.legacy' }));
    expect(calls).toContainEqual({
      path: '/operator/v1/schema/definitions/definition-published/deprecate', method: 'POST',
    });
    expect(await screen.findByText('Draft version 2')).toBeInTheDocument();
  });

  test('requires every typed customer select and binds saving to the last exact lookup', async () => {
    const server = installLiveBff();
    renderApp('/customers');
    await userEvent.type(await screen.findByLabelText('Customer reference'), 'customer/opaque');
    await userEvent.click(screen.getByRole('button', { name: 'Look up customer' }));
    expect(await screen.findByText('No customer exists for this exact reference.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Age'), '42');
    await userEvent.selectOptions(screen.getByLabelText('Tier'), 'gold');
    await userEvent.type(screen.getByLabelText('Birthday'), '1990-01-02');
    await userEvent.click(screen.getByRole('button', { name: 'Create customer' }));
    expect(await screen.findByText('Complete all required customer fields.')).toBeInTheDocument();
    expect(server.calls.some(call => call.method === 'PATCH')).toBe(false);

    await userEvent.selectOptions(screen.getByLabelText('Active'), 'false');
    await userEvent.type(screen.getByLabelText('Customer reference'), '-changed');
    expect(screen.queryByText('No customer exists for this exact reference.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create customer' })).not.toBeInTheDocument();
    expect(server.calls.some(call => call.method === 'PATCH')).toBe(false);
  });

  test('guards live reads before fetch and keeps retained modules demo-only', async () => {
    const viewer = { ...session, userId: 'viewer', permissions: ['schemas:read', 'programs:read', 'evaluations:run'] };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === '/operator/v1/session') return response(viewer);
      if (path === '/operator/v1/programs') return response({ programs: [] });
      throw new Error(`Unexpected ${path}`);
    }));
    renderApp('/customers');
    expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
    expect(calls).toEqual(['/operator/v1/session']);

    cleanup();
    calls.length = 0;
    renderApp('/affiliates');
    expect(await screen.findByText('Demo data')).toBeInTheDocument();
    expect(calls).toEqual(['/operator/v1/session']);
    expect(screen.queryByRole('button', { name: /^(Publish revision|Pause Promo|End Promo|Save draft|Save customer)$/i })).not.toBeInTheDocument();
  });

  test('shows retryable, forbidden, missing, and malformed-success states with correlation', async () => {
    for (const [status, code, message] of [
      [401, 'UNAUTHORIZED', 'Authentication is required'],
      [403, 'FORBIDDEN', 'Operation is not permitted'],
      [503, 'CORE_UNAVAILABLE', 'Core is temporarily unavailable'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/operator/v1/session') return response(session);
        return error(status, code, message, status === 503);
      }));
      renderApp('/promo');
      if (status === 401) expect(await screen.findByLabelText('Work email')).toBeInTheDocument();
      else {
        expect(await screen.findByText(status === 403 ? 'You do not have permission to view this page.' : message)).toBeInTheDocument();
        expect(screen.getByText('Correlation: corr-live-error')).toBeInTheDocument();
      }
      cleanup();
      vi.unstubAllGlobals();
    }

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/operator/v1/session'
        ? response(session)
        : response({ programs: [{ configuration: { unsafe: true } }] }, 200, 'corr-malformed')
    )));
    renderApp('/promo');
    expect(await screen.findByText('The operator service returned an invalid response')).toBeInTheDocument();
    expect(screen.getByText('Correlation: corr-malformed')).toBeInTheDocument();
  });
});
