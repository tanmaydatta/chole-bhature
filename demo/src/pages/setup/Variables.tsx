import { useState, Fragment } from 'react';
import type { Origin, Variable } from '../../lib/types';
import { useVariablesStore } from '../../data/variablesStore';
import { PageHeader } from '../../components/common/PageHeader';
import { SegmentedFilter } from '../../components/common/SegmentedFilter';

type FilterOption = 'All' | 'User attributes' | 'Dynamic' | 'System';

const ORIGIN_ORDER: Origin[] = ['user', 'dynamic', 'system'];

interface OriginMeta {
  label: string;
  groupHeader: string;
  badgeClass: string;
  badgeLabel: string;
  swatchClass: string;
}

const ORIGIN_META: Record<Origin, OriginMeta> = {
  user: {
    label: 'User attributes',
    groupHeader: 'User attributes · persistent, tied to the customer',
    badgeClass: 'text-[var(--user)] bg-[var(--user-bg)]',
    badgeLabel: 'User attr',
    swatchClass: 'bg-[var(--user)]',
  },
  dynamic: {
    label: 'Dynamic',
    groupHeader: 'Dynamic / context · passed in per request',
    badgeClass: 'text-[var(--dyn)] bg-[var(--dyn-bg)]',
    badgeLabel: 'Dynamic',
    swatchClass: 'bg-[var(--dyn)]',
  },
  system: {
    label: 'System',
    groupHeader: 'System · provided by us 🔒',
    badgeClass: 'text-[var(--sys)] bg-[var(--sys-bg)]',
    badgeLabel: 'System',
    swatchClass: 'bg-[var(--sys)]',
  },
};

const FILTER_TO_ORIGINS: Record<FilterOption, Origin[] | null> = {
  All: null,
  'User attributes': ['user'],
  Dynamic: ['dynamic'],
  System: ['system'],
};

function typeLabel(v: Variable): string {
  if (v.type === 'enum' && v.enumValues) {
    return `enum · ${v.enumValues.join('/')}`;
  }
  return v.type;
}

export default function Variables() {
  const variables = useVariablesStore(s => s.variables);
  const [filter, setFilter] = useState<FilterOption>('All');

  const userCount = variables.filter((v) => v.origin === 'user').length;
  const dynCount = variables.filter((v) => v.origin === 'dynamic').length;
  const sysCount = variables.filter((v) => v.origin === 'system').length;

  const filterOptions = [
    { label: 'All', count: variables.length },
    { label: 'User attributes', count: userCount },
    { label: 'Dynamic', count: dynCount },
    { label: 'System', count: sysCount },
  ];

  const allowedOrigins = FILTER_TO_ORIGINS[filter];

  const visibleOrigins = allowedOrigins
    ? ORIGIN_ORDER.filter((o) => allowedOrigins.includes(o))
    : ORIGIN_ORDER;

  return (
    <div>
      <div className="mb-4">
        <PageHeader
          title="Variables"
          action={
            <button className="border-none px-[14px] py-[8px] rounded-[8px] font-semibold text-[13px] cursor-pointer bg-[var(--accent)] text-white">
              ＋ New variable
            </button>
          }
        />
      </div>

      <p className="text-[var(--muted)] text-[13px] mb-4 max-w-[760px]">
        Variables are the building blocks for every condition, reward, and event payload. Each can carry a{' '}
        <strong>default error message</strong> that conditions inherit unless overridden.
      </p>

      <div className="mb-[14px]">
        <SegmentedFilter
          options={filterOptions}
          value={filter}
          onChange={(label) => setFilter(label as FilterOption)}
        />
      </div>

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[12px] overflow-hidden shadow-[var(--shadow)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[16px] py-[11px] border-b border-[var(--border)]">
                Variable
              </th>
              <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[16px] py-[11px] border-b border-[var(--border)]">
                Type
              </th>
              <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[16px] py-[11px] border-b border-[var(--border)]">
                Origin
              </th>
              <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[16px] py-[11px] border-b border-[var(--border)]">
                Default error message
              </th>
              <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[16px] py-[11px] border-b border-[var(--border)]">
                Used in
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleOrigins.map((origin) => {
              const meta = ORIGIN_META[origin];
              const rows = variables.filter((v) => v.origin === origin);
              if (rows.length === 0) return null;
              return (
                <Fragment key={origin}>
                  <tr>
                    <td
                      colSpan={5}
                      className="bg-[var(--bg)] text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold px-[16px] py-[10px] border-b border-[var(--border)]"
                    >
                      {meta.groupHeader}
                    </td>
                  </tr>
                  {rows.map((v) => (
                    <tr
                      key={v.name}
                      className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]"
                    >
                      <td className="px-[16px] py-[12px] align-middle">
                        <div className="flex items-center gap-[7px] font-[650]">
                          <span
                            className={`w-[8px] h-[8px] rounded-[2px] flex-shrink-0 ${meta.swatchClass}`}
                          />
                          {v.name}
                          {v.readOnly && (
                            <span title="Read-only" className="text-[var(--faint)] text-[12px]">
                              🔒
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-[16px] py-[12px] align-middle text-[12.5px] text-[var(--muted)]">
                        {typeLabel(v)}
                      </td>
                      <td className="px-[16px] py-[12px] align-middle">
                        <span
                          className={`text-[11px] font-bold px-[9px] py-[2px] rounded-full ${meta.badgeClass}`}
                        >
                          {meta.badgeLabel}
                        </span>
                      </td>
                      <td className="px-[16px] py-[12px] align-middle">
                        {v.defaultMessage ? (
                          <span className="text-[12.5px] text-[var(--ink)]">
                            &ldquo;{v.defaultMessage}&rdquo;
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-[var(--faint)] italic">—</span>
                        )}
                      </td>
                      <td className="px-[16px] py-[12px] align-middle text-[12.5px] text-[var(--muted)] tabular-nums">
                        {v.origin === 'system' ? (
                          'auto'
                        ) : v.usedIn !== undefined ? (
                          `${v.usedIn} programs`
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[var(--muted)] text-[12.5px] mt-[13px]">
        System variables are read-only (we maintain them) but usable in any condition — that&apos;s how budgets, caps,
        per-customer limits and date windows work.
      </p>
    </div>
  );
}
