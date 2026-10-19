import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

import App from '../../App';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { TestAuth } from '../../test/TestAuth';
import EvaluationPlayground from './EvaluationPlayground';

const published = { version: 4, publishedAt: '2026-10-14T12:00:00.000Z', jsonSchema: {}, sample: {},
  definitions: [
    { key: 'context.channel', label: 'Channel', source: 'context', type: 'enum', required: true, enumValues: ['web', 'store'] },
    { key: 'cart.gift', label: 'Gift', source: 'cart', type: 'boolean', required: false },
    { key: 'line_item.weight', label: 'Weight', source: 'line_item', type: 'number', required: false },
    { key: 'customer.tier', label: 'Stored tier', source: 'customer', type: 'string', required: false },
  ],
};
const result = { evaluationId: 'eval-authoritative', schemaVersion: 4,
  expiresAt: '2026-10-14T12:05:00.000Z', customerRef: 'customer/opaque', customerVersion: 7,
  decisions: [{ programRef: 'capped-offer', programRevision: 2, programType: 'promo',
    outcome: 'qualified', rewardRuleRef: 'basket-reward', reasonCodes: ['QUALIFIED'],
    effects: [{ type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
      maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 } }], commitRequired: true,
  }], codeResults: [{ code: 'MISSING', normalizedCode: 'MISSING', outcome: 'invalid_code', reasonCodes: ['INVALID_PROMO_CODE'] }],
  priceBreakdown: { currency: 'GBP', originalMerchandiseSubtotal: 10_000,
    discountAllocations: [{ programRef: 'capped-offer', programRevision: 2,
      rewardRuleRef: 'basket-reward', discountMinorUnits: 1_500 }], totalDiscount: 1_500,
    discountedMerchandiseSubtotal: 8_500 },
};
function install(evaluate: () => Promise<Response> = async () => Response.json(result), schema = async () => Response.json(published)) {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (String(path) === '/operator/v1/schema/published') return schema();
    if (String(path) === '/operator/v1/playground/evaluate') {
      calls.push({ path: String(path), body: JSON.parse(String(init?.body)) });
      return evaluate();
    }
    throw new Error('Unexpected browser dependency');
  }));
  return calls;
}
function mount() { render(<TestAuth permissions={['evaluations:run', 'schemas:read']}><EvaluationPlayground /></TestAuth>); }
async function fill() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Product reference 1'), 'product-a');
  await user.clear(screen.getByLabelText('Quantity 1'));
  await user.type(screen.getByLabelText('Quantity 1'), '2');
  await user.type(screen.getByLabelText('Unit price minor units 1'), '5000');
  await user.selectOptions(screen.getByLabelText('Channel (context.channel)'), 'web');
  return user;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Evaluation Playground', () => {
  // Break caught: dropping the canonical response or computing synthetic pricing changes the visible facts.
  test('sends the typed basket and displays authoritative decisions, exact money, versions and expiry', async () => {
    const calls = install(); mount(); const user = await fill();
    expect(screen.queryByLabelText(/Stored tier/u)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Customer reference (optional)'), 'customer/opaque');
    await user.type(screen.getByLabelText('Promo codes (optional)'), 'MISSING');
    await user.selectOptions(screen.getByLabelText('Gift (cart.gift)'), 'false');
    await user.type(screen.getByLabelText('Weight (line_item.weight) — line 1'), '0');
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    await screen.findByRole('heading', { name: 'Evaluation results' });
    expect(calls[0].body).toEqual({ customerRef: 'customer/opaque', codes: ['MISSING'], context: { channel: 'web' },
      cart: { currency: 'GBP', subtotal: 10_000, attributes: { gift: false }, items: [
        { lineRef: 'line-1', productRef: 'product-a', quantity: 2, unitPrice: 5_000, attributes: { weight: 0 } },
      ] } });
    const decision = screen.getByRole('article', { name: 'Promo capped-offer' });
    expect(decision).toHaveTextContent('Revision 2');
    expect(decision).toHaveTextContent('qualified');
    expect(decision).toHaveTextContent('QUALIFIED');
    expect(decision).toHaveTextContent('basket-reward');
    expect(screen.getByText('1500 GBP minor units')).toBeVisible();
    expect(screen.getByText('8500 GBP minor units')).toBeVisible();
    expect(screen.getByText('Customer version 7')).toBeVisible();
    expect(screen.getByText('Schema version 4')).toBeVisible();
    expect(screen.getByText('2026-10-14T12:05:00.000Z')).toBeVisible();
    expect(screen.getByRole('table', { name: 'Code diagnostics' })).toHaveTextContent('INVALID_PROMO_CODE');
    expect(screen.queryByRole('button', { name: /redeem|commit/u })).not.toBeInTheDocument();
  });

  test('clears a result when inputs change and ignores an older in-flight response', async () => {
    let complete!: (value: Response) => void;
    const calls = install(() => new Promise(resolve => { complete = resolve; }));
    mount(); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await user.type(screen.getByLabelText('Promo codes (optional)'), 'changed');
    await act(async () => complete(Response.json(result)));
    expect(screen.queryByRole('heading', { name: 'Evaluation results' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evaluate' })).toBeEnabled();
    install(async () => Response.json({ ...result, customerRef: undefined, customerVersion: undefined }));
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    await screen.findByRole('heading', { name: 'Evaluation results' });
    await user.clear(screen.getByLabelText('Unit price minor units 1'));
    expect(screen.queryByRole('heading', { name: 'Evaluation results' })).not.toBeInTheDocument();
  });

  test('validates required published extensions before dispatch and reports safe downstream errors', async () => {
    const calls = install(async () => Response.json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found',
      correlationId: 'safe-correlation', retryable: false } }, { status: 404 }));
    mount(); const user = await fill();
    await user.selectOptions(screen.getByLabelText('Channel (context.channel)'), '');
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Channel/u);
    expect(calls).toHaveLength(0);
    await user.selectOptions(screen.getByLabelText('Channel (context.channel)'), 'web');
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('safe-correlation');
  });

  test('requires publication and allows retry after safe schema-load failure', async () => {
    install(undefined, async () => Response.json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found',
      correlationId: 'missing-schema', retryable: false } }, { status: 404 }));
    mount();
    await screen.findByText(/Publish a schema/u);
    expect(screen.queryByRole('button', { name: 'Evaluate' })).not.toBeInTheDocument();
    install();
    await userEvent.click(screen.getByRole('button', { name: 'Reload published schema' }));
    await screen.findByLabelText('Product reference 1');
  });

  test('shows empty selection and free shipping without fictional merchandise savings', async () => {
    install(async () => Response.json({ ...result, customerRef: undefined, customerVersion: undefined,
      decisions: [], codeResults: [], priceBreakdown: { currency: 'GBP', originalMerchandiseSubtotal: 10_000,
        discountAllocations: [], totalDiscount: 0, discountedMerchandiseSubtotal: 10_000 } }));
    mount(); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    await screen.findByText('No Promo was selected.');
    expect(screen.getByText('0 GBP minor units')).toBeVisible();
    install(async () => Response.json({ ...result, customerRef: undefined, customerVersion: undefined,
      decisions: [{ ...result.decisions[0], programRef: 'shipping', effects: [{ type: 'free_shipping' }] }],
      priceBreakdown: { currency: 'GBP', originalMerchandiseSubtotal: 10_000,
        discountAllocations: [], totalDiscount: 0, discountedMerchandiseSubtotal: 10_000 } }));
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(await screen.findByRole('article', { name: 'Promo shipping' })).toHaveTextContent('Free shipping');
    expect(screen.getByText('0 GBP minor units')).toBeVisible();
  });

  test('routes allowed evaluators to a live page and hides access for denied principals', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: RequestInfo | URL) => String(path) === '/operator/v1/session'
      ? Response.json({ userId: 'viewer-a', authenticationMethods: ['magic-link'], authenticatedAt: '2026-10-14T12:00:00.000Z',
        merchantId: 'merchant-a', membershipId: 'member-a', organizationId: 'org-a', permissions: ['evaluations:run', 'schemas:read'],
        merchantSelectionRequired: false }) : Response.json(published)));
    const view = render(<ThemeProvider><MemoryRouter initialEntries={['/playground']}><App /></MemoryRouter></ThemeProvider>);
    await screen.findByLabelText('Product reference 1');
    expect(screen.getByRole('link', { name: 'Evaluation Playground' })).toHaveAttribute('href', '/playground');
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
    view.unmount();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ userId: 'denied', authenticationMethods: ['magic-link'],
      authenticatedAt: '2026-10-14T12:00:00.000Z', merchantId: 'merchant-a', permissions: [], merchantSelectionRequired: false })));
    render(<ThemeProvider><MemoryRouter initialEntries={['/playground']}><App /></MemoryRouter></ThemeProvider>);
    await screen.findByText('You do not have permission to view this page.');
    expect(screen.queryByRole('link', { name: 'Evaluation Playground' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Evaluate' })).not.toBeInTheDocument();
  });
});
