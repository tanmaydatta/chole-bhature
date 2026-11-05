import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import LivePromoDetail from './LivePromoDetail';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';

const mockProgramView = {
  configuration: {
    id: 'gold-launch',
    name: 'Gold Launch Promo',
    autoApply: false,
    code: 'GOLD20',
    priority: 10,
    stackable: true,
    startDate: '2026-06-01',
    endDate: '2026-12-31',
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'c1', variable: 'customer.tier', operator: 'eq', value: 'gold' },
      ],
    },
    rewardRules: [
      {
        id: 'rule-1',
        name: 'Order discount',
        conditions: { match: 'ALL', conditions: [] },
        reward: { type: 'order_discount', calculation: 'percent', basisPoints: 2000 },
      },
    ],
  },
  draftConfiguration: {
    id: 'gold-launch',
    name: 'Gold Launch Promo',
    autoApply: false,
    code: 'GOLD20',
    priority: 10,
    stackable: true,
    startDate: '2026-06-01',
    endDate: '2026-12-31',
    eligibility: {
      match: 'ALL',
      conditions: [
        { id: 'c1', variable: 'customer.tier', operator: 'eq', value: 'gold' },
      ],
    },
    rewardRules: [
      {
        id: 'rule-1',
        name: 'Order discount',
        conditions: { match: 'ALL', conditions: [] },
        reward: { type: 'order_discount', calculation: 'percent', basisPoints: 2000 },
      },
    ],
  },
  lifecycle: {
    programRef: 'gold-launch',
    status: 'draft',
    draftRevision: 1,
    updatedAt: '2026-06-01',
  },
};

const mockAuth = {
  hasPermission: () => true,
  handleError: (e: any) => e,
};

vi.mock('../../data/program-api', () => ({
  programApi: {
    get: vi.fn(async () => mockProgramView),
    publish: vi.fn(async () => ({ warnings: [] })),
  },
}));

vi.mock('../../data/schema-api', () => ({
  schemaApi: {
    list: vi.fn(async () => ({
      definitions: [
        {
          definition: {
            key: 'customer.tier',
            type: 'enum',
            source: 'customer',
            enumValues: ['gold', 'silver'],
            defaultErrorMessage: "This code isn't valid for your order.",
          },
        },
      ],
    })),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

describe('LivePromoDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders styled header with edit action and configuration card with eligibility', async () => {
    render(
      <MemoryRouter initialEntries={['/promo/gold-launch']}>
        <Routes>
          <Route path="/promo/:id" element={<LivePromoDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Gold Launch Promo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Promo' })).toHaveAttribute('href', '/promo/gold-launch/edit');
    expect(screen.getByRole('button', { name: 'Publish revision' })).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Eligibility' })).toBeInTheDocument();
    expect(screen.getByText('customer.tier')).toBeInTheDocument();
    expect(screen.getByText('gold')).toBeInTheDocument();
    expect(screen.getByText('GOLD20')).toBeInTheDocument();
    expect(screen.getByText('20% off order')).toBeInTheDocument();
  });

  test('opens and cancels review publication dialog', async () => {
    render(
      <MemoryRouter initialEntries={['/promo/gold-launch']}>
        <Routes>
          <Route path="/promo/:id" element={<LivePromoDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const publishBtn = await screen.findByRole('button', { name: 'Publish revision' });
    fireEvent.click(publishBtn);

    expect(screen.getByRole('heading', { name: 'Review publication' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel publication' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel publication' }));
    expect(screen.queryByRole('heading', { name: 'Review publication' })).not.toBeInTheDocument();
  });

  test('review publication dialog has aria-labelledby and handles Escape key', async () => {
    render(
      <MemoryRouter initialEntries={['/promo/gold-launch']}>
        <Routes>
          <Route path="/promo/:id" element={<LivePromoDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const publishBtn = await screen.findByRole('button', { name: 'Publish revision' });
    fireEvent.click(publishBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'review-pub-heading');
    expect(screen.getByRole('heading', { name: 'Review publication' })).toHaveAttribute('id', 'review-pub-heading');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('displays error inside review publication dialog when publish fails', async () => {
    const error = new BffClientError(409, 'PROMO_CODE_CONFLICT', 'Code conflict', false, 'conflict');
    vi.mocked(programApi.publish).mockRejectedValueOnce(error);

    render(
      <MemoryRouter initialEntries={['/promo/gold-launch']}>
        <Routes>
          <Route path="/promo/:id" element={<LivePromoDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const publishBtn = await screen.findByRole('button', { name: 'Publish revision' });
    fireEvent.click(publishBtn);

    const confirmBtn = screen.getByRole('button', { name: 'Confirm publish' });
    fireEvent.click(confirmBtn);

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/another published promo already uses this code/i)).toBeInTheDocument();
  });
});
