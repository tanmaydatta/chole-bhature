import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateFlowShell } from '../../components/flow/CreateFlowShell';
import { ConditionBuilder } from '../../components/builder/ConditionBuilder';
import { RewardEditor } from '../../components/rewards/RewardEditor';
import { useProgramStore } from '../../data/store';
import { useToast } from '../../components/common/Toast';
import { EVENTS } from '../../data/events';
import { VARIABLES } from '../../data/variables';
import { TYPE_META } from '../../lib/types';
import { rewardSummaryFor } from '../../lib/rewards';
import type { ConditionGroup, Program, Reward, Status, Variable } from '../../lib/types';

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'reward', label: 'Reward' },
  { key: 'review', label: 'Review' },
];

const STEP_KEYS = STEPS.map(s => s.key);

const USER_VARIABLES = VARIABLES.filter(v => v.origin === 'user');

export default function LoyaltyCreate() {
  const navigate = useNavigate();
  const addProgram = useProgramStore(s => s.addProgram);
  const { toast } = useToast();

  const [activeStep, setActiveStep] = useState('basics');

  // Basics
  const [name, setName] = useState('');

  // Trigger
  const [triggerEvent, setTriggerEvent] = useState('order_completed');

  // Conditions
  const [conditions, setConditions] = useState<ConditionGroup>({
    match: 'ALL',
    conditions: [],
  });

  // Reward
  const [reward, setReward] = useState<Reward>({ kind: 'points', value: 5 });

  const selectedEvent = EVENTS.find(e => e.name === triggerEvent) ?? EVENTS[0];

  const eventPayloadVariables: Variable[] = selectedEvent.fields.map(f => ({
    name: f.name,
    type: f.type,
    origin: 'dynamic' as const,
  }));

  const conditionVariables: Variable[] = [...eventPayloadVariables, ...USER_VARIABLES];

  function handleContinue() {
    const idx = STEP_KEYS.indexOf(activeStep);
    if (idx < STEP_KEYS.length - 1) {
      setActiveStep(STEP_KEYS[idx + 1]);
    }
  }

  function handleBack() {
    const idx = STEP_KEYS.indexOf(activeStep);
    if (idx === 0) {
      navigate('/loyalty');
    } else {
      setActiveStep(STEP_KEYS[idx - 1]);
    }
  }

  function handleCancel() {
    navigate('/loyalty');
  }

  function buildProgram(status: Status): Program {
    const id = `loyalty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
      id,
      name: name || 'Untitled loyalty',
      type: 'loyalty',
      status,
      rewardSummary: rewardSummaryFor(reward),
      redemptions: 0,
      triggerEvent,
      subtitle: `on ${triggerEvent}`,
      eligibility: conditions,
    };
  }

  function handleSaveDraft() {
    addProgram(buildProgram('draft'));
    toast('Draft saved');
    navigate('/loyalty');
  }

  function handleCreate() {
    addProgram(buildProgram('active'));
    toast('Loyalty created');
    navigate('/loyalty');
  }

  const isReview = activeStep === 'review';

  return (
    <CreateFlowShell
      typeMeta={TYPE_META.loyalty}
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
            <label htmlFor="loyalty-name" className="text-[13px] font-[600] text-[var(--muted)]">
              Program name
            </label>
            <input
              id="loyalty-name"
              type="text"
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-full"
              placeholder="e.g. VIP Rewards"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
        </div>
      )}

      {activeStep === 'trigger' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Trigger</h2>

          {/* No-stacking banner */}
          <div
            className="rounded-[10px] px-[14px] py-[10px] text-[13px] flex items-start gap-[10px]"
            style={{ background: 'var(--loy-bg)', color: 'var(--loy)', border: '1px solid var(--loy)' }}
          >
            <span>💡</span>
            <div>
              <strong>Loyalty rewards go to the customer&apos;s wallet</strong> and are auto-redeemed on the next
              eligible order. Loyalty rewards <strong>do not stack</strong> — only one loyalty reward applies per order.
            </div>
          </div>

          <div className="flex flex-col gap-[6px]">
            <label htmlFor="trigger-event" className="text-[13px] font-[600] text-[var(--muted)]">
              Trigger event
            </label>
            <select
              id="trigger-event"
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[12px] py-[8px] text-[14px] text-[var(--ink)] w-full"
              value={triggerEvent}
              onChange={e => setTriggerEvent(e.target.value)}
            >
              {EVENTS.map(ev => (
                <option key={ev.name} value={ev.name}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payload fields from the selected event */}
          <div className="flex flex-col gap-[8px]">
            <div className="text-[12px] font-[600] text-[var(--muted)] uppercase tracking-wide">
              Event payload fields
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {selectedEvent.fields.map(f => (
                <span
                  key={f.name}
                  className="inline-flex items-center gap-[5px] px-[10px] py-[4px] rounded-full text-[12px] font-[600]"
                  style={{ background: 'var(--dyn-bg)', color: 'var(--dyn)' }}
                >
                  <span>{f.name}</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{f.type}</span>
                </span>
              ))}
            </div>
          </div>

          {/* User attributes — always available */}
          <div className="flex flex-col gap-[8px]">
            <div className="text-[12px] font-[600] text-[var(--muted)] uppercase tracking-wide">
              Always available · user attributes
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {USER_VARIABLES.map(v => (
                <span
                  key={v.name}
                  className="inline-flex items-center gap-[5px] px-[10px] py-[4px] rounded-full text-[12px] font-[600]"
                  style={{ background: 'var(--user-bg)', color: 'var(--user)' }}
                >
                  <span>{v.name}</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{v.type}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeStep === 'conditions' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Conditions</h2>
          <ConditionBuilder
            value={conditions}
            variables={conditionVariables}
            onChange={setConditions}
          />
        </div>
      )}

      {activeStep === 'reward' && (
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[16px] font-[700] mb-[4px]">Reward</h2>
          <RewardEditor value={reward} onChange={setReward} />
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
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Trigger</td>
                <td className="py-[8px] text-[var(--ink)] font-mono">{triggerEvent}</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Conditions</td>
                <td className="py-[8px] text-[var(--ink)]">
                  {conditions.conditions.length > 0
                    ? `${conditions.conditions.length} condition(s) · match ${conditions.match}`
                    : 'None'}
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Reward</td>
                <td className="py-[8px] text-[var(--ink)]">{rewardSummaryFor(reward)}</td>
              </tr>
              <tr>
                <td className="py-[8px] pr-[16px] font-[600] text-[var(--muted)]">Stacking</td>
                <td className="py-[8px] text-[var(--ink)]">Not allowed (loyalty fixed rule)</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </CreateFlowShell>
  );
}
