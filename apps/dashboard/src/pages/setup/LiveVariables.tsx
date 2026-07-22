import { useCallback, useEffect, useState } from 'react';
import {
  OperatorSchemaDefinitionRequestSchema,
  type SchemaDefinitionImpactPreview,
  type SchemaDefinitionView,
  type VariableDefinition,
  type VariableSource,
  type VariableType,
} from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { PageHeader } from '../../components/common/PageHeader';
import { schemaApi } from '../../data/schema-api';
import { BffClientError } from '../../lib/bff-client';

const sources: VariableSource[] = ['customer', 'context', 'cart', 'line_item', 'event', 'system'];
const types: VariableType[] = ['string', 'number', 'boolean', 'enum', 'date'];

const emptyDefinition: VariableDefinition = {
  key: '', label: '', source: 'customer', type: 'string', required: false,
};

export default function LiveVariables() {
  const auth = useAuth();
  const canManage = auth.hasPermission('schemas:manage');
  const canPublish = auth.hasPermission('schemas:publish');
  const [definitions, setDefinitions] = useState<SchemaDefinitionView[]>([]);
  const [draftVersion, setDraftVersion] = useState<number>();
  const [publishedVersion, setPublishedVersion] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BffClientError | null>(null);
  const [form, setForm] = useState<VariableDefinition | null>(null);
  const [editing, setEditing] = useState<SchemaDefinitionView | null>(null);
  const [impact, setImpact] = useState<SchemaDefinitionImpactPreview | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    item: SchemaDefinitionView;
    impact: SchemaDefinitionImpactPreview;
    action: 'delete' | 'deprecate';
  } | null>(null);
  const [notice, setNotice] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await schemaApi.list();
      setDefinitions(result.definitions);
      setDraftVersion(result.draftVersion);
      setPublishedVersion(result.publishedVersion);
    } catch (cause) { setError(auth.handleError(cause)); }
    finally { setLoading(false); }
  }, [auth]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError(null);
    try {
      const input = OperatorSchemaDefinitionRequestSchema.parse(form);
      if (editing) {
        await schemaApi.update(editing.id, input);
      } else {
        await schemaApi.create(input);
      }
      setForm(null);
      setEditing(null);
      await load();
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  async function preview(item: SchemaDefinitionView) {
    setError(null);
    try { setImpact(await schemaApi.impact(item.id)); }
    catch (cause) { setError(auth.handleError(cause)); }
  }

  async function publish() {
    setError(null);
    try {
      const result = await schemaApi.publish();
      setNotice(result.warnings.map(warning => warning.message));
      await load();
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  async function remove(item: SchemaDefinitionView) {
    setError(null);
    try {
      const nextImpact = await schemaApi.impact(item.id);
      const action = nextImpact.publishedVersions.length > 0 || nextImpact.referencedProgramRefs.length > 0
        ? 'deprecate' : 'delete';
      setImpact(nextImpact);
      setPendingRemoval({ item, impact: nextImpact, action });
    }
    catch (cause) { setError(auth.handleError(cause)); return; }
  }

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    setError(null);
    try {
      if (pendingRemoval.action === 'deprecate') await schemaApi.deprecate(pendingRemoval.item.id);
      else await schemaApi.remove(pendingRemoval.item.id);
      setPendingRemoval(null);
      setImpact(null);
      await load();
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  async function edit(item: SchemaDefinitionView) {
    setError(null);
    try {
      setImpact(await schemaApi.impact(item.id));
      setEditing(item);
      setForm(item.definition);
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  if (loading) return <p>Loading schema…</p>;
  if (error) return <ErrorState error={error} retry={() => void load()} forceRetry />;

  return <div className="flex flex-col gap-4">
    <PageHeader title="Variables" action={<div className="flex gap-2">
      {canPublish && <button type="button" onClick={() => void publish()}>Publish schema</button>}
      {canManage && <button type="button" onClick={() => { setEditing(null); setForm(emptyDefinition); }}>New variable</button>}
    </div>} />
    <p><span>{draftVersion ? `Draft version ${draftVersion}` : 'No draft version'}</span> · <span>{publishedVersion ? `Published version ${publishedVersion}` : 'Not published'}</span></p>
    {notice.map(message => <p role="status" key={message}>{message}</p>)}
    {impact && <section aria-label="Definition impact">
      <p>Published versions: {impact.publishedVersions.join(', ') || 'none'}.</p>
      <p>Referenced programs: {impact.referencedProgramRefs.join(', ') || 'none'}.</p>
      <p>{impact.storedCustomerCount} stored customers; {impact.incompatibleCustomerCount} incompatible.</p>
      {impact.warnings.map(warning => <p key={warning.code}>{warning.message}</p>)}
      {pendingRemoval && <button type="button" onClick={() => void confirmRemoval()}>
        Confirm {pendingRemoval.action} {pendingRemoval.item.definition.key}
      </button>}
    </section>}
    {definitions.length === 0 ? <p>No variables have been defined.</p> : <table>
      <thead><tr><th>Variable</th><th>Type</th><th>Source</th><th>Lifecycle</th><th>Actions</th></tr></thead>
      <tbody>{definitions.map(item => <tr key={item.id}>
        <td>{item.definition.label}<br/><code>{item.definition.key}</code></td>
        <td>{item.definition.type}</td><td>{item.definition.source}</td>
        <td>{item.readOnly ? 'Read only' : item.referenced ? 'Referenced' : 'Draft'}</td>
        <td>
          <button type="button" aria-label={`Impact ${item.definition.key}`} onClick={() => void preview(item)}>Impact</button>
          {canManage && !item.readOnly && <button type="button" onClick={() => void edit(item)}>Edit</button>}
          {canManage && !item.readOnly && <button type="button" onClick={() => void remove(item)}>{item.referenced ? 'Deprecate' : 'Delete'}</button>}
        </td>
      </tr>)}</tbody>
    </table>}
    {form && <form onSubmit={save} className="rounded border p-4 flex flex-col gap-3">
      <label>Key<input aria-label="Key" disabled={Boolean(editing?.referenced || editing?.readOnly)} value={form.key} onChange={event => setForm({ ...form, key: event.target.value })}/></label>
      <label>Label<input aria-label="Label" value={form.label} onChange={event => setForm({ ...form, label: event.target.value })}/></label>
      <label>Source<select aria-label="Source" disabled={Boolean(editing?.referenced || editing?.readOnly)} value={form.source} onChange={event => {
        const source = event.target.value as VariableSource;
        const suffix = form.key.includes('.') ? form.key.split('.').slice(1).join('.') : '';
        setForm({ ...form, source, key: suffix ? `${source}.${suffix}` : form.key });
      }}>{sources.map(source => <option key={source}>{source}</option>)}</select></label>
      <label>Type<select aria-label="Type" disabled={Boolean(editing?.referenced || editing?.readOnly)} value={form.type} onChange={event => {
        const type = event.target.value as VariableType;
        setForm({ ...form, type, ...(type === 'enum' ? { enumValues: ['value'] } : { enumValues: undefined }) });
      }}>{types.map(type => <option key={type}>{type}</option>)}</select></label>
      {form.type === 'enum' && <label>Enum values<input aria-label="Enum values" value={form.enumValues?.join(', ') ?? ''} onChange={event => setForm({ ...form, enumValues: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })}/></label>}
      <label><input aria-label="Required" type="checkbox" checked={form.required} onChange={event => setForm({ ...form, required: event.target.checked })}/>Required</label>
      <label>Description<textarea value={form.description ?? ''} onChange={event => setForm({ ...form, description: event.target.value || undefined })}/></label>
      <label>Default error message<textarea value={form.defaultErrorMessage ?? ''} onChange={event => setForm({ ...form, defaultErrorMessage: event.target.value || undefined })}/></label>
      <div><button type="submit">Save variable</button><button type="button" onClick={() => { setForm(null); setEditing(null); }}>Cancel</button></div>
    </form>}
  </div>;
}
