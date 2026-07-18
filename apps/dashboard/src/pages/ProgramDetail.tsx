import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useProgramStore } from '../data/store';
import { useVariablesStore } from '../data/variablesStore';
import { useEventsStore } from '../data/eventsStore';
import { TypePill } from '../components/common/TypePill';
import { StatusBadge } from '../components/common/StatusBadge';
import { PageHeader } from '../components/common/PageHeader';
import { ConditionView } from '../components/builder/ConditionView';
import { rewardSummaryFor } from '../lib/rewards';
import { typeToSegment } from '../lib/routes';
import type { Program, Reward } from '../lib/types';
import { buildCodeRows, toCSV, downloadCSV } from '../lib/codes';
import type { CodeStatus } from '../lib/codes';

function codePrefixFor(program: Program): string {
  const upper = program.name.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const prefix = upper.slice(0, 6);
  return prefix ? prefix + '-' : 'CODE-';
}

const CODE_STATUS_STYLES: Record<CodeStatus, { bg: string; color: string }> = {
  unused:   { bg: 'var(--green-bg, #dcfce7)',   color: 'var(--green, #16a34a)' },
  redeemed: { bg: 'var(--accent-bg, #e8f0fe)',  color: 'var(--accent, #2563eb)' },
  expired:  { bg: 'var(--faint, #f1f5f9)',      color: 'var(--muted, #64748b)' },
};

function CodeStatusBadge({ status }: { status: CodeStatus }) {
  const s = CODE_STATUS_STYLES[status];
  return (
    <span
      className="inline-block px-[8px] py-[2px] rounded-full text-[11px] font-[600]"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--border)]">
      <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)] w-[180px] align-top">{label}</td>
      <td className="py-[8px] text-[var(--ink)]">{children}</td>
    </tr>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[12px] border border-[var(--border)] bg-[var(--panel,#fff)] p-[20px] flex flex-col gap-[12px]"
    >
      <h2 className="text-[14px] font-[700] text-[var(--ink)] m-0">{title}</h2>
      {children}
    </div>
  );
}

export default function ProgramDetail() {
  const { id } = useParams<{ id: string }>();
  const programs = useProgramStore(s => s.programs);
  const variables = useVariablesStore(s => s.variables);
  const events = useEventsStore(s => s.events);

  const program: Program | undefined = programs.find(p => p.id === id);

  const codeRows = useMemo(() => {
    if (!program || program.type !== 'affiliate' || program.codeCount == null) return [];
    return buildCodeRows({
      prefix: codePrefixFor(program),
      length: 5,
      count: Number(program.codeCount),
      usesPerCode: (program.usesPerCode as number | 'unlimited') ?? 1,
    });
  }, [program]);

  if (!program) {
    return (
      <div className="flex flex-col gap-[16px] p-[24px]">
        <p className="text-[var(--ink)] font-[600]">Program not found</p>
        <Link to="/" className="text-[var(--accent)] underline text-[13px]">
          Go home
        </Link>
      </div>
    );
  }

  const segment = typeToSegment(program.type);
  const eligibility = program.eligibility as import('../lib/types').ConditionGroup | undefined;

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Header */}
      <PageHeader
        title={program.name}
        action={
          program.status === 'draft' ? (
            <Link
              to={`/${segment}/${program.id}/edit`}
              className="inline-flex items-center gap-[6px] text-[13px] font-semibold px-[14px] py-[7px] rounded-[8px] bg-[var(--accent)] text-white no-underline"
            >
              Edit
            </Link>
          ) : (
            <span className="text-[13px] text-[var(--muted)] italic">Only drafts can be edited</span>
          )
        }
      />

      {/* Sub-header: type pill, status badge, redemptions */}
      <div className="flex items-center gap-[12px] flex-wrap">
        <TypePill type={program.type} />
        <StatusBadge status={program.status} />
        <span className="text-[13px] text-[var(--muted)]">
          {program.redemptions.toLocaleString()} redemptions
        </span>
      </div>

      {/* Back link */}
      <div>
        <Link to={`/${segment}`} className="text-[13px] text-[var(--accent)] underline">
          ← Back to {segment}
        </Link>
      </div>

      {/* Basics */}
      <SectionCard title="Basics">
        <table className="text-[13px] w-full border-collapse">
          <tbody>
            <Row label="Name">{program.name}</Row>
            {program.type === 'promo' && (
              <>
                {program.code != null && (
                  <Row label="Code"><span className="font-mono">{String(program.code)}</span></Row>
                )}
                {program.autoApply != null && (
                  <Row label="Auto-apply">{program.autoApply ? 'Yes' : 'No'}</Row>
                )}
              </>
            )}
            {program.type === 'affiliate' && program.codeCount != null && (
              <Row label="Code count">{String(program.codeCount)}</Row>
            )}
            {program.type === 'affiliate' && program.usesPerCode != null && (
              <Row label="Uses per code">{String(program.usesPerCode)}</Row>
            )}
            {program.type === 'referral' && (
              <>
                {program.priority != null && (
                  <Row label="Priority">{String(program.priority)}</Row>
                )}
                {program.appliesTo != null && (
                  <Row label="Applies to">{String(program.appliesTo)}</Row>
                )}
              </>
            )}
          </tbody>
        </table>
      </SectionCard>

      {/* Eligibility */}
      {eligibility && (
        <SectionCard title="Eligibility">
          <ConditionView group={eligibility} variables={variables} />
        </SectionCard>
      )}

      {/* Discount / Reward */}
      <SectionCard title={program.type === 'loyalty' ? 'Reward' : 'Discount / Reward'}>
        {program.type === 'referral' ? (
          <table className="text-[13px] w-full border-collapse">
            <tbody>
              {program.referrerReward != null && (
                <Row label="Referrer reward">
                  {rewardSummaryFor(program.referrerReward as Reward)}
                </Row>
              )}
              {program.refereeReward != null && (
                <Row label="Referee reward">
                  {rewardSummaryFor(program.refereeReward as Reward)}
                </Row>
              )}
            </tbody>
          </table>
        ) : program.type === 'loyalty' ? (
          <>
            <table className="text-[13px] w-full border-collapse">
              <tbody>
                {program.triggerEvent != null && (
                  <Row label="Trigger event">
                    <span className="font-mono">{String(program.triggerEvent)}</span>
                  </Row>
                )}
                {program.reward != null && (
                  <Row label="Reward">
                    {rewardSummaryFor(program.reward as Reward)}
                  </Row>
                )}
                <Row label="Stacking">
                  <span className="text-[var(--muted)] italic">No stacking (fixed rule)</span>
                </Row>
              </tbody>
            </table>
            {program.triggerEvent != null && (() => {
              const ev = events.find(e => e.name === String(program.triggerEvent));
              if (!ev || ev.fields.length === 0) return null;
              return (
                <div className="flex flex-col gap-[8px]">
                  <div className="text-[12px] font-[600] text-[var(--muted)] uppercase tracking-wide">
                    Event payload fields
                  </div>
                  <div className="flex flex-wrap gap-[6px]">
                    {ev.fields.map(f => (
                      <span
                        key={f.name}
                        className="inline-flex items-center gap-[5px] px-[10px] py-[4px] rounded-full text-[12px] font-[600]"
                        style={{ background: 'var(--dyn-bg)', color: 'var(--dyn)' }}
                      >
                        <span>{f.name}</span>
                        <span className="font-normal text-[var(--muted)]">{f.type}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <table className="text-[13px] w-full border-collapse">
            <tbody>
              {program.discount != null && (
                <Row label="Discount">
                  {rewardSummaryFor(program.discount as Reward)}
                </Row>
              )}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Limits & schedule */}
      <SectionCard title="Limits & schedule">
        <table className="text-[13px] w-full border-collapse">
          <tbody>
            <Row label="Budget">
              {program.budget != null ? `$${String(program.budget)}` : 'Unlimited'}
            </Row>
            <Row label="Per-customer limit">
              {program.perCustomer != null ? String(program.perCustomer) : 'Unlimited'}
            </Row>
            <Row label="Date window">
              {program.startDate != null || program.endDate != null
                ? `${program.startDate ?? '—'} → ${program.endDate ?? '—'}`
                : '—'}
            </Row>
            {program.type === 'promo' && (
              <Row label="Stackable">
                {program.stackable ? 'Yes' : 'No'}
              </Row>
            )}
          </tbody>
        </table>
      </SectionCard>

      {/* Codes panel — affiliate only, when codeCount is set */}
      {program.type === 'affiliate' && program.codeCount != null && (() => {
        const codeCount = Number(program.codeCount);
        const previewRows = codeRows.slice(0, 50);
        const unusedCount = codeRows.filter(r => r.status === 'unused').length;
        const redeemedCount = codeRows.filter(r => r.status === 'redeemed').length;
        const expiredCount = codeRows.filter(r => r.status === 'expired').length;

        function usesDisplay(row: typeof codeRows[0]): string {
          if (row.usesTotal === 1) return '—';
          if (row.usesTotal === 'unlimited') return `${row.usesUsed}/∞`;
          return `${row.usesUsed}/${row.usesTotal}`;
        }

        return (
          <SectionCard title="Codes">
            {/* Status summary */}
            <p className="text-[13px] text-[var(--muted)] m-0">
              {unusedCount} unused · {redeemedCount} redeemed · {expiredCount} expired
            </p>

            {/* Preview table */}
            <div className="overflow-x-auto">
              <table className="text-[13px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-[6px] pr-[16px] text-left font-[600] text-[var(--muted)]">Code</th>
                    <th className="py-[6px] pr-[16px] text-left font-[600] text-[var(--muted)]">Status</th>
                    <th className="py-[6px] text-left font-[600] text-[var(--muted)]">Uses</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(row => (
                    <tr key={row.code} className="border-b border-[var(--border)]">
                      <td className="py-[6px] pr-[16px] font-mono text-[var(--ink)]">{row.code}</td>
                      <td className="py-[6px] pr-[16px]"><CodeStatusBadge status={row.status} /></td>
                      <td className="py-[6px] text-[var(--ink)]">{usesDisplay(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* "N more" note */}
            {codeCount > 50 && (
              <p className="text-[12px] text-[var(--muted)] italic m-0">
                + {codeCount - 50} more — download the CSV for the full list
              </p>
            )}

            {/* Download CSV */}
            <div>
              <button
                type="button"
                onClick={() => downloadCSV(`${program.id}-codes.csv`, toCSV(codeRows.map(r => r.code)))}
                className="inline-flex items-center gap-[6px] text-[13px] font-semibold px-[14px] py-[7px] rounded-[8px] bg-[var(--accent)] text-white border-0 cursor-pointer"
              >
                ⬇ Download CSV
              </button>
            </div>
          </SectionCard>
        );
      })()}
    </div>
  );
}
