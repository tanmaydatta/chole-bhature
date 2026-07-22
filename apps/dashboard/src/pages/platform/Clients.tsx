import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientProvisioningView } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { BffClientError, bffClient } from '../../lib/bff-client';

function newIdempotencyKey(): string {
  return `dashboard-${crypto.randomUUID()}`;
}

export default function Clients() {
  const auth = useAuth();
  const [clients, setClients] = useState<ClientProvisioningView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BffClientError | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClients(await bffClient.clients());
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => { void load(); }, [load]);

  async function provision(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const client = await bffClient.provisionClient(name, idempotencyKey.current);
      setClients(current => [...current.filter(item => item.provisioningId !== client.provisioningId), client]);
      setName('');
      idempotencyKey.current = newIdempotencyKey();
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setPending(false);
    }
  }

  async function retry(client: ClientProvisioningView) {
    setError(null);
    try {
      const next = await bffClient.retryProvisioning(client.provisioningId);
      setClients(current => current.map(item => item.provisioningId === next.provisioningId ? next : item));
    } catch (cause) {
      setError(auth.handleError(cause));
    }
  }

  async function select(client: ClientProvisioningView) {
    setError(null);
    try {
      await bffClient.selectMerchant(client.merchantId);
      await auth.refresh();
    } catch (cause) {
      setError(auth.handleError(cause));
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-[20px] font-bold">Platform clients</h2>
        {auth.session?.merchantSelectionRequired && (
          <p className="mt-2 rounded-[8px] border border-[var(--accent)] bg-[var(--accent-soft)] p-3 text-[13px]">
            Select a client to use merchant settings.
          </p>
        )}
      </div>
      <form className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-end gap-3" onSubmit={provision}>
        <label className="flex-1 text-[13px] font-semibold">
          Client name
          <input className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" required maxLength={200} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <button type="submit" disabled={pending} className="rounded-[7px] bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-60">
          {pending ? 'Provisioning…' : 'Provision client'}
        </button>
      </form>
      {error && <ErrorState error={error} retry={error.retryable ? () => void load() : undefined} />}
      {loading ? <p>Loading clients…</p> : clients.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[var(--border)] p-6 text-[var(--muted)]">No clients yet.</p>
      ) : (
        <ul className="space-y-3">
          {clients.map(client => (
            <li key={client.provisioningId} className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">{client.name}</h3>
                <p className="text-[12px] text-[var(--muted)]">{client.merchantId}</p>
                <p className="mt-1 text-[12px] capitalize">{client.status === 'active' ? 'Active' : client.status}</p>
                {client.failedStep && <p className="text-[12px] text-[var(--muted)]">Failed at {client.failedStep}</p>}
              </div>
              <div className="flex gap-2">
                {client.status === 'failed' && client.retryable && (
                  <button type="button" className="rounded-[7px] border border-[var(--border)] px-3 py-2" onClick={() => void retry(client)}>
                    Retry {client.name}
                  </button>
                )}
                {client.status === 'active' && (
                  <button type="button" className="rounded-[7px] bg-[var(--accent)] px-3 py-2 text-white" onClick={() => void select(client)}>
                    Select {client.name}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
