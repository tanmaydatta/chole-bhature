import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerRecord, VariableDefinition } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { customerApi } from '../../data/customer-api';
import { schemaApi } from '../../data/schema-api';
import { BffClientError } from '../../lib/bff-client';

function fieldName(definition: VariableDefinition): string {
  return definition.key.slice('customer.'.length);
}

function parsedValue(definition: VariableDefinition, value: string): unknown {
  if (definition.type === 'number') return Number(value);
  if (definition.type === 'boolean') return value === 'true';
  return value;
}

export default function CustomerLookup() {
  const auth = useAuth();
  const canManage = auth.hasPermission('customers:manage');
  const [definitions, setDefinitions] = useState<VariableDefinition[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [reference, setReference] = useState('');
  const [resolvedReference, setResolvedReference] = useState<string | null>(null);
  const [record, setRecord] = useState<CustomerRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<BffClientError | null>(null);
  const [looking, setLooking] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const lookupSequence = useRef(0);
  const customerDefinitions = useMemo(
    () => definitions.filter(definition => definition.source === 'customer'), [definitions],
  );

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true); setError(null);
    try { setDefinitions((await schemaApi.published()).definitions); }
    catch (cause) { setError(auth.handleError(cause)); }
    finally { setSchemaLoading(false); }
  }, [auth]);
  useEffect(() => { void loadSchema(); }, [loadSchema]);

  function setFromRecord(next: CustomerRecord, exactReference: string) {
    setRecord(next); setMissing(false);
    setResolvedReference(exactReference);
    setValidationError(null);
    setValues(Object.fromEntries(customerDefinitions.map(definition => {
      const value = next.attributes[fieldName(definition)];
      return [fieldName(definition), value === undefined ? '' : String(value)];
    })));
  }

  async function lookup() {
    if (!reference) return;
    const exactReference = reference;
    const sequence = ++lookupSequence.current;
    setLooking(true); setError(null);
    setResolvedReference(null); setRecord(null); setMissing(false); setValues({}); setValidationError(null);
    try {
      const next = await customerApi.get(exactReference);
      if (sequence === lookupSequence.current) setFromRecord(next, exactReference);
    }
    catch (cause) {
      if (sequence !== lookupSequence.current) return;
      if (cause instanceof BffClientError && cause.status === 404) {
        setRecord(null); setMissing(true); setResolvedReference(exactReference);
        setValues(Object.fromEntries(customerDefinitions.map(definition => [fieldName(definition), ''])));
      } else setError(auth.handleError(cause));
    } finally { setLooking(false); }
  }

  async function save() {
    setError(null);
    setValidationError(null);
    if (!resolvedReference || resolvedReference !== reference) {
      setValidationError('Look up this exact customer reference before saving.');
      return;
    }
    const missingRequired = customerDefinitions.some(definition => (
      definition.required && (values[fieldName(definition)] ?? '') === ''
    ));
    if (missingRequired) {
      setValidationError('Complete all required customer fields.');
      return;
    }
    const attributes = Object.fromEntries(customerDefinitions.flatMap(definition => {
      const name = fieldName(definition);
      const value = values[name] ?? '';
      return value === '' && !definition.required ? [] : [[name, parsedValue(definition, value)]];
    }));
    try {
      const next = await customerApi.patch(resolvedReference, {
        attributes, ...(record ? { expectedVersion: record.version } : {}),
      });
      setFromRecord(next, resolvedReference);
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  if (schemaLoading) return <p>Loading published schema…</p>;
  if (error && !record && !missing) return <ErrorState error={error} retry={() => void loadSchema()} forceRetry />;

  return <div className="flex flex-col gap-4">
    <h1>Customers</h1>
    <p>Look up one exact customer reference. References are sent only to the same-origin operator service.</p>
    <div>
      <label>Customer reference<input aria-label="Customer reference" value={reference} onChange={event => {
        lookupSequence.current += 1;
        setReference(event.target.value);
        setResolvedReference(null); setRecord(null); setMissing(false); setValues({}); setValidationError(null); setError(null);
      }}/></label>
      <button type="button" disabled={looking} onClick={() => void lookup()}>Look up customer</button>
    </div>
    {missing && <p>No customer exists for this exact reference.</p>}
    {record && <p><span>Version {record.version}</span> · Updated {new Date(record.updatedAt).toLocaleString()}</p>}
    {error && <div><ErrorState error={error}/>{error.status === 409 && <button type="button" onClick={() => void lookup()}>Refresh customer</button>}</div>}
    {validationError && <p role="alert">{validationError}</p>}
    {(missing || record) && <form noValidate onSubmit={event => { event.preventDefault(); void save(); }} className="flex flex-col gap-3">
      {customerDefinitions.map(definition => {
        const name = fieldName(definition);
        const value = values[name] ?? '';
        if (definition.type === 'boolean') return <label key={name}>{definition.label}<select aria-label={definition.label} required={definition.required} value={value} onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))}><option value="">Select</option><option value="true">true</option><option value="false">false</option></select></label>;
        if (definition.type === 'enum') return <label key={name}>{definition.label}<select aria-label={definition.label} required={definition.required} value={value} onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))}><option value="">Select</option>{definition.enumValues?.map(option => <option key={option}>{option}</option>)}</select></label>;
        return <label key={name}>{definition.label}<input aria-label={definition.label} type={definition.type === 'number' ? 'number' : definition.type === 'date' ? 'date' : 'text'} required={definition.required} value={value} onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))}/></label>;
      })}
      {canManage && <button type="submit">{record ? 'Save customer' : 'Create customer'}</button>}
    </form>}
  </div>;
}
