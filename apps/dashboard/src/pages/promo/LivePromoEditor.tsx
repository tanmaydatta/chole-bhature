import { useEffect, useMemo, useState } from 'react';
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

function RewardFields({ reward, change }: { reward: CommerceReward; change: (next: CommerceReward) => void }) {
  if (reward.type === 'free_shipping') return <p>Free shipping has no amount fields.</p>;
  return <div className="flex gap-2">
    {reward.type === 'line_item_discount' && <label>Product reference<input value={reward.productRef} onChange={event => change({ ...reward, productRef: event.target.value })}/></label>}
    {reward.calculation === 'percent'
      ? <label>Basis points<input type="number" min={1} max={10_000} value={reward.basisPoints} onChange={event => change({ ...reward, basisPoints: Number(event.target.value) })}/></label>
      : <><label>Currency<input value={reward.amount.currency} onChange={event => change({ ...reward, amount: { ...reward.amount, currency: event.target.value } })}/></label><label>Minor units<input type="number" min={1} value={reward.amount.minorUnits} onChange={event => change({ ...reward, amount: { ...reward.amount, minorUnits: Number(event.target.value) } })}/></label></>}
  </div>;
}

function RewardRules({ program, variables, change }: { program: PromoProgram; variables: ConditionBuilderVariable[]; change: (next: PromoProgram) => void }) {
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
      <RewardFields reward={rule.reward} change={reward => update(index, { ...rule, reward })}/>
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
      <RewardFields reward={program.fallbackReward.reward} change={reward => change({ ...program, fallbackReward: { ...program.fallbackReward!, reward } })}/>
      <button type="button" onClick={() => change({ ...program, fallbackReward: undefined })}>Remove fallback</button>
    </fieldset> : <button type="button" onClick={() => change({ ...program, fallbackReward: { id: nextId('fallback'), name: 'Fallback', reward: { type: 'free_shipping' } } })}>Add fallback reward</button>}
  </section>;
}

export default function LivePromoEditor() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [program, setProgram] = useState<PromoProgram>(() => example('', ''));
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
      if (current) setProgram({ ...view.configuration, status: 'draft' });
    }).catch(cause => { if (current) setLoadError(auth.handleError(cause)); }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [auth, id]);

  async function save() {
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

  if (loading) return <p>Loading Promo draft…</p>;
  if (loadError) return <ErrorState error={loadError} retry={() => window.location.reload()} forceRetry />;

  return <main className="mx-auto max-w-4xl p-6 flex flex-col gap-5">
    <h1>{id ? 'Edit Promo draft' : 'Create Promo'}</h1>
    <label>External reference<input aria-label="External reference" disabled={Boolean(id)} value={program.id} onChange={event => setProgram({ ...program, id: event.target.value })}/></label>
    <label>Promo name<input aria-label="Promo name" value={program.name} onChange={event => setProgram({ ...program, name: event.target.value })}/></label>
    <label><input type="checkbox" checked={program.autoApply} onChange={event => setProgram(event.target.checked ? { ...program, autoApply: true } : { ...program, autoApply: false, code: program.code ?? '' })}/>Auto apply</label>
    {!program.autoApply && <label>Code<input value={program.code} onChange={event => setProgram({ ...program, code: event.target.value })}/></label>}
    {!id && <button type="button" onClick={() => setProgram(example(program.id, program.name))}>Use complete authoring example</button>}
    <section><h2>Eligibility</h2><ConditionBuilder value={program.eligibility} variables={variables} onChange={eligibility => setProgram({ ...program, eligibility })}/></section>
    <RewardRules program={program} variables={variables} change={setProgram}/>
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
      <label>Stacking group<input value={program.stackingGroup ?? ''} onChange={event => setProgram({ ...program, stackingGroup: event.target.value || undefined })}/></label>
      <label><input type="checkbox" checked={program.stackable} onChange={event => setProgram({ ...program, stackable: event.target.checked })}/>Stackable</label>
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
        setProgram({ ...comparison, status: 'draft' });
        setComparison(null);
        setConflictReference(null);
        setSaveError(null);
      }}>Replace authored draft with server version</button>
    </section>}
    <button type="button" disabled={!validation.success || !conditionsValid || freeShippingBudgetConflict || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save draft'}</button>
  </main>;
}
