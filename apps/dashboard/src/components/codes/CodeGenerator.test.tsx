import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CodeGenerator } from './CodeGenerator';
import AffiliateCreate from '../../pages/affiliate/AffiliateCreate';
import { ToastProvider } from '../../components/common/Toast';

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

  it('calls downloadCSV with a codes-only CSV containing 25 data rows after clicking Download CSV', async () => {
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

    // Check the CSV content: codes-only (header "code" + 25 code lines)
    const [filename, csv] = (downloadCSV as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filename).toBe('acme-affiliate-codes.csv');
    const lines = (csv as string).trim().split('\n');
    // 1 header + 25 data rows = 26 lines
    expect(lines).toHaveLength(26);
    expect(lines[0]).toBe('code');
    // Each data row is just a code string (no commas)
    const dataRows = lines.slice(1);
    expect(dataRows.every(r => r.length > 0 && !r.includes(','))).toBe(true);
  });

  it('downloads a codes-only CSV after selecting "Up to 5 uses"', async () => {
    const user = userEvent.setup();
    render(<CodeGenerator />);

    const countInput = screen.getByLabelText(/how many codes/i);
    await user.clear(countInput);
    await user.type(countInput, '25');

    // Select "Up to 5 uses"
    const usesSelect = screen.getByLabelText(/uses per code/i);
    await user.selectOptions(usesSelect, 'up-to-5');

    await user.click(screen.getByRole('button', { name: /generate codes/i }));
    await user.click(screen.getByRole('button', { name: /download csv/i }));

    const [, csv] = (downloadCSV as ReturnType<typeof vi.fn>).mock.calls[0];
    const lines = (csv as string).trim().split('\n');
    expect(lines[0]).toBe('code');
    const dataRows = lines.slice(1);
    expect(dataRows).toHaveLength(25);
    expect(dataRows.every(r => r.length > 0 && !r.includes(','))).toBe(true);
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
      <ToastProvider>
        <MemoryRouter>
          <AffiliateCreate />
        </MemoryRouter>
      </ToastProvider>
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
