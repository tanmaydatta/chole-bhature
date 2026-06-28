import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateFlowShell } from '../../components/flow/CreateFlowShell';
import { ConditionBuilder } from '../../components/builder/ConditionBuilder';
import { DualRewardEditor } from '../../components/rewards/DualRewardEditor';
import { useProgramStore } from '../../data/store';
import { useToast } from '../../components/common/Toast';
import { VARIABLES } from '../../data/variables';
import { TYPE_META } from '../../lib/types';
import { rewardSummaryFor } from '../../lib/rewards';
import type { ConditionGroup, Program, Reward, Status } from '../../lib/types';

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'limits', label: 'Limits & schedule' },
  { key: 'review', label: 'Review' },
];

const STEP_KEYS = STEPS.map(s => s.key);

export default function ReferralCreate() {
  const navigate = useNavigate();
  const addProgram = useProgramStore(s => s.addProgram);
  const programs = useProgramStore(s => s.programs);
  const { toast } = useToast();

  // Step state
  const [activeStep, setActiveStep] = useState('basics');

  // Basics
  const [name, setName] = useState('');

  // Eligibility
  const [eligibility, setEligibility] = useState<ConditionGroup>({
    match: 'ALL',
    conditions: [],
  });

  // Rewards
  const [referrerReward, setReferrerReward] = useState<Reward>({ kind: 'credit', value: 10 });
  const [refereeReward, setRefereeReward] = useState<Reward>({ kind: 'fixed', value: 10 });

  // Limits & schedule
  const [budget, setBudget] = useState<number | ''>('');
  const [perCustomer, setPerCustomer] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  function handleContinue() {
    const idx = STEP_KEYS.indexOf(activeStep);
    if (idx < STEP_KEYS.length - 1) {
      setActiveStep(STEP_KEYS[idx + 1]);
    }
  }

  function handleBack() {
    const idx = STEP_KEYS.indexOf(activeStep);
    if (idx === 0) {
      navigate('/referrals');
    } else {
      setActiveStep(STEP_KEYS[idx - 1]);
    }
  }

  function handleCancel() {
    navigate('/referrals');
  }

  function buildProgram(status: Status): Program {
    const id = `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Compute next priority (max existing referral priority + 1)
    const referralPrograms = programs.filter(p => p.type === 'referral');
    const maxPriority = referralPrograms.reduce((max, p) => {
      const pri = typeof p.priority === 'number' ? p.priority : 0;
      return Math.max(max, pri);
    }, 0);
    const priority = maxPriority + 1;

    const referrerSummary = rewardSummaryFor(referrerReward);
    const refereeSummary = rewardSummaryFor(refereeReward);
    const rewardSummary = `${referrerSummary} / ${refereeSummary}`;

    const condCount = eligibility.conditions.length;
    const appliesToStr = condCount > 0 ? `${condCount} condition(s)` : 'all customers';
    const subtitle = `Priority ${priority} · ${appliesToStr}`;

    return {
      id,
      name: name || 'Untitled referral',
      type: 'referral',
      status,
      rewardSummary,
      redemptions: 0,
      priority,
      referrerReward,
      refereeReward,
      appliesTo: appliesToStr,
      subtitle,
      eligibility,
      budget: budget === '' ? undefined : budget,
      perCustomer: perCustomer === '' ? undefined : perCustomer,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }

  function handleSaveDraft() {
    addProgram(buildProgram('draft'));
    toast('Draft saved');
    navigate('/referrals');
  }

  function handleCreate() {
    addProgram(buildProgram('active'));
    toast('Referral created');
    navigate('/referrals');
  }

  const isReview = activeStep === 'review';

  return (
    <CreateFlowShell
      typeMeta={TYPE_META.referral}
      steps={STEPS}
      activeStep={activeStep}
      onStep={setActiveStep}
      onContinue={isReview ? undefined : handleContinue}
      onBack={handleBack}
      onCancel={handleCancel}
      onSaveDraft={handleSaveDraft}
      footer={
        isReview ? (
          <div className="flex justify-end">
            <button
              className="px-[20px] py-[10px] rounded-[9px] font-[700] text-[14px] text-white cursor-pointer border-none"
              style={{ background: 'var(--accent)' }}
              onClick={handleCreate}
            >
              Create
            </button>
          </div>
        ) : undefined
      }
    >
      {activeStep === 'basics' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Basics</h2>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="referral-name" className="text-[13px] font-[600] text-[var(--muted)]">
              Program name
            </label>
            <input
              id="referral-name"
              type="text"
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-full"
              placeholder="e.g. Give $10, Get $10"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
        </div>
      )}

      {activeStep === 'eligibility' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Eligibility</h2>
          <ConditionBuilder
            value={eligibility}
            variables={VARIABLES}
            onChange={setEligibility}
          />
        </div>
      )}

      {activeStep === 'rewards' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Rewards</h2>
          <DualRewardEditor
            referrer={referrerReward}
            referee={refereeReward}
            onChange={({ referrer, referee }) => {
              setReferrerReward(referrer);
              setRefereeReward(referee);
            }}
          />
        </div>
      )}

      {activeStep === 'limits' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Limits &amp; schedule</h2>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="budget" className="text-[13px] font-[600] text-[var(--muted)]">
              Budget ($)
            </label>
            <input
              id="budget"
              type="number"
              min={0}
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-[200px]"
              placeholder="Unlimited"
              value={budget}
              onChange={e => setBudget(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="per-customer" className="text-[13px] font-[600] text-[var(--muted)]">
              Per-customer limit
            </label>
            <input
              id="per-customer"
              type="number"
              min={0}
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-[200px]"
              placeholder="Unlimited"
              value={perCustomer}
              onChange={e => setPerCustomer(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div className="flex gap-[16px] flex-wrap">
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="start-date" className="text-[13px] font-[600] text-[var(--muted)]">
                Start date
              </label>
              <input
                id="start-date"
                type="date"
                className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)]"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="end-date" className="text-[13px] font-[600] text-[var(--muted)]">
                End date
              </label>
              <input
                id="end-date"
                type="date"
                className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)]"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {activeStep === 'review' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Review</h2>
          <table className="text-[13px] w-full border-collapse">
            <tbody>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)] w-[160px]">Name</td>
                <td className="py-[8px] text-[var(--ink)]">{name || '—'}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Eligibility</td>
                <td className="py-[8px] text-[var(--ink)]">
                  {eligibility.conditions.length > 0
                    ? `${eligibility.conditions.length} condition(s) · match ${eligibility.match}`
                    : 'All customers'}
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Referrer reward</td>
                <td className="py-[8px] text-[var(--ink)]">{rewardSummaryFor(referrerReward)}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Referee reward</td>
                <td className="py-[8px] text-[var(--ink)]">{rewardSummaryFor(refereeReward)}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Budget</td>
                <td className="py-[8px] text-[var(--ink)]">{budget !== '' ? `$${budget}` : 'Unlimited'}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Per-customer limit</td>
                <td className="py-[8px] text-[var(--ink)]">{perCustomer !== '' ? perCustomer : 'Unlimited'}</td>
              </tr>
              <tr>
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Date window</td>
                <td className="py-[8px] text-[var(--ink)]">
                  {startDate || endDate ? `${startDate || '—'} → ${endDate || '—'}` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </CreateFlowShell>
  );
}
