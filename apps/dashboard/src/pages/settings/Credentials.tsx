import { useCallback, useEffect, useState } from 'react';
import type {
  ApiCredentialCreateInput,
  ApiCredentialKind,
  ApiCredentialScope,
  ApiCredentialView,
  DeploymentEnvironment,
} from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { BffClientError, bffClient } from '../../lib/bff-client';
import { isoToLocalDateTime, localDateTimeToIso } from '../../lib/credential-datetime';

const allScopes: ApiCredentialScope[] = [
  'schema:read', 'customers:write', 'evaluations:write', 'redemptions:write',
];
const publishableScopes = new Set<ApiCredentialScope>(['schema:read', 'evaluations:write']);

function displayDate(value: string): string {
  return new Date(value).toLocaleString();
}

export default function Credentials() {
  const auth = useAuth();
  const canManage = auth.hasPermission('credentials:manage');
  const [credentials, setCredentials] = useState<ApiCredentialView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BffClientError | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ApiCredentialKind>('secret');
  const [environment, setEnvironment] = useState<DeploymentEnvironment>('local');
  const [scopes, setScopes] = useState<ApiCredentialScope[]>(['schema:read']);
  const [allowedOrigins, setAllowedOrigins] = useState('');
  const [requestsPerMinute, setRequestsPerMinute] = useState(60);
  const [expiresAt, setExpiresAt] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCredentials(await bffClient.credentials());
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => { void load(); }, [load]);

  function origins(): string[] {
    return allowedOrigins.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const base = {
      name, environment, scopes,
      ...(expiresAt ? { expiresAt: localDateTimeToIso(expiresAt) } : {}),
    };
    const input: ApiCredentialCreateInput = kind === 'publishable'
      ? { ...base, kind, requestsPerMinute, allowedOrigins: origins() }
      : { ...base, kind };
    try {
      const result = await bffClient.createCredential(input);
      setCredentials(current => [...current, result.credential]);
      setToken(result.token);
      setName('');
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(credential: ApiCredentialView) {
    if (revokingId || !window.confirm(
      `Revoke ${credential.name}? Requests using it will fail immediately.`,
    )) return;
    setRevokingId(credential.id);
    setError(null);
    try {
      const revoked = await bffClient.revokeCredential(credential.id);
      setCredentials(current => current.map(item => item.id === credential.id ? revoked : item));
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setRevokingId(null);
    }
  }

  function changeKind(next: ApiCredentialKind) {
    setKind(next);
    if (next === 'publishable') {
      setScopes(current => current.filter(scope => publishableScopes.has(scope)));
    }
  }

  function toggleScope(scope: ApiCredentialScope) {
    setScopes(current => current.includes(scope)
      ? current.filter(item => item !== scope)
      : [...current, scope]);
  }

  function replace(credential: ApiCredentialView) {
    setName(`${credential.name} replacement`);
    setKind(credential.kind);
    setEnvironment(credential.environment);
    setScopes([...credential.scopes]);
    setExpiresAt(isoToLocalDateTime(credential.expiresAt));
    if (credential.kind === 'publishable') {
      setAllowedOrigins(credential.allowedOrigins.join('\n'));
      setRequestsPerMinute(credential.requestsPerMinute);
    } else {
      setAllowedOrigins('');
    }
  }

  const productionOriginsRequired = kind === 'publishable' && environment === 'production';

  return (
    <section className="space-y-5">
      <div><h2 className="text-[20px] font-bold">Credentials</h2><p className="mt-1 text-[13px] text-[var(--muted)]">Create a replacement before revoking the old key for zero-downtime rotation.</p></div>
      {canManage && (
        <form className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-4" onSubmit={create}>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-[13px] font-semibold">Credential name<input aria-label="Credential name" className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" required value={name} onChange={event => setName(event.target.value)} /></label>
            <label className="text-[13px] font-semibold">Kind<select aria-label="Credential kind" className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" value={kind} onChange={event => changeKind(event.target.value as ApiCredentialKind)}><option value="secret">Secret key</option><option value="publishable">Publishable key</option></select></label>
            <label className="text-[13px] font-semibold">Environment<select aria-label="Credential environment" className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" value={environment} onChange={event => setEnvironment(event.target.value as DeploymentEnvironment)}><option value="local">Local</option><option value="staging">Staging</option><option value="production">Production</option></select></label>
          </div>
          <label className="block text-[13px] font-semibold">Expires at (optional)<input aria-label="Expires at" type="datetime-local" className="mt-1 rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
          <fieldset><legend className="text-[13px] font-semibold">Scopes</legend><div className="mt-2 flex flex-wrap gap-3">{allScopes.map(scope => {
            const disabled = kind === 'publishable' && !publishableScopes.has(scope);
            return <label key={scope} className="text-[12px]"><input aria-label={scope} type="checkbox" disabled={disabled} checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /> {scope}</label>;
          })}</div></fieldset>
          {kind === 'publishable' && <div className="grid grid-cols-2 gap-3"><label className="text-[13px] font-semibold">Allowed exact origins (one per line)<textarea aria-label="Allowed exact origins" required={productionOriginsRequired} className="mt-1 min-h-24 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" value={allowedOrigins} onChange={event => setAllowedOrigins(event.target.value)} /></label><label className="text-[13px] font-semibold">Requests per minute<input aria-label="Requests per minute" type="number" min={1} max={10000} required className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" value={requestsPerMinute} onChange={event => setRequestsPerMinute(Number(event.target.value))} /></label></div>}
          <button type="submit" disabled={submitting || scopes.length === 0 || (productionOriginsRequired && origins().length === 0)} className="rounded-[7px] bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-60">{submitting ? 'Creating…' : 'Create credential'}</button>
        </form>
      )}
      {token && <div role="alert" className="rounded-[10px] border border-[var(--accent)] bg-[var(--accent-soft)] p-4"><h3 className="font-semibold">Copy the new token now</h3><code className="mt-2 block break-all rounded bg-[var(--panel)] p-3">{token}</code><p className="mt-2 text-[12px]">This token is shown once and will be lost when dismissed or you leave this page.</p><button type="button" className="mt-3 rounded-[7px] border border-[var(--border)] px-3 py-1" onClick={() => setToken(null)}>Dismiss token</button></div>}
      {error && <ErrorState error={error} retry={error.retryable ? () => void load() : undefined} />}
      {loading ? <p>Loading credentials…</p> : credentials.length === 0 ? <p className="rounded-[10px] border border-dashed border-[var(--border)] p-6 text-[var(--muted)]">No credentials yet.</p> : <ul className="space-y-3">{credentials.map(credential => <li key={credential.id} className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-start justify-between gap-4"><div className="space-y-1"><h3 className="font-semibold">{credential.name}</h3><p className="text-[12px] text-[var(--muted)]">{credential.kind === 'secret' ? 'Secret key' : 'Publishable key'} · ••••{credential.suffix}</p><p className="text-[12px] capitalize">{credential.status} · {credential.environment}</p><p className="text-[12px]">Scopes: {credential.scopes.join(', ')}</p><p className="text-[12px]">Created {displayDate(credential.createdAt)} · Created by {credential.createdBy}</p>{credential.expiresAt && <p className="text-[12px]">Expires {displayDate(credential.expiresAt)}</p>}{credential.lastUsedAt && <p className="text-[12px]">Last used {displayDate(credential.lastUsedAt)}</p>}{credential.kind === 'publishable' && <><p className="text-[12px]">{credential.requestsPerMinute} requests/minute</p><ul className="text-[12px]">{credential.allowedOrigins.length === 0 ? <li>No origin restrictions in this environment</li> : credential.allowedOrigins.map(origin => <li key={origin}>{origin}</li>)}</ul></>}</div>{canManage && credential.status === 'active' && <div className="flex gap-2"><button type="button" disabled={submitting || revokingId !== null} className="rounded-[7px] border border-[var(--border)] px-3 py-1 disabled:opacity-50" onClick={() => replace(credential)}>Replace {credential.name}</button><button type="button" disabled={revokingId !== null} className="rounded-[7px] border border-[var(--border)] px-3 py-1 disabled:opacity-50" onClick={() => void revoke(credential)}>{revokingId === credential.id ? 'Revoking…' : `Revoke ${credential.name}`}</button></div>}</li>)}</ul>}
    </section>
  );
}
