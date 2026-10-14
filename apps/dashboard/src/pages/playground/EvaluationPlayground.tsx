import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvaluationResponse, PublishedSchemaResponse, VariableDefinition } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { PageHeader } from '../../components/common/PageHeader';
import { bffClient, BffClientError } from '../../lib/bff-client';
import { buildEvaluationRequest, type PlaygroundInput } from './request-builder';

const panelClass = 'rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-5';
const inputClass = 'mt-1 w-full rounded-[7px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)]';
const buttonClass = 'rounded-[7px] border border-[var(--border)] px-3 py-2 font-semibold disabled:opacity-50';
function initialInput(): PlaygroundInput {
  return { currency: 'GBP', customerRef: '', codes: '', context: {}, cart: {},
    lines: [{ lineRef: 'line-1', productRef: '', quantity: '1', unitPrice: '', extensions: {} }] };
}

function ExtensionFields({ definitions, values, onChange, lineNumber }: {
  definitions: VariableDefinition[];
  values: Record<string, string>;
  onChange(name: string, value: string): void;
  lineNumber?: number;
}) {
  return <>{definitions.map(definition => {
    const name = definition.key.slice(definition.source.length + 1);
    const label = `${definition.label} (${definition.key})${lineNumber === undefined ? '' : ` — line ${lineNumber}`}`;
    return <label key={definition.key} className="block text-[12px] font-medium">{label}{definition.required && ' *'}
      {definition.type === 'boolean' || definition.type === 'enum'
        ? <select className={inputClass} aria-label={label} value={values[name] ?? ''} required={definition.required}
          onChange={event => onChange(name, event.target.value)}>
          <option value="">{definition.required ? 'Select a value' : 'Omit'}</option>
          {(definition.type === 'boolean' ? ['true', 'false'] : definition.enumValues ?? []).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        : <input className={inputClass} aria-label={label} value={values[name] ?? ''} required={definition.required}
          type={definition.type === 'date' ? 'date' : definition.type === 'number' ? 'number' : 'text'} step="any"
          onChange={event => onChange(name, event.target.value)} />}
      {definition.description && <span className="block text-[var(--muted)]">{definition.description}</span>}
    </label>;
  })}</>;
}

function Results({ result }: { result: EvaluationResponse }) {
  const price = result.priceBreakdown;
  return <section aria-label="Evaluation results" className={`${panelClass} space-y-4`}>
    <h2 className="text-[16px] font-semibold">Evaluation results</h2>
    <p className="text-[12px] text-[var(--muted)]">Evaluation {result.evaluationId}</p>
    <div className="flex flex-wrap gap-3 text-[12px]">
      <span>Schema version {result.schemaVersion}</span>
      {result.customerRef !== undefined ? <><span>Customer {result.customerRef}</span><span>Customer version {result.customerVersion ?? 'unavailable'}</span></> : <span>Anonymous customer</span>}
      <span>Expires <time dateTime={result.expiresAt}>{result.expiresAt}</time></span>
    </div>
    <dl className="grid gap-4 sm:grid-cols-3">
      {([
        ['Original merchandise subtotal', price.originalMerchandiseSubtotal],
        ['Total discount', price.totalDiscount],
        ['Discounted merchandise subtotal', price.discountedMerchandiseSubtotal],
      ] as const).map(([label, value]) => <div key={label} className="rounded-[8px] bg-[var(--bg)] p-3">
        <dt className="text-[12px] text-[var(--muted)]">{label}</dt>
        <dd className="mt-1 font-semibold">{value} {price.currency} minor units</dd>
      </div>)}
    </dl>
    <p className="text-[12px] text-[var(--muted)]">Merchandise only. Tax, shipping charges and payment totals are excluded. Free shipping adds no merchandise saving.</p>
    {result.decisions.length === 0 && <p>No Promo was selected.</p>}
    <div className="grid gap-3">{result.decisions.map(decision => <article key={`${decision.programRef}:${decision.programRevision}`} aria-label={`Promo ${decision.programRef}`} className="rounded-[8px] border border-[var(--border)] p-3">
      <h3 className="font-semibold">{decision.programRef}</h3>
      <p>Revision {decision.programRevision} · {decision.outcome}</p>
      {decision.rewardRuleRef && <p>Reward rule {decision.rewardRuleRef}</p>}
      <p>Reasons: {decision.reasonCodes.length === 0 ? 'None returned' : decision.reasonCodes.join(', ')}</p>
      {decision.message && <p>{decision.message}</p>}
      {decision.effects.some(effect => effect.type === 'free_shipping') && <p>Free shipping · zero merchandise saving</p>}
      {decision.effects.length > 0 && <details><summary>Decision effects</summary><pre className="overflow-auto text-[12px]">{JSON.stringify(decision.effects, null, 2)}</pre></details>}
    </article>)}</div>
    {price.discountAllocations.length > 0 && <div className="overflow-x-auto"><table aria-label="Promo discount allocations" className="w-full text-left text-[12px]">
      <thead><tr><th>Promo / revision</th><th>Reward rule</th><th>Discount minor units ({price.currency})</th><th>Line allocations</th></tr></thead>
      <tbody>{price.discountAllocations.map(allocation => <tr key={`${allocation.programRef}:${allocation.programRevision}:${allocation.rewardRuleRef}`} className="border-t border-[var(--border)]">
        <td className="py-2">{allocation.programRef} / {allocation.programRevision}</td><td>{allocation.rewardRuleRef}</td><td>{allocation.discountMinorUnits}</td>
        <td>{allocation.lineAllocations?.map(line => <p key={line.lineRef}>{line.lineRef}: {line.discountMinorUnits} minor units</p>) ?? '—'}</td>
      </tr>)}</tbody>
    </table></div>}
    {(result.codeResults?.length ?? 0) > 0 && <div className="overflow-x-auto"><table aria-label="Code diagnostics" className="w-full text-left text-[12px]">
      <thead><tr><th>Submitted code</th><th>Normalized code</th><th>Outcome</th><th>Promo</th><th>Reasons</th></tr></thead>
      <tbody>{result.codeResults?.map(code => <tr key={code.normalizedCode} className="border-t border-[var(--border)]">
        <td className="py-2">{code.code}</td><td>{code.normalizedCode}</td><td>{code.outcome}</td><td>{code.programRef ?? '—'}</td><td>{code.reasonCodes.join(', ') || 'None returned'}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

export default function EvaluationPlayground() {
  const { session, handleError } = useAuth();
  const merchantId = session?.merchantId;
  const [schema, setSchema] = useState<PublishedSchemaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [schemaError, setSchemaError] = useState<BffClientError | null>(null);
  const [input, setInput] = useState<PlaygroundInput>(initialInput);
  const [result, setResult] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState<BffClientError | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const schemaSequence = useRef(0);
  const evaluationSequence = useRef(0);
  const lineSequence = useRef(1);

  const loadSchema = useCallback(async () => {
    const sequence = ++schemaSequence.current;
    evaluationSequence.current += 1;
    setLoading(true); setSchema(null); setSchemaError(null); setResult(null); setError(null); setEvaluating(false); setValidation(null);
    setInput(initialInput()); lineSequence.current = 1;
    try {
      const published = await bffClient.publishedSchema();
      if (sequence === schemaSequence.current) setSchema(published);
    } catch (cause) {
      if (sequence === schemaSequence.current) setSchemaError(handleError(cause));
    } finally {
      if (sequence === schemaSequence.current) setLoading(false);
    }
  }, [handleError]);
  useEffect(() => {
    void loadSchema();
    return () => { schemaSequence.current += 1; evaluationSequence.current += 1; };
  }, [merchantId, loadSchema]);

  function change(update: (current: PlaygroundInput) => PlaygroundInput) {
    evaluationSequence.current += 1;
    setResult(null); setError(null); setValidation(null); setEvaluating(false); setInput(update);
  }
  async function evaluate() {
    if (!schema) return;
    let request;
    try { request = buildEvaluationRequest(input, schema.definitions); }
    catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Check the basket fields.'); return; }
    const sequence = ++evaluationSequence.current;
    setEvaluating(true); setError(null); setValidation(null); setResult(null);
    try {
      const response = await bffClient.evaluate(request);
      if (sequence === evaluationSequence.current) setResult(response);
    } catch (cause) {
      if (sequence === evaluationSequence.current) setError(handleError(cause));
    } finally {
      if (sequence === evaluationSequence.current) setEvaluating(false);
    }
  }
  const definitions = (source: VariableDefinition['source']) => schema?.definitions.filter(definition => definition.source === source) ?? [];
  return <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
    <PageHeader title="Evaluation Playground" />
    <p className="text-[13px] text-[var(--muted)]">Evaluate published Promos for a basket. Evaluation saves a signed decision snapshot; it does not redeem rewards or spend budgets and usage counters.</p>
    {loading && <p role="status">Loading published schema…</p>}
    {schemaError && <section className={panelClass}>
      {schemaError.status === 404 ? <p>Publish a schema in Variables before evaluating a basket.</p> : <ErrorState error={schemaError} />}
      <button className={`${buttonClass} mt-3`} type="button" onClick={() => void loadSchema()}>Reload published schema</button>
    </section>}
    {schema && <form noValidate onSubmit={event => { event.preventDefault(); void evaluate(); }} className={`${panelClass} space-y-5`}>
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Basket</h2><span className="text-[12px] text-[var(--muted)]">Published schema {schema.version}</span></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-[12px] font-medium">Currency<input className={inputClass} aria-label="Currency" maxLength={3} value={input.currency} onChange={event => change(current => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label>
        <label className="text-[12px] font-medium">Customer reference (optional)<input className={inputClass} aria-label="Customer reference (optional)" value={input.customerRef} onChange={event => change(current => ({ ...current, customerRef: event.target.value }))} /><span className="block text-[var(--muted)]">Leave empty for anonymous. Stored attributes are resolved by Core.</span></label>
        <label className="text-[12px] font-medium">Promo codes (optional)<textarea className={inputClass} aria-label="Promo codes (optional)" rows={2} value={input.codes} onChange={event => change(current => ({ ...current, codes: event.target.value }))} /><span className="block text-[var(--muted)]">Comma or newline separated; up to 10 distinct codes. Leave empty for automatic selection.</span></label>
      </div>
      <p className="text-[12px] text-[var(--muted)]">Enter unit prices as integer minor units (for example, GBP 12.50 = 1250). Merchandise subtotal is the sum of quantity × unit price. Keep line references unique and stable.</p>
      {input.lines.map((line, index) => <fieldset key={index} className="rounded-[8px] border border-[var(--border)] p-3">
        <legend className="px-1 text-[12px] font-semibold">Line {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-4">{(['lineRef', 'productRef', 'quantity', 'unitPrice'] as const).map(field => {
          const label = `${{ lineRef: 'Line reference', productRef: 'Product reference', quantity: 'Quantity', unitPrice: 'Unit price minor units' }[field]} ${index + 1}`;
          return <label key={field} className="text-[12px] font-medium">{label}<input className={inputClass} aria-label={label} value={line[field]}
            type={field === 'quantity' || field === 'unitPrice' ? 'number' : 'text'} min={field === 'quantity' ? 1 : field === 'unitPrice' ? 0 : undefined} step={1}
            onChange={event => change(current => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item) }))} /></label>;
        })}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><ExtensionFields definitions={definitions('line_item')} values={line.extensions} lineNumber={index + 1}
          onChange={(name, value) => change(current => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, extensions: { ...item.extensions, [name]: value } } : item) }))} /></div>
        <button type="button" className={`${buttonClass} mt-3 text-[12px]`} aria-label={`Remove line ${index + 1}`} onClick={() => change(current => ({ ...current, lines: current.lines.filter((_, itemIndex) => itemIndex !== index) }))}>Remove line</button>
      </fieldset>)}
      <button type="button" className={buttonClass} onClick={() => {
        const lineRef = `line-${++lineSequence.current}`;
        change(current => ({ ...current, lines: [...current.lines, { lineRef, productRef: '', quantity: '1', unitPrice: '', extensions: {} }] }));
      }}>Add line</button>
      {(definitions('context').length > 0 || definitions('cart').length > 0) && <section className="space-y-3"><h2 className="font-semibold">Published live fields</h2>
        <div className="grid gap-3 sm:grid-cols-3">{(['context', 'cart'] as const).map(source => <ExtensionFields key={source} definitions={definitions(source)} values={input[source]}
          onChange={(name, value) => change(current => ({ ...current, [source]: { ...current[source], [name]: value } }))} />)}</div>
      </section>}
      {validation && <p role="alert" className="text-[var(--danger)]">{validation}</p>}
      <button type="submit" disabled={evaluating} className={`${buttonClass} bg-[var(--accent)] text-white`}>{evaluating ? 'Evaluating…' : 'Evaluate'}</button>
    </form>}
    {error && <ErrorState error={error} />}
    {result && <Results result={result} />}
  </div>;
}
