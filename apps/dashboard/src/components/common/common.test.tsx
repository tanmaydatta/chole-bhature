import { render, screen, fireEvent } from '@testing-library/react';
import { TypePill } from './TypePill';
import { StatusBadge } from './StatusBadge';
import { SegmentedFilter } from './SegmentedFilter';
import { PageHeader } from './PageHeader';
import { DataTable } from './DataTable';

test('TypePill type="promo" renders text "Promo"', () => {
  render(<TypePill type="promo" />);
  expect(screen.getByText('Promo')).toBeInTheDocument();
});

test('StatusBadge status="paused" renders "Paused"', () => {
  render(<StatusBadge status="paused" />);
  expect(screen.getByText('Paused')).toBeInTheDocument();
});

test('SegmentedFilter clicking option fires onChange with label', () => {
  const onChange = vi.fn();
  const options = [{ label: 'All', count: 10 }, { label: 'Active', count: 3 }];
  render(<SegmentedFilter options={options} value="All" onChange={onChange} />);
  fireEvent.click(screen.getByText('Active'));
  expect(onChange).toHaveBeenCalledWith('Active');
});

test('PageHeader root is full width so the action right-aligns', () => {
  const { container } = render(<PageHeader title="X" action={<button>＋ New</button>} />);
  const root = container.firstChild as HTMLElement;
  expect(root.className).toContain('w-full');
  expect(root.className).toContain('justify-between');
});

test('DataTable fires onRowClick with the row index', () => {
  const onRowClick = vi.fn();
  render(<DataTable columns={[{ key: 'name', header: 'Name' }]} rows={[{ name: 'A' }, { name: 'B' }]} onRowClick={onRowClick} />);
  fireEvent.click(screen.getByText('B').closest('tr')!);
  expect(onRowClick).toHaveBeenCalledWith(1);
});
