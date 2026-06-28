import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateFlowShell } from '../../components/flow/CreateFlowShell';
import { ConditionBuilder } from '../../components/builder/ConditionBuilder';
import { RewardEditor } from '../../components/rewards/RewardEditor';
import { useProgramStore } from '../../data/store';
import { useToast } from '../../components/common/Toast';
import { VARIABLES } from '../../data/variables';
import { TYPE_META } from '../../lib/types';
import { rewardSummaryFor } from '../../lib/rewards';
import type { ConditionGroup, Program, Reward, Status } from '../../lib/types';

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'discount', label: 'Discount' },
  { key: 'limits', label: 'Limits & schedule' },
  { key: 'review', label: 'Review' },
];

const STEP_KEYS = STEPS.map(s => s.key);

export default function PromoCreate() {
  const navigate = useNavigate();
  const addProgram = useProgramStore(s => s.addProgram);
  const { toast } = useToast();

  // Step state
  const [activeStep, setActiveStep] = useState('basics');

  // Basics
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [autoApply, setAutoApply] = useState(false);

  // Eligibility
  const [eligibility, setEligibility] = useState<ConditionGroup>({
    match: 'ALL',
    conditions: [],
  });

  // Discount
  const [discount, setDiscount] = useState<Reward>({ kind: 'percent', value: 15 });

  // Limits & schedule
  const [budget, setBudget] = useState<number | ''>('');
  const [perCustomer, setPerCustomer] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stackable, setStackable] = useState(false);

  function handleContinue() {
    const idx = STEP_KEYS.indexOf(activeStep);
    if (idx < STEP_KEYS.length - 1) {
      setActiveStep(STEP_KEYS[idx + 1]);
    }
  }

  function handleBack() {
    const idx = STEP_KEYS.indexOf(activeStep);
    if (idx === 0) {
      navigate('/promo');
    } else {
      setActiveStep(STEP_KEYS[idx - 1]);
    }
  }

  function handleCancel() {
    navigate('/promo');
  }

  function buildProgram(status: Status): Program {
    const id = `promo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const condCount = eligibility.conditions.length;
    const subtitle =
      condCount > 0
        ? `${condCount} condition${condCount !== 1 ? 's' : ''}`
        : budget
          ? `Budget $${budget}`
          : undefined;

    return {
      id,
      name: name || code || 'Untitled promo',
      type: 'promo',
      status,
      rewardSummary: rewardSummaryFor(discount),
      redemptions: 0,
      code: code || undefined,
      autoApply,
      stackable,
      subtitle,
      eligibility,
    };
  }

  function handleSaveDraft() {
    addProgram(buildProgram('draft'));
    toast('Draft saved');
    navigate('/promo');
  }

  function handleCreate() {
    addProgram(buildProgram('active'));
    toast('Promo created');
    navigate('/promo');
  }

  const isReview = activeStep === 'review';

  return (
    <CreateFlowShell
      typeMeta={TYPE_META.promo}
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
            <label htmlFor="promo-name" className="text-[13px] font-[600] text-[var(--muted)]">
              Promo name
            </label>
            <input
              id="promo-name"
              type="text"
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-full"
              placeholder="e.g. SUMMER15"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="promo-code" className="text-[13px] font-[600] text-[var(--muted)]">
              Code
            </label>
            <input
              id="promo-code"
              type="text"
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-full font-mono uppercase"
              placeholder="e.g. SAVE20"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="flex items-center gap-[10px]">
            <input
              id="auto-apply"
              type="checkbox"
              className="w-[16px] h-[16px] cursor-pointer"
              checked={autoApply}
              onChange={e => setAutoApply(e.target.checked)}
            />
            <label htmlFor="auto-apply" className="text-[13px] font-[600] text-[var(--ink)] cursor-pointer">
              Auto-apply
            </label>
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

      {activeStep === 'discount' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Discount</h2>
          <RewardEditor value={discount} onChange={setDiscount} />
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
          <div className="flex items-center gap-[10px]">
            <input
              id="stacking"
              type="checkbox"
              className="w-[16px] h-[16px] cursor-pointer"
              checked={stackable}
              onChange={e => setStackable(e.target.checked)}
            />
            <label htmlFor="stacking" className="text-[13px] font-[600] text-[var(--ink)] cursor-pointer">
              Stacking allowed
            </label>
          </div>
        </div>
      )}

      {activeStep === 'review' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Review</h2>
          <table className="text-[13px] w-full border-collapse">
            <tbody>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)] w-[150px]">Name</td>
                <td className="py-[8px] text-[var(--ink)]">{name || '—'}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Code</td>
                <td className="py-[8px] font-mono text-[var(--ink)]">{code || '—'}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Auto-apply</td>
                <td className="py-[8px] text-[var(--ink)]">{autoApply ? 'Yes' : 'No'}</td>
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
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Discount</td>
                <td className="py-[8px] text-[var(--ink)]">{rewardSummaryFor(discount)}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Budget</td>
                <td className="py-[8px] text-[var(--ink)]">{budget !== '' ? `$${budget}` : 'Unlimited'}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Per-customer limit</td>
                <td className="py-[8px] text-[var(--ink)]">{perCustomer !== '' ? perCustomer : 'Unlimited'}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Date window</td>
                <td className="py-[8px] text-[var(--ink)]">
                  {startDate || endDate ? `${startDate || '—'} → ${endDate || '—'}` : '—'}
                </td>
              </tr>
              <tr>
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Stacking</td>
                <td className="py-[8px] text-[var(--ink)]">{stackable ? 'Allowed' : 'Not allowed'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </CreateFlowShell>
  );
}
