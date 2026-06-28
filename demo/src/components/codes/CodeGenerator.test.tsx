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

import { downloadCSV, toCSV } from '../../lib/codes';

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
    // Default "Single use" → every data row carries uses_left = 1
    const dataRows = lines.slice(1);
    expect(dataRows.every(r => /,unused,1$/.test(r))).toBe(true);
  });

  it('downloads a CSV with uses_left = 5 after selecting "Up to 5 uses"', async () => {
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
    const dataRows = (csv as string).trim().split('\n').slice(1);
    expect(dataRows).toHaveLength(25);
    expect(dataRows.every(r => /,unused,5$/.test(r))).toBe(true);
    // At least one concrete data row matches the expected mapping
    expect(dataRows[0]).toMatch(/,unused,5$/);
  });

  it('toCSV maps the uses-per-code option to the correct uses_left column', () => {
    expect(toCSV(['ACME-1'], 1)).toMatch(/,unused,1$/);
    expect(toCSV(['ACME-1'], 5)).toMatch(/,unused,5$/);
    expect(toCSV(['ACME-1'], '∞')).toMatch(/,unused,∞$/);
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
