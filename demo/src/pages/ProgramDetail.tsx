import { Link, useParams } from 'react-router-dom';
import { useProgramStore } from '../data/store';
import { useVariablesStore } from '../data/variablesStore';
import { TypePill } from '../components/common/TypePill';
import { StatusBadge } from '../components/common/StatusBadge';
import { PageHeader } from '../components/common/PageHeader';
import { ConditionView } from '../components/builder/ConditionView';
import { rewardSummaryFor } from '../lib/rewards';
import { typeToSegment } from '../lib/routes';
import type { Program, Reward } from '../lib/types';

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

  const program: Program | undefined = programs.find(p => p.id === id);

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
            {program.type === 'loyalty' && program.triggerEvent != null && (
              <Row label="Trigger event"><span className="font-mono">{String(program.triggerEvent)}</span></Row>
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
            </tbody>
          </table>
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
      <SectionCard title="Limits &amp; schedule">
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
    </div>
  );
}
