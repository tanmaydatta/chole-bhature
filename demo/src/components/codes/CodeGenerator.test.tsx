import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CodeGenerator } from './CodeGenerator';
import AffiliateCreate from '../../pages/affiliate/AffiliateCreate';

// Mock only downloadCSV, keep generateCodes/toCSV/previewExample real
vi.mock('../../lib/codes', async () => {
  const actual = await vi.importActual<typeof import('../../lib/codes')>('../../lib/codes');
  return {
    ...actual,
    downloadCSV: vi.fn(),
  };
});

import { downloadCSV } from '../../lib/codes';

describe('CodeGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows 8 preview rows + "+ 17 more" after generating 25 codes', async () => {
    const user = userEvent.setup();
    render(<CodeGenerator />);

    // Set count to 25
    const countInput = screen.getByLabelText(/how many codes/i);
    await user.clear(countInput);
    await user.type(countInput, '25');

    // Click Generate
    const generateBtn = screen.getByRole('button', { name: /generate codes/i });
    await user.click(generateBtn);

    // Preview should show 8 code rows
    const rows = screen.getAllByRole('row');
    // 1 header row + 8 code rows = 9
    expect(rows).toHaveLength(9);

    // Should show "+ 17 more" text
    expect(screen.getByText(/\+\s*17 more/i)).toBeInTheDocument();
  });

  it('calls downloadCSV with a CSV containing 25 data rows after clicking Download CSV', async () => {
    const user = userEvent.setup();
    render(<CodeGenerator />);

    // Set count to 25
    const countInput = screen.getByLabelText(/how many codes/i);
    await user.clear(countInput);
    await user.type(countInput, '25');

    // Generate first
    const generateBtn = screen.getByRole('button', { name: /generate codes/i });
    await user.click(generateBtn);

    // Download CSV button should now be enabled
    const downloadBtn = screen.getByRole('button', { name: /download csv/i });
    expect(downloadBtn).not.toBeDisabled();

    await user.click(downloadBtn);

    // downloadCSV should have been called
    expect(downloadCSV).toHaveBeenCalledTimes(1);

    // Check the CSV content has 25 data rows (header + 25 rows)
    const [filename, csv] = (downloadCSV as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filename).toBe('acme-affiliate-codes.csv');
    const lines = (csv as string).trim().split('\n');
    // 1 header + 25 data rows = 26 lines
    expect(lines).toHaveLength(26);
    expect(lines[0]).toBe('code,status,uses_left');
  });

  it('Download CSV button is disabled before generating', async () => {
    render(<CodeGenerator />);
    const downloadBtn = screen.getByRole('button', { name: /download csv/i });
    expect(downloadBtn).toBeDisabled();
  });
});

describe('AffiliateCreate smoke test', () => {
  it('renders the steps rail including "Generate codes"', () => {
    render(
      <MemoryRouter>
        <AffiliateCreate />
      </MemoryRouter>
    );
    // Steps rail renders all step labels
    expect(screen.getByText('Generate codes')).toBeInTheDocument();
    // Basics appears as both step label and page heading — just check at least one exists
    expect(screen.getAllByText('Basics').length).toBeGreaterThan(0);
    expect(screen.getByText('Eligibility')).toBeInTheDocument();
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText('Limits & schedule')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });
});
