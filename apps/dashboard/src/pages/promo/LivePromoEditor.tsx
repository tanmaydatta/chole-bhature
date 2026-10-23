import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  OperatorProgramDraftRequestSchema,
  type CommerceReward,
  type PromoProgram,
  type PromoRewardRule,
  type VariableDefinition,
} from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import {
  ConditionBuilder,
  type ConditionBuilderVariable,
} from '../../components/builder/ConditionBuilder';
import { conditionGroupIsAuthorable } from '../../components/builder/condition-validation';
import { PageHeader } from '../../components/common/PageHeader';
import { programApi } from '../../data/program-api';
import { schemaApi } from '../../data/schema-api';
import { BffClientError } from '../../lib/bff-client';

const frameClass = 'min-h-screen bg-[var(--bg)] p-4 text-[13px] text-[var(--ink)] sm:p-6';
const panelClass = 'min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5';
const headingClass = 'text-[15px] font-semibold';
const labelClass = 'block min-w-0 text-[12px] font-medium';
const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--promo)]';
const inputClass = `mt-1 block w-full min-w-0 rounded-[7px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60 ${focusClass}`;
const choiceClass = `h-4 w-4 shrink-0 accent-[var(--accent)] ${focusClass}`;
const buttonClass = `max-w-full self-start rounded-[7px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50 ${focusClass}`;
const removeClass = `${buttonClass} text-[var(--req)]`;
const alertClass = 'rounded-[7px] bg-[var(--req-bg)] px-3 py-2 text-[12px] text-[var(--req)]';

function localVariable(definition: VariableDefinition): ConditionBuilderVariable {
  return {
    name: definition.key, type: definition.type,
    origin: definition.source === 'customer' ? 'user' : definition.source === 'system' ? 'system' : 'dynamic',
    enumValues: definition.enumValues, defaultMessage: definition.defaultErrorMessage,
  };
}

function editorError(cause: unknown): BffClientError {
  return cause instanceof BffClientError
    ? cause
    : new BffClientError(
      0,
      'UNEXPECTED_ERROR',
      'The operator service is temporarily unavailable',
      true,
      'unavailable',
    );
}

function nextId(prefix: string): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function minimal(id: string, name: string): PromoProgram {
  return {
    id, type: 'promo', name, status: 'draft', autoApply: true,
    eligibility: { match: 'ALL', conditions: [] },
    rewardRules: [], stackable: false, priority: 10,
  };
}

function example(id: string, name: string): PromoProgram {
  return {
    id, type: 'promo', name, status: 'draft', autoApply: true,
    eligibility: { match: 'ALL', conditions: [] },
    rewardRules: [{
      id: nextId('rule'), name: 'Large basket', conditions: { match: 'ALL', conditions: [{
        id: 'large-basket', variable: 'cart.subtotal', operator: 'gte', value: 10_000,
      }] }, reward: { type: 'order_discount', calculation: 'percent', basisPoints: 2_000 },
    }, {
      id: nextId('rule'), name: 'Gold customer', conditions: { match: 'ANY', conditions: [], groups: [{
        match: 'ALL', conditions: [{ id: 'gold-tier', variable: 'customer.tier', operator: 'eq', value: 'gold' }],
      }] }, reward: {
        type: 'line_item_discount', productRef: 'product-a', calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 500 },
      },
    }],
    fallbackReward: {
      id: nextId('fallback'), name: 'Fallback discount',
      reward: {
        type: 'order_discount', calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 250 },
      },
    },
    budget: { currency: 'GBP', minorUnits: 50_000 }, usageCap: 100,
    perCustomerCap: 2, stackable: false, priority: 10,
  };
}

function changedReward(_reward: CommerceReward, kind: string): CommerceReward {
  if (kind === 'free_shipping') return { type: 'free_shipping' };
  const line = kind.startsWith('line_');
  const percent = kind.endsWith('percent');
  if (line) return percent
    ? { type: 'line_item_discount', productRef: 'product', calculation: 'percent', basisPoints: 1_000 }
    : { type: 'line_item_discount', productRef: 'product', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 100 } };
  return percent
    ? { type: 'order_discount', calculation: 'percent', basisPoints: 1_000 }
    : { type: 'order_discount', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 100 } };
}

function rewardKind(reward: CommerceReward): string {
  return reward.type === 'free_shipping'
    ? 'free_shipping'
    : `${reward.type}_${reward.calculation}`;
}

function percentageBasisPoints(text: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/u.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return basisPoints >= 1 && basisPoints <= 10_000 ? basisPoints : null;
}

function percentageText(basisPoints: number): string {
  const fraction = basisPoints % 100;
  return `${Math.floor(basisPoints / 100)}${fraction ? `.${String(fraction).padStart(2, '0').replace(/0$/u, '')}` : ''}`;
}

function programRewards(program: PromoProgram) {
  return [...program.rewardRules, ...(program.fallbackReward ? [program.fallbackReward] : [])];
}

function RewardFields({ reward, change, text, changePercentage }: {
  reward: CommerceReward; change: (next: CommerceReward) => void;
  text?: string; changePercentage: (text: string) => void;
}) {
  const errorId = useId();
  if (reward.type === 'free_shipping') return <p className="text-[12px] text-[var(--muted)]">Free shipping has no amount fields.</p>;
  const value = reward.calculation === 'percent' ? text ?? percentageText(reward.basisPoints) : '';
  const invalid = reward.calculation === 'percent' && percentageBasisPoints(value) === null;
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    {reward.type === 'line_item_discount' && <label className={labelClass}>Product reference<input className={inputClass} value={reward.productRef} onChange={event => change({ ...reward, productRef: event.target.value })}/></label>}
    {reward.calculation === 'percent'
      ? <>
        <label className={labelClass}>Discount percentage<input className={inputClass} type="text" inputMode="decimal" value={value}
          aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
          onChange={event => changePercentage(event.target.value)}/></label>
        {invalid && <span className={alertClass} id={errorId} role="alert">Enter a percentage from 0.01 to 100 with at most two decimal places.</span>}
        {reward.maximumDiscountAmount === undefined
          ? <button className={buttonClass} type="button" onClick={() => change({
            ...reward,
            maximumDiscountAmount: { currency: 'GBP', minorUnits: 1 },
          })}>Add maximum discount</button>
          : <>
            <label className={labelClass}>Maximum discount currency<input className={inputClass} value={reward.maximumDiscountAmount.currency} onChange={event => change({
              ...reward,
              maximumDiscountAmount: {
                ...reward.maximumDiscountAmount!,
                currency: event.target.value,
              },
            })}/></label>
            <label className={labelClass}>Maximum discount minor units<input className={inputClass} type="number" min={1} value={reward.maximumDiscountAmount.minorUnits} onChange={event => change({
              ...reward,
              maximumDiscountAmount: {
                ...reward.maximumDiscountAmount!,
                minorUnits: Number(event.target.value),
              },
            })}/></label>
            <button className={removeClass} type="button" onClick={() => {
              const { maximumDiscountAmount: _maximum, ...uncapped } = reward;
              change(uncapped);
            }}>Remove maximum discount</button>
          </>}
      </>
      : <><label className={labelClass}>Currency<input className={inputClass} value={reward.amount.currency} onChange={event => change({ ...reward, amount: { ...reward.amount, currency: event.target.value } })}/></label><label className={labelClass}>Minor units<input className={inputClass} type="number" min={1} value={reward.amount.minorUnits} onChange={event => change({ ...reward, amount: { ...reward.amount, minorUnits: Number(event.target.value) } })}/></label></>}
  </div>;
}

function RewardRules({ program, variables, change, percentageTexts, changePercentage }: {
  program: PromoProgram; variables: ConditionBuilderVariable[]; change: (next: PromoProgram) => void;
  percentageTexts: Map<string, string>; changePercentage: (id: string, text: string) => void;
}) {
  function update(index: number, next: PromoRewardRule) {
    change({ ...program, rewardRules: program.rewardRules.map((rule, ruleIndex) => ruleIndex === index ? next : rule) });
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...program.rewardRules];
    const [rule] = next.splice(index, 1);
    if (!rule) return;
    next.splice(index + direction, 0, rule);
    change({ ...program, rewardRules: next });
  }
  return <section aria-label="Ordered reward rules" className={`${panelClass} flex flex-col gap-4`}><h2 className={headingClass}>Ordered reward rules</h2>
    {program.rewardRules.map((rule, index) => <fieldset key={rule.id} className="min-w-0 space-y-4 rounded-[8px] border border-[var(--border)] p-3 sm:p-4">
      <legend className="px-1 font-semibold">Reward rule {index + 1}</legend>
      <p className="break-words text-[12px] text-[var(--muted)]">Rule ID: <code>{rule.id}</code></p>
      <label className={labelClass}>Rule name<input className={inputClass} value={rule.name} onChange={event => update(index, { ...rule, name: event.target.value })}/></label>
      <label className={labelClass}>Reward type<select className={inputClass} value={rewardKind(rule.reward)} onChange={event => update(index, { ...rule, reward: changedReward(rule.reward, event.target.value) })}>
        <option value="order_discount_fixed">Order fixed</option><option value="order_discount_percent">Order percent</option>
        <option value="line_item_discount_fixed">Line item fixed</option><option value="line_item_discount_percent">Line item percent</option>
        <option value="free_shipping">Free shipping</option>
      </select></label>
      <RewardFields reward={rule.reward} change={reward => update(index, { ...rule, reward })}
        text={percentageTexts.get(rule.id)} changePercentage={text => changePercentage(rule.id, text)}/>
      <ConditionBuilder value={rule.conditions} variables={variables} onChange={conditions => update(index, { ...rule, conditions })}/>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} type="button" aria-label={`Move reward rule ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
        <button className={buttonClass} type="button" aria-label={`Move reward rule ${index + 1} down`} disabled={index === program.rewardRules.length - 1} onClick={() => move(index, 1)}>Move down</button>
        <button className={removeClass} type="button" onClick={() => change({ ...program, rewardRules: program.rewardRules.filter((_, ruleIndex) => ruleIndex !== index) })}>Remove rule</button>
      </div>
    </fieldset>)}
    <button className={buttonClass} type="button" onClick={() => change({ ...program, rewardRules: [...program.rewardRules, {
      id: nextId('rule'), name: `Rule ${program.rewardRules.length + 1}`,
      conditions: { match: 'ALL', conditions: [] }, reward: { type: 'free_shipping' },
    }] })}>Add reward rule</button>
    {program.fallbackReward ? <fieldset className="min-w-0 space-y-4 rounded-[8px] border border-[var(--border)] p-3 sm:p-4"><legend className="px-1 font-semibold">Fallback reward</legend>
      <p className="break-words text-[12px] text-[var(--muted)]">Fallback ID: <code>{program.fallbackReward.id}</code></p>
      <label className={labelClass}>Fallback name<input className={inputClass} value={program.fallbackReward.name} onChange={event => change({ ...program, fallbackReward: { ...program.fallbackReward!, name: event.target.value } })}/></label>
      <label className={labelClass}>Fallback type<select className={inputClass} value={rewardKind(program.fallbackReward.reward)} onChange={event => change({ ...program, fallbackReward: { ...program.fallbackReward!, reward: changedReward(program.fallbackReward!.reward, event.target.value) } })}>
        <option value="order_discount_fixed">Order fixed</option><option value="order_discount_percent">Order percent</option><option value="line_item_discount_fixed">Line item fixed</option><option value="line_item_discount_percent">Line item percent</option><option value="free_shipping">Free shipping</option>
      </select></label>
      <RewardFields reward={program.fallbackReward.reward} change={reward => change({ ...program, fallbackReward: { ...program.fallbackReward!, reward } })}
        text={percentageTexts.get(program.fallbackReward.id)} changePercentage={text => changePercentage(program.fallbackReward!.id, text)}/>
      <button className={removeClass} type="button" onClick={() => change({ ...program, fallbackReward: undefined })}>Remove fallback</button>
    </fieldset> : <button className={buttonClass} type="button" onClick={() => change({ ...program, fallbackReward: { id: nextId('fallback'), name: 'Fallback', reward: { type: 'free_shipping' } } })}>Add fallback reward</button>}
  </section>;
}

export default function LivePromoEditor() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [program, setProgram] = useState<PromoProgram>(() => minimal('', ''));
  const [percentageTexts, setPercentageTexts] = useState(() => new Map<string, string>());
  const [variables, setVariables] = useState<ConditionBuilderVariable[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [loadError, setLoadError] = useState<BffClientError | null>(null);
  const [saveError, setSaveError] = useState<BffClientError | null>(null);
  const [compareError, setCompareError] = useState<BffClientError | null>(null);
  const [comparison, setComparison] = useState<PromoProgram | null>(null);
  const [conflictReference, setConflictReference] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const validation = useMemo(() => OperatorProgramDraftRequestSchema.safeParse(program), [program]);
  const percentagesValid = programRewards(program).every(({ id: rewardId, reward }) => (
    reward.type === 'free_shipping' || reward.calculation !== 'percent'
    || percentageBasisPoints(percentageTexts.get(rewardId) ?? percentageText(reward.basisPoints)) !== null
  ));

  function changeProgram(next: PromoProgram) {
    setPercentageTexts(previous => new Map(programRewards(next).flatMap(({ id: rewardId, reward }) => {
      const before = programRewards(program).find(rule => rule.id === rewardId)?.reward;
      return reward.type !== 'free_shipping' && reward.calculation === 'percent'
        && before?.type === reward.type && before.calculation === 'percent'
        && before.basisPoints === reward.basisPoints && previous.has(rewardId)
        ? [[rewardId, previous.get(rewardId)!] as const] : [];
    })));
    setProgram(next);
  }

  function changePercentage(rewardId: string, text: string) {
    setPercentageTexts(previous => new Map(previous).set(rewardId, text));
    const basisPoints = percentageBasisPoints(text);
    if (basisPoints === null) return;
    const update = <T extends { id: string; reward: CommerceReward }>(rule: T): T => (
      rule.id === rewardId && rule.reward.type !== 'free_shipping' && rule.reward.calculation === 'percent'
        ? { ...rule, reward: { ...rule.reward, basisPoints } } : rule
    );
    setProgram(previous => ({ ...previous, rewardRules: previous.rewardRules.map(update),
      ...(previous.fallbackReward ? { fallbackReward: update(previous.fallbackReward) } : {}) }));
  }
  const budgetCurrencyInvalid = program.budget !== undefined
    && !/^[A-Z]{3}$/u.test(program.budget.currency);
  const budgetMinorUnitsInvalid = program.budget !== undefined
    && (!Number.isInteger(program.budget.minorUnits) || program.budget.minorUnits < 0);
  const freeShippingBudgetConflict = program.budget !== undefined && (
    program.rewardRules.some(rule => rule.reward.type === 'free_shipping')
    || program.fallbackReward?.reward.type === 'free_shipping'
  );
  const conditionsValid = useMemo(() => (
    conditionGroupIsAuthorable(program.eligibility, variables)
    && program.rewardRules.every(rule => conditionGroupIsAuthorable(rule.conditions, variables))
  ), [program, variables]);

  useEffect(() => {
    let current = true;
    void schemaApi.list().then(result => {
      if (current) setVariables(result.definitions.map(view => view.definition).filter(definition => definition.source !== 'event').map(localVariable));
    }).catch(cause => { if (current) setLoadError(auth.handleError(cause)); });
    if (id) void programApi.get(id).then(view => {
      if (current) {
        setPercentageTexts(new Map());
        setProgram({ ...(view.draftConfiguration ?? view.configuration), status: 'draft' });
      }
    }).catch(cause => { if (current) setLoadError(auth.handleError(cause)); }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [auth, id]);

  async function save() {
    if (!percentagesValid) return;
    setSaveError(null);
    if (!id) setConflictReference(null);
    setSaving(true);
    let submittedReference = id ?? null;
    try {
      const input = OperatorProgramDraftRequestSchema.parse({ ...program, status: 'draft' });
      submittedReference = input.id;
      const view = id ? await programApi.update(id, input) : await programApi.create(input);
      navigate(`/promo/${encodeURIComponent(view.configuration.id)}`);
    } catch (cause) {
      const error = editorError(cause);
      setSaveError(error);
      if (error.code === 'PROGRAM_CONFLICT') setConflictReference(submittedReference);
    } finally {
      setSaving(false);
    }
  }

  async function loadComparison() {
    const reference = id ?? conflictReference;
    if (!reference) return;
    setCompareError(null);
    setComparisonLoading(true);
    try {
      const view = await programApi.get(reference);
      setComparison(view.configuration);
    } catch (cause) {
      setCompareError(editorError(cause));
    } finally {
      setComparisonLoading(false);
    }
  }

  function selectAutomaticTrigger() {
    if (program.autoApply) return;
    if (
      (program.code.length > 0 || program.stackable)
      && !window.confirm('Switching to Automatic will clear the code and stacking choice. Continue?')
    ) return;
    const { code: _code, ...withoutCode } = program;
    setProgram({
      ...withoutCode,
      autoApply: true,
      stackable: false,
    });
  }

  function selectCodedTrigger() {
    if (!program.autoApply) return;
    setProgram({
      ...program,
      autoApply: false,
      code: '',
      stackable: false,
    });
  }

  if (loading) return <main className={frameClass}><p className="mx-auto max-w-4xl">Loading Promo draft…</p></main>;
  if (loadError) return <main className={frameClass}><div className="mx-auto max-w-4xl"><ErrorState error={loadError} retry={() => window.location.reload()} forceRetry /></div></main>;

  return <main className={frameClass}><div className="mx-auto flex max-w-4xl flex-col gap-5">
    <PageHeader title={id ? 'Edit Promo draft' : 'Create Promo'} />
    <section aria-label="Basics" className={`${panelClass} space-y-4`}>
      <h2 className={headingClass}>Basics</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>External reference<input className={inputClass} aria-label="External reference" disabled={Boolean(id)} value={program.id} onChange={event => setProgram({ ...program, id: event.target.value })}/></label>
        <label className={labelClass}>Promo name<input className={inputClass} aria-label="Promo name" value={program.name} onChange={event => setProgram({ ...program, name: event.target.value })}/></label>
      </div>
    </section>
    <fieldset className={`${panelClass} space-y-3`}>
      <legend className={`${headingClass} px-1`}>Trigger</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <label className="inline-flex items-center gap-2"><input className={choiceClass} type="radio" name="promo-trigger" checked={program.autoApply} onChange={selectAutomaticTrigger}/>Automatic</label>
        <label className="inline-flex items-center gap-2"><input className={choiceClass} type="radio" name="promo-trigger" checked={!program.autoApply} onChange={selectCodedTrigger}/>Code-triggered</label>
      </div>
      {!program.autoApply && <label className={labelClass}>Code<input className={inputClass} value={program.code} onChange={event => setProgram({ ...program, code: event.target.value })}/></label>}
    </fieldset>
    {!id && <button className={buttonClass} type="button" onClick={() => { setPercentageTexts(new Map()); setProgram(example(program.id, program.name)); }}>Use complete authoring example</button>}
    <section aria-label="Eligibility" className={`${panelClass} space-y-4`}><h2 className={headingClass}>Eligibility</h2><ConditionBuilder value={program.eligibility} variables={variables} onChange={eligibility => setProgram({ ...program, eligibility })}/></section>
    <RewardRules program={program} variables={variables} change={changeProgram}
      percentageTexts={percentageTexts} changePercentage={changePercentage}/>
    <section aria-label="Limits, schedule, and stacking" className={`${panelClass} grid grid-cols-1 gap-3 sm:grid-cols-2`}><h2 className={`${headingClass} sm:col-span-2`}>Limits, schedule, and stacking</h2>
      {program.budget
        ? <>
          <label className={labelClass}>Budget currency<input className={inputClass} aria-invalid={budgetCurrencyInvalid} value={program.budget.currency} onChange={event => setProgram({ ...program, budget: { ...program.budget!, currency: event.target.value } })}/>
            {budgetCurrencyInvalid && <span className={`mt-1 block ${alertClass}`} role="alert">Budget currency must be exactly three uppercase letters.</span>}
          </label>
          <label className={labelClass}>Budget minor units<input className={inputClass} aria-invalid={budgetMinorUnitsInvalid} type="number" value={program.budget.minorUnits} onChange={event => setProgram({ ...program, budget: { ...program.budget!, minorUnits: Number(event.target.value) } })}/>
            {budgetMinorUnitsInvalid && <span className={`mt-1 block ${alertClass}`} role="alert">Budget minor units must be a non-negative whole number.</span>}
          </label>
          <button type="button" className={`${removeClass} justify-self-start sm:col-span-2`} onClick={() => setProgram({ ...program, budget: undefined })}>Remove budget</button>
        </>
        : <button type="button" className={`${buttonClass} justify-self-start sm:col-span-2`} onClick={() => setProgram({ ...program, budget: { currency: 'GBP', minorUnits: 0 } })}>Add budget</button>}
      <label className={labelClass}>Usage cap<input className={inputClass} type="number" value={program.usageCap ?? ''} onChange={event => setProgram({ ...program, usageCap: event.target.value ? Number(event.target.value) : undefined })}/></label>
      <label className={labelClass}>Per customer cap<input className={inputClass} type="number" value={program.perCustomerCap ?? ''} onChange={event => setProgram({ ...program, perCustomerCap: event.target.value ? Number(event.target.value) : undefined })}/></label>
      <label className={labelClass}>Start date<input className={inputClass} type="date" value={program.startDate ?? ''} onChange={event => setProgram({ ...program, startDate: event.target.value || undefined })}/></label>
      <label className={labelClass}>End date<input className={inputClass} type="date" value={program.endDate ?? ''} onChange={event => setProgram({ ...program, endDate: event.target.value || undefined })}/></label>
      <label className={labelClass}>Priority<input className={inputClass} type="number" value={program.priority} onChange={event => setProgram({ ...program, priority: Number(event.target.value) })}/></label>
      {!program.autoApply && <label className="inline-flex items-center gap-2 self-center"><input className={choiceClass} type="checkbox" checked={program.stackable} onChange={event => setProgram({ ...program, stackable: event.target.checked })}/>Stackable</label>}
    </section>
    {freeShippingBudgetConflict && <p className={alertClass} role="alert">Remove the monetary budget before saving a free-shipping reward.</p>}
    {!validation.success && <p className={alertClass} role="alert">Complete every required field and ensure each conditional rule has a condition.</p>}
    {!conditionsValid && <p className={alertClass} role="alert">Resolve every missing field and incompatible condition before saving.</p>}
    {saveError && <section className={`${panelClass} flex flex-col gap-3`}>
      <ErrorState error={saveError} retry={() => void save()} forceRetry retryLabel="Retry save" />
      {(id || conflictReference) && <button className={buttonClass} type="button" onClick={() => void loadComparison()} disabled={comparisonLoading}>
        {comparisonLoading ? 'Loading server version…' : 'Reload server version for comparison'}
      </button>}
    </section>}
    {compareError && <ErrorState error={compareError} retry={() => void loadComparison()} retryLabel="Retry comparison" />}
    {comparison && <section aria-label="Server version comparison" className={`${panelClass} space-y-3`}>
      <h2 className={headingClass}>Server version comparison</h2>
      <p className="break-words">Server Promo name: <code>{comparison.name}</code></p>
      <p>Your authored draft remains in the editor. Replace it only after comparing.</p>
      <button className={buttonClass} type="button" onClick={() => {
        setPercentageTexts(new Map());
        setProgram({ ...comparison, status: 'draft' });
        setComparison(null);
        setConflictReference(null);
        setSaveError(null);
      }}>Replace authored draft with server version</button>
    </section>}
    <div className="flex flex-wrap gap-3">
      <button className={`max-w-full rounded-[7px] bg-[#4f46e5] px-4 py-2 font-semibold text-white hover:bg-[#4338ca] disabled:cursor-not-allowed disabled:opacity-50 ${focusClass}`} type="button" disabled={!validation.success || !conditionsValid || !percentagesValid || freeShippingBudgetConflict || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save draft'}</button>
    </div>
  </div></main>;
}
