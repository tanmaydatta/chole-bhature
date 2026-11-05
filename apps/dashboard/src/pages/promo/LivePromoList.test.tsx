import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import LivePromoList from './LivePromoList';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockPrograms = [
  {
    configuration: { id: 'promo-1', name: 'Summer Promo', autoApply: true, startDate: '2026-06-01' },
    lifecycle: { programRef: 'promo-1', status: 'active', activeRevision: 1, updatedAt: '2026-06-01' },
  },
  {
    configuration: { id: 'promo-2', name: 'Winter Promo', autoApply: false, code: 'WINTER', startDate: '2026-12-01' },
    lifecycle: { programRef: 'promo-2', status: 'draft', draftRevision: 1, updatedAt: '2026-06-01' },
  },
];

vi.mock('../../data/program-api', () => ({
  programApi: {
    list: vi.fn(async () => ({ programs: mockPrograms })),
  },
}));

const mockAuth = {
  hasPermission: (p: string) => p === 'programs:manage',
  handleError: (e: any) => e,
};

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

describe('LivePromoList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders page header with action button, table, and navigates on row click', async () => {
    render(
      <MemoryRouter>
        <LivePromoList />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Promo Codes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New promo/i })).toHaveAttribute('href', '/promo/new');
    expect(screen.getByText('Summer Promo')).toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
    expect(screen.getByText('Active revision 1')).toBeInTheDocument();

    const summerRow = screen.getByText('Summer Promo').closest('tr');
    expect(summerRow).toBeInTheDocument();
    fireEvent.click(summerRow!);
    expect(mockNavigate).toHaveBeenCalledWith('/promo/promo-1');
  });

  test('filters promotions by status and shows empty state if none match', async () => {
    render(
      <MemoryRouter>
        <LivePromoList />
      </MemoryRouter>
    );

    expect(await screen.findByText('Summer Promo')).toBeInTheDocument();
    expect(screen.getByText('Winter Promo')).toBeInTheDocument();

    const statusSelect = screen.getByRole('combobox');
    fireEvent.change(statusSelect, { target: { value: 'paused' } });

    expect(screen.getByText('No Promos match this filter.')).toBeInTheDocument();
    expect(screen.queryByText('Summer Promo')).not.toBeInTheDocument();
  });
});
