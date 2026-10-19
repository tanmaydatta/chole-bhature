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
import { programApi } from '../../data/program-api';
import { schemaApi } from '../../data/schema-api';
import { BffClientError } from '../../lib/bff-client';

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
  if (reward.type === 'free_shipping') return <p>Free shipping has no amount fields.</p>;
  const value = reward.calculation === 'percent' ? text ?? percentageText(reward.basisPoints) : '';
  const invalid = reward.calculation === 'percent' && percentageBasisPoints(value) === null;
  return <div className="flex gap-2 flex-wrap">
    {reward.type === 'line_item_discount' && <label>Product reference<input value={reward.productRef} onChange={event => change({ ...reward, productRef: event.target.value })}/></label>}
    {reward.calculation === 'percent'
      ? <>
        <label>Discount percentage<input type="text" inputMode="decimal" value={value}
          aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
          onChange={event => changePercentage(event.target.value)}/></label>
        {invalid && <span id={errorId} role="alert">Enter a percentage from 0.01 to 100 with at most two decimal places.</span>}
        {reward.maximumDiscountAmount === undefined
          ? <button type="button" onClick={() => change({
            ...reward,
            maximumDiscountAmount: { currency: 'GBP', minorUnits: 1 },
          })}>Add maximum discount</button>
          : <>
            <label>Maximum discount currency<input value={reward.maximumDiscountAmount.currency} onChange={event => change({
              ...reward,
              maximumDiscountAmount: {
                ...reward.maximumDiscountAmount!,
                currency: event.target.value,
              },
            })}/></label>
            <label>Maximum discount minor units<input type="number" min={1} value={reward.maximumDiscountAmount.minorUnits} onChange={event => change({
              ...reward,
              maximumDiscountAmount: {
                ...reward.maximumDiscountAmount!,
                minorUnits: Number(event.target.value),
              },
            })}/></label>
            <button type="button" onClick={() => {
              const { maximumDiscountAmount: _maximum, ...uncapped } = reward;
              change(uncapped);
            }}>Remove maximum discount</button>
          </>}
      </>
      : <><label>Currency<input value={reward.amount.currency} onChange={event => change({ ...reward, amount: { ...reward.amount, currency: event.target.value } })}/></label><label>Minor units<input type="number" min={1} value={reward.amount.minorUnits} onChange={event => change({ ...reward, amount: { ...reward.amount, minorUnits: Number(event.target.value) } })}/></label></>}
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
  return <section className="flex flex-col gap-3"><h2>Ordered reward rules</h2>
    {program.rewardRules.map((rule, index) => <fieldset key={rule.id} className="border p-3">
      <legend>Reward rule {index + 1}</legend>
      <p>Rule ID: <code>{rule.id}</code></p>
      <label>Rule name<input value={rule.name} onChange={event => update(index, { ...rule, name: event.target.value })}/></label>
      <label>Reward type<select value={rewardKind(rule.reward)} onChange={event => update(index, { ...rule, reward: changedReward(rule.reward, event.target.value) })}>
        <option value="order_discount_fixed">Order fixed</option><option value="order_discount_percent">Order percent</option>
        <option value="line_item_discount_fixed">Line item fixed</option><option value="line_item_discount_percent">Line item percent</option>
        <option value="free_shipping">Free shipping</option>
      </select></label>
      <RewardFields reward={rule.reward} change={reward => update(index, { ...rule, reward })}
        text={percentageTexts.get(rule.id)} changePercentage={text => changePercentage(rule.id, text)}/>
      <ConditionBuilder value={rule.conditions} variables={variables} onChange={conditions => update(index, { ...rule, conditions })}/>
      <button type="button" aria-label={`Move reward rule ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
      <button type="button" aria-label={`Move reward rule ${index + 1} down`} disabled={index === program.rewardRules.length - 1} onClick={() => move(index, 1)}>Move down</button>
      <button type="button" onClick={() => change({ ...program, rewardRules: program.rewardRules.filter((_, ruleIndex) => ruleIndex !== index) })}>Remove rule</button>
    </fieldset>)}
    <button type="button" onClick={() => change({ ...program, rewardRules: [...program.rewardRules, {
      id: nextId('rule'), name: `Rule ${program.rewardRules.length + 1}`,
      conditions: { match: 'ALL', conditions: [] }, reward: { type: 'free_shipping' },
    }] })}>Add reward rule</button>
    {program.fallbackReward ? <fieldset className="border p-3"><legend>Fallback reward</legend>
      <p>Fallback ID: <code>{program.fallbackReward.id}</code></p>
      <label>Fallback name<input value={program.fallbackReward.name} onChange={event => change({ ...program, fallbackReward: { ...program.fallbackReward!, name: event.target.value } })}/></label>
      <label>Fallback type<select value={rewardKind(program.fallbackReward.reward)} onChange={event => change({ ...program, fallbackReward: { ...program.fallbackReward!, reward: changedReward(program.fallbackReward!.reward, event.target.value) } })}>
        <option value="order_discount_fixed">Order fixed</option><option value="order_discount_percent">Order percent</option><option value="line_item_discount_fixed">Line item fixed</option><option value="line_item_discount_percent">Line item percent</option><option value="free_shipping">Free shipping</option>
      </select></label>
      <RewardFields reward={program.fallbackReward.reward} change={reward => change({ ...program, fallbackReward: { ...program.fallbackReward!, reward } })}
        text={percentageTexts.get(program.fallbackReward.id)} changePercentage={text => changePercentage(program.fallbackReward!.id, text)}/>
      <button type="button" onClick={() => change({ ...program, fallbackReward: undefined })}>Remove fallback</button>
    </fieldset> : <button type="button" onClick={() => change({ ...program, fallbackReward: { id: nextId('fallback'), name: 'Fallback', reward: { type: 'free_shipping' } } })}>Add fallback reward</button>}
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

  if (loading) return <p>Loading Promo draft…</p>;
  if (loadError) return <ErrorState error={loadError} retry={() => window.location.reload()} forceRetry />;

  return <main className="mx-auto max-w-4xl p-6 flex flex-col gap-5">
    <h1>{id ? 'Edit Promo draft' : 'Create Promo'}</h1>
    <label>External reference<input aria-label="External reference" disabled={Boolean(id)} value={program.id} onChange={event => setProgram({ ...program, id: event.target.value })}/></label>
    <label>Promo name<input aria-label="Promo name" value={program.name} onChange={event => setProgram({ ...program, name: event.target.value })}/></label>
    <fieldset>
      <legend>Trigger</legend>
      <label><input type="radio" name="promo-trigger" checked={program.autoApply} onChange={selectAutomaticTrigger}/>Automatic</label>
      <label><input type="radio" name="promo-trigger" checked={!program.autoApply} onChange={selectCodedTrigger}/>Code-triggered</label>
      {!program.autoApply && <label>Code<input value={program.code} onChange={event => setProgram({ ...program, code: event.target.value })}/></label>}
    </fieldset>
    {!id && <button type="button" onClick={() => { setPercentageTexts(new Map()); setProgram(example(program.id, program.name)); }}>Use complete authoring example</button>}
    <section><h2>Eligibility</h2><ConditionBuilder value={program.eligibility} variables={variables} onChange={eligibility => setProgram({ ...program, eligibility })}/></section>
    <RewardRules program={program} variables={variables} change={changeProgram}
      percentageTexts={percentageTexts} changePercentage={changePercentage}/>
    <section className="grid grid-cols-2 gap-3"><h2 className="col-span-2">Limits, schedule, and stacking</h2>
      {program.budget
        ? <>
          <label>Budget currency<input aria-invalid={budgetCurrencyInvalid} value={program.budget.currency} onChange={event => setProgram({ ...program, budget: { ...program.budget!, currency: event.target.value } })}/>
            {budgetCurrencyInvalid && <span role="alert">Budget currency must be exactly three uppercase letters.</span>}
          </label>
          <label>Budget minor units<input aria-invalid={budgetMinorUnitsInvalid} type="number" value={program.budget.minorUnits} onChange={event => setProgram({ ...program, budget: { ...program.budget!, minorUnits: Number(event.target.value) } })}/>
            {budgetMinorUnitsInvalid && <span role="alert">Budget minor units must be a non-negative whole number.</span>}
          </label>
          <button type="button" className="col-span-2" onClick={() => setProgram({ ...program, budget: undefined })}>Remove budget</button>
        </>
        : <button type="button" className="col-span-2" onClick={() => setProgram({ ...program, budget: { currency: 'GBP', minorUnits: 0 } })}>Add budget</button>}
      <label>Usage cap<input type="number" value={program.usageCap ?? ''} onChange={event => setProgram({ ...program, usageCap: event.target.value ? Number(event.target.value) : undefined })}/></label>
      <label>Per customer cap<input type="number" value={program.perCustomerCap ?? ''} onChange={event => setProgram({ ...program, perCustomerCap: event.target.value ? Number(event.target.value) : undefined })}/></label>
      <label>Start date<input type="date" value={program.startDate ?? ''} onChange={event => setProgram({ ...program, startDate: event.target.value || undefined })}/></label>
      <label>End date<input type="date" value={program.endDate ?? ''} onChange={event => setProgram({ ...program, endDate: event.target.value || undefined })}/></label>
      <label>Priority<input type="number" value={program.priority} onChange={event => setProgram({ ...program, priority: Number(event.target.value) })}/></label>
      {!program.autoApply && <label><input type="checkbox" checked={program.stackable} onChange={event => setProgram({ ...program, stackable: event.target.checked })}/>Stackable</label>}
    </section>
    {freeShippingBudgetConflict && <p role="alert">Remove the monetary budget before saving a free-shipping reward.</p>}
    {!validation.success && <p role="alert">Complete every required field and ensure each conditional rule has a condition.</p>}
    {!conditionsValid && <p role="alert">Resolve every missing field and incompatible condition before saving.</p>}
    {saveError && <section className="flex flex-col gap-2">
      <ErrorState error={saveError} retry={() => void save()} forceRetry retryLabel="Retry save" />
      {(id || conflictReference) && <button type="button" onClick={() => void loadComparison()} disabled={comparisonLoading}>
        {comparisonLoading ? 'Loading server version…' : 'Reload server version for comparison'}
      </button>}
    </section>}
    {compareError && <ErrorState error={compareError} retry={() => void loadComparison()} retryLabel="Retry comparison" />}
    {comparison && <section aria-label="Server version comparison" className="rounded border p-3">
      <h2>Server version comparison</h2>
      <p>Server Promo name: <code>{comparison.name}</code></p>
      <p>Your authored draft remains in the editor. Replace it only after comparing.</p>
      <button type="button" onClick={() => {
        setPercentageTexts(new Map());
        setProgram({ ...comparison, status: 'draft' });
        setComparison(null);
        setConflictReference(null);
        setSaveError(null);
      }}>Replace authored draft with server version</button>
    </section>}
    <button type="button" disabled={!validation.success || !conditionsValid || !percentagesValid || freeShippingBudgetConflict || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save draft'}</button>
  </main>;
}
