import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import LivePromoDetail from './LivePromoDetail';

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
    rewardRules: [
      {
        id: 'rule-1',
        name: 'Order discount',
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
    rewardRules: [
      {
        id: 'rule-1',
        name: 'Order discount',
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

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

describe('LivePromoDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders styled header with edit action and configuration card', async () => {
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
});
