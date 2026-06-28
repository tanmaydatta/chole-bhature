import type React from 'react';

interface Column {
  key: string;
  header: string;
}

interface DataTableProps {
  columns: Column[];
  rows: Record<string, React.ReactNode>[];
}

export function DataTable({ columns, rows }: DataTableProps) {
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[12px] overflow-hidden shadow-[var(--shadow)]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left text-[11px] tracking-[0.05em] uppercase text-[var(--faint)] font-semibold px-[16px] py-[11px] border-b border-[var(--border)]"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="group">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-[16px] py-[13px] border-b border-[var(--border)] text-[var(--ink)] last-of-type:border-b-0 group-last:border-b-0 group-hover:bg-[var(--hover)]"
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
