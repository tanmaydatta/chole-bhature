import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  let promoCodeConflictNext = false;
  let program: Record<string, any> = programConfiguration();
  let activeProgram: Record<string, any> | null = null;
  let lifecycle = { programRef: program.id, status: 'draft', draftRevision: 1, updatedAt: now } as {
    programRef: string; status: string; activeRevision?: number; draftRevision?: number; updatedAt: string;
  };
  const operatorView = () => ({
    configuration: program,
    ...(activeProgram === null ? {} : { activeConfiguration: activeProgram }),
    ...(lifecycle.draftRevision === undefined ? {} : { draftConfiguration: program }),
    lifecycle,
  });

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
        activeProgram = null;
        lifecycle = { programRef: program.id, status: 'draft', draftRevision: 1, updatedAt: now };
        return response(operatorView(), 201);
      }
      return response({ programs: [operatorView()] });
    }
    if (path === '/operator/v1/programs/gold-launch') {
      if (method === 'PUT') {
        program = body;
        lifecycle = {
          programRef: program.id, status: lifecycle.status,
          activeRevision: lifecycle.activeRevision, draftRevision: 2, updatedAt: now,
        };
        return response(operatorView());
      }
      return response(operatorView());
    }
    if (path === '/operator/v1/programs/gold-launch/publish') {
      if (promoCodeConflictNext) {
        promoCodeConflictNext = false;
        return error(409, 'PROMO_CODE_CONFLICT', 'This code overlaps another published Promo');
      }
      const revision = lifecycle.draftRevision ?? 1;
      lifecycle = {
        programRef: program.id,
        status: program.startDate && program.startDate > '2026-07-20' ? 'scheduled' : lifecycle.status === 'paused' || lifecycle.status === 'ended' ? lifecycle.status : 'active',
        activeRevision: revision, updatedAt: now,
      };
      activeProgram = program;
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
    promoCodeConflictOnce() { promoCodeConflictNext = true; },
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
  test('starts a Promo as a minimal draft and makes trigger mode explicit', async () => {
    const server = installLiveBff();
    renderApp('/promo/new');

    expect(await screen.findByLabelText('External reference')).toBeInTheDocument();
    expect(screen.queryByText('Large basket')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Code-triggered' })).not.toBeChecked();
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stackable')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stacking group')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('External reference'), 'gold-launch');
    await userEvent.type(screen.getByLabelText('Promo name'), 'Gold launch');
    await userEvent.click(screen.getByRole('button', { name: 'Use complete authoring example' }));
    expect(screen.getByDisplayValue('Large basket')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Code-triggered' }));
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Stackable')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Code'), 'GATEC20');
    await userEvent.click(screen.getByLabelText('Stackable'));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole('radio', { name: 'Automatic' }));
    expect(screen.getByRole('radio', { name: 'Code-triggered' })).toBeChecked();
    expect(screen.getByLabelText('Code')).toHaveValue('GATEC20');
    expect(screen.getByLabelText('Stackable')).toBeChecked();

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('radio', { name: 'Automatic' }));
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked();
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stackable')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft revision 1')).toBeInTheDocument();
    const createCall = server.calls.find(call => (
      call.path === '/operator/v1/programs' && call.method === 'POST'
    ));
    expect(createCall?.body).toEqual(expect.objectContaining({
      autoApply: true,
      stackable: false,
    }));
    expect(createCall?.body).not.toHaveProperty('code');
    expect(createCall?.body).not.toHaveProperty('stackingGroup');
  });

  test('shows coded trigger details and reviews, cancels, then explains a publication code conflict', async () => {
    const server = installLiveBff();
    renderApp('/promo/new');

    await userEvent.type(await screen.findByLabelText('External reference'), 'gold-launch');
    await userEvent.type(screen.getByLabelText('Promo name'), 'Gold launch coded');
    await userEvent.click(screen.getByRole('button', { name: 'Use complete authoring example' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Code-triggered' }));
    await userEvent.type(screen.getByLabelText('Code'), 'GATEC20');
    await userEvent.click(screen.getByLabelText('Stackable'));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft revision 1')).toBeInTheDocument();

    cleanup();
    renderApp('/promo');
    const row = (await screen.findByText('Gold launch coded')).closest('tr');
    if (!row) throw new Error('Expected coded Promo list row');
    expect(within(row).getByText('Code-triggered')).toBeInTheDocument();
    await userEvent.click(row);

    expect(await screen.findByText('Draft revision 1')).toBeInTheDocument();
    expect(screen.getByText('Code-triggered')).toBeInTheDocument();
    expect(screen.getByText('GATEC20')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('20% off order')).toBeInTheDocument();
    expect(screen.getByText(/"basisPoints": 2000/u)).toBeInTheDocument();

    const publishCalls = () => server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch/publish' && call.method === 'POST'
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
    const review = (await screen.findByRole('heading', { name: 'Review publication' }))
      .closest<HTMLElement>('[role="dialog"]');
    if (!review) throw new Error('Expected publication review dialog');
    expect(within(review).getByText('Trigger: Code-triggered')).toBeInTheDocument();
    expect(within(review).getByText('GATEC20')).toBeInTheDocument();
    expect(within(review).getByText('Stackable: Yes')).toBeInTheDocument();
    expect(publishCalls()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel publication' }));
    expect(screen.queryByRole('heading', { name: 'Review publication' })).not.toBeInTheDocument();
    expect(publishCalls()).toHaveLength(0);

    server.promoCodeConflictOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm publish' }));
    expect(await screen.findByText(/another published Promo already uses this code/iu)).toBeInTheDocument();
    expect(screen.getByText(/Change the code or schedule/u)).toBeInTheDocument();
    expect(publishCalls()).toHaveLength(1);
  });

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
    await waitFor(() => expect(
      server.calls.some(call => (
        call.path === '/operator/v1/schema/definitions' && call.method === 'GET'
      )),
    ).toBe(true));
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
    const publishesBeforeReview = server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch/publish' && call.method === 'POST'
    )).length;
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
    expect(await screen.findByRole('heading', { name: 'Review publication' })).toBeInTheDocument();
    expect(screen.getByText('Trigger: Automatic')).toBeInTheDocument();
    expect(screen.getByText('Priority: 10')).toBeInTheDocument();
    expect(screen.getByText('Draft revision: 1')).toBeInTheDocument();
    expect(screen.getByText('Active revision: none')).toBeInTheDocument();
    expect(server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch/publish' && call.method === 'POST'
    ))).toHaveLength(publishesBeforeReview);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm publish' }));
    expect(await screen.findByText('Active revision 1')).toBeInTheDocument();
    expect(server.calls.filter(call => (
      call.path === '/operator/v1/programs/gold-launch' && call.method === 'GET'
    ))).toHaveLength(readsBeforePublish + 1);
    expect(screen.getByText(/may overlap/i)).toBeInTheDocument();

    cleanup();
    renderApp('/promo');
    const row = await screen.findByText('Gold launch');
    expect(within(row.closest('tr')!).getByText('Automatic')).toBeInTheDocument();
    await userEvent.click(row.closest('tr')!);
    expect(await screen.findByText('Active revision 1')).toBeInTheDocument();
    expect(screen.getByText('Trigger')).toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: 'Active configuration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Draft configuration' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish revision' }));
    expect(await screen.findByRole('heading', { name: 'Review publication' })).toBeInTheDocument();
    expect(screen.getByText('Active revision: 1')).toBeInTheDocument();
    expect(screen.getByText('Draft revision: 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm publish' }));
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

  test('creates a conditional free-shipping Promo without a monetary budget', async () => {
    const server = installLiveBff();
    renderApp('/promo/new');
    await userEvent.type(await screen.findByLabelText('External reference'), 'gold-launch');
    await userEvent.type(screen.getByLabelText('Promo name'), 'Free shipping');
    await userEvent.click(screen.getByRole('button', { name: 'Use complete authoring example' }));

    await userEvent.selectOptions(screen.getAllByLabelText('Reward type')[0]!, 'free_shipping');
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove rule' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Remove fallback' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove budget' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const created = server.calls.find(call => (
      call.path === '/operator/v1/programs' && call.method === 'POST'
    ));
    expect(created?.body).toMatchObject({
      id: 'gold-launch',
      rewardRules: [{ reward: { type: 'free_shipping' } }],
    });
    expect(created?.body).not.toHaveProperty('budget');
  });

  test('identifies an invalid budget field instead of relying on the generic form error', async () => {
    installLiveBff();
    renderApp('/promo/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Use complete authoring example' }));

    await userEvent.clear(screen.getByLabelText('Budget currency'));

    expect(screen.getByText('Budget currency must be exactly three uppercase letters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  test('identifies the free-shipping budget conflict before submission', async () => {
    installLiveBff();
    renderApp('/promo/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Use complete authoring example' }));

    await userEvent.selectOptions(screen.getAllByLabelText('Reward type')[0]!, 'free_shipping');

    expect(screen.getByText('Remove the monetary budget before saving a free-shipping reward.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
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

  test('renders unresolved conditions and blocks saving incompatible existing drafts', async () => {
    const invalid = {
      ...programConfiguration('Legacy Promo'),
      eligibility: { match: 'ALL', conditions: [
        { id: 'deprecated', variable: 'customer.deprecated', operator: 'eq', value: 'legacy' },
        { id: 'incompatible', variable: 'context.channel', operator: 'gt', value: 'store' },
      ] },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/operator/v1/session') return response(session);
      if (path === '/operator/v1/schema/definitions') return response({
        definitions: workingDefinitions, draftVersion: 1, publishedVersion: 1,
      });
      if (path === '/operator/v1/programs/gold-launch') return response({
        configuration: invalid,
        activeConfiguration: {
          ...programConfiguration('Active Promo'),
          status: 'active',
        },
        draftConfiguration: invalid,
        lifecycle: { programRef: 'gold-launch', status: 'active', activeRevision: 1, draftRevision: 2, updatedAt: now },
      });
      throw new Error(`Unexpected ${path}`);
    }));

    renderApp('/promo/gold-launch/edit');
    expect(await screen.findByText('Missing variable definition for customer.deprecated.')).toBeInTheDocument();
    expect(screen.getByText('Operator “gt” is not valid for context.channel.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  test.each([
    [409, 'PROGRAM_CONFLICT', 'The program state conflicts', false],
    [503, 'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true],
    [401, 'UNAUTHORIZED', 'Authentication is required', false],
  ] as const)('keeps the authored draft mounted after %s %s save responses', async (status, code, message, retryable) => {
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      if (path === '/operator/v1/session') return response(session);
      if (path === '/operator/v1/schema/definitions') return response({
        definitions: workingDefinitions, draftVersion: 1, publishedVersion: 1,
      });
      if (path === '/operator/v1/programs/gold-launch' && method === 'GET') return response({
        configuration: programConfiguration('Server Promo'),
        activeConfiguration: {
          ...programConfiguration('Active Promo'),
          status: 'active',
        },
        draftConfiguration: programConfiguration('Server Promo'),
        lifecycle: { programRef: 'gold-launch', status: 'active', activeRevision: 1, draftRevision: 2, updatedAt: now },
      });
      if (path === '/operator/v1/programs/gold-launch' && method === 'PUT') {
        puts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return error(status, code, message, retryable);
      }
      throw new Error(`Unexpected ${method} ${path}`);
    }));

    renderApp('/promo/gold-launch/edit');
    const name = await screen.findByLabelText('Promo name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Unsaved authored Promo');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(`Code: ${code}`)).toBeInTheDocument();
    expect(screen.getByText(`Retryable: ${retryable ? 'yes' : 'no'}`)).toBeInTheDocument();
    expect(screen.getByText('Correlation: corr-live-error')).toBeInTheDocument();
    expect(screen.getByLabelText('Promo name')).toHaveValue('Unsaved authored Promo');
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload server version for comparison' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(puts).toHaveLength(2);
    expect(puts[0]).toMatchObject({ name: 'Unsaved authored Promo' });
    expect(puts[1]).toMatchObject({ name: 'Unsaved authored Promo' });
    await userEvent.click(screen.getByRole('button', { name: 'Reload server version for comparison' }));
    expect(await screen.findByText('Server Promo', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Promo name')).toHaveValue('Unsaved authored Promo');
  });

  test('compares a create-mode conflict by the submitted external reference without replacing the draft', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      calls.push({ path, method, ...(body ? { body } : {}) });
      if (path === '/operator/v1/session') return response(session);
      if (path === '/operator/v1/schema/definitions') return response({
        definitions: workingDefinitions, draftVersion: 1, publishedVersion: 1,
      });
      if (path === '/operator/v1/programs' && method === 'POST') {
        return error(409, 'PROGRAM_CONFLICT', 'The program state conflicts');
      }
      if (path === '/operator/v1/programs/existing-ref' && method === 'GET') return response({
        configuration: { ...programConfiguration('Existing server Promo'), id: 'existing-ref' },
        draftConfiguration: { ...programConfiguration('Existing server Promo'), id: 'existing-ref' },
        lifecycle: { programRef: 'existing-ref', status: 'draft', draftRevision: 1, updatedAt: now },
      });
      throw new Error(`Unexpected ${method} ${path}`);
    }));

    renderApp('/promo/new');
    await userEvent.type(await screen.findByLabelText('External reference'), 'existing-ref');
    await userEvent.type(screen.getByLabelText('Promo name'), 'Unsaved create Promo');
    await userEvent.click(screen.getByRole('button', { name: 'Use complete authoring example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('The program state conflicts')).toBeInTheDocument();
    expect(screen.getByLabelText('External reference')).toHaveValue('existing-ref');
    expect(screen.getByLabelText('Promo name')).toHaveValue('Unsaved create Promo');
    expect(screen.getByRole('button', { name: 'Reload server version for comparison' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reload server version for comparison' }));
    expect(await screen.findByText('Existing server Promo', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByLabelText('External reference')).toHaveValue('existing-ref');
    expect(screen.getByLabelText('Promo name')).toHaveValue('Unsaved create Promo');
    expect(calls).toContainEqual({ path: '/operator/v1/programs/existing-ref', method: 'GET' });
    expect(calls.find(call => call.path === '/operator/v1/programs' && call.method === 'POST')?.body)
      .toMatchObject({ id: 'existing-ref', name: 'Unsaved create Promo' });
  });

  test('keeps lookup loading owned by the newest overlapping exact-customer request', async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    let resolveNew: ((response: Response) => void) | undefined;
    const oldRequest = new Promise<Response>(resolve => { resolveOld = resolve; });
    const newRequest = new Promise<Response>(resolve => { resolveNew = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/operator/v1/session') return response(session);
      if (path === '/operator/v1/schema/published') return response({
        version: 1, publishedAt: now, definitions: publishedDefinitions, jsonSchema: {}, sample: {},
      });
      if (path === '/operator/v1/customers/customer-old') return oldRequest;
      if (path === '/operator/v1/customers/customer-new') return newRequest;
      throw new Error(`Unexpected ${path}`);
    }));

    renderApp('/customers');
    const reference = await screen.findByLabelText('Customer reference');
    await userEvent.type(reference, 'customer-old');
    await userEvent.click(screen.getByRole('button', { name: 'Look up customer' }));
    expect(screen.getByRole('button', { name: 'Look up customer' })).toBeDisabled();

    await userEvent.clear(reference);
    await userEvent.type(reference, 'customer-new');
    expect(screen.getByRole('button', { name: 'Look up customer' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Look up customer' }));
    resolveOld?.(error(404, 'NOT_FOUND', 'The requested resource was not found'));
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Look up customer' })).toBeDisabled();
    expect(screen.queryByText('No customer exists for this exact reference.')).not.toBeInTheDocument();

    resolveNew?.(error(404, 'NOT_FOUND', 'The requested resource was not found'));
    expect(await screen.findByText('No customer exists for this exact reference.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up customer' })).toBeEnabled();
  });
});
