import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';

import { BffClientError, bffClient, type RootRecoveryHandoff } from '../lib/bff-client';
import { ErrorState } from './ErrorState';

function passkeysAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined'
    && navigator.credentials?.get !== undefined
    && navigator.credentials.create !== undefined;
}

function safeError(cause: unknown): BffClientError {
  if (cause instanceof BffClientError) return cause;
  return new BffClientError(
    400,
    'PASSKEY_CANCELLED',
    'The passkey operation was not completed',
    false,
    'unavailable',
  );
}

export function RootAccess({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const supported = passkeysAvailable();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BffClientError | null>(null);
  const [activationGrant, setActivationGrant] = useState('');
  const [rootUserId, setRootUserId] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [handoff, setHandoff] = useState<RootRecoveryHandoff | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function signIn() {
    if (!supported) return;
    setPending(true);
    setError(null);
    try {
      const optionsJSON = await bffClient.passkeyAuthenticationOptions();
      const response = await startAuthentication({ optionsJSON });
      await bffClient.verifyPasskeyAuthentication(response);
      await onAuthenticated();
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setPending(false);
    }
  }

  async function registerAfterGrant(grant: string) {
    await bffClient.exchangeRootRecovery(grant);
    const optionsJSON = await bffClient.passkeyRegistrationOptions();
    const response = await startRegistration({ optionsJSON });
    await bffClient.verifyPasskeyRegistration(response, 'Root passkey');
    setHandoff(await bffClient.rotateRootRecoveryCodes());
  }

  async function setUp(event: React.FormEvent) {
    event.preventDefault();
    if (!supported) return;
    const grant = activationGrant;
    setActivationGrant('');
    setPending(true);
    setError(null);
    try {
      await registerAfterGrant(grant);
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setPending(false);
    }
  }

  async function recover(event: React.FormEvent) {
    event.preventDefault();
    if (!supported) return;
    const userId = rootUserId;
    const code = recoveryCode;
    setRecoveryCode('');
    setPending(true);
    setError(null);
    try {
      const grant = await bffClient.beginRootRecovery(userId, code);
      await registerAfterGrant(grant.grant);
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setPending(false);
    }
  }

  if (handoff) {
    return (
      <section className="mt-6 rounded-[10px] border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
        <h2 className="font-bold">Save your root recovery codes</h2>
        <p className="mt-1 text-[12px]">Each code can be used once. They will never be shown again.</p>
        <p className="mt-3 text-[12px]">Store this recovery user ID with the codes: <strong className="font-mono">{handoff.userId}</strong></p>
        <ul className="mt-3 grid grid-cols-1 gap-1 font-mono text-[12px]">
          {handoff.codes.map(code => <li key={code} className="break-all rounded bg-[var(--panel)] p-2">{code}</li>)}
        </ul>
        <label className="mt-4 flex items-start gap-2 text-[12px]">
          <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          I have stored these recovery codes securely
        </label>
        <button type="button" disabled={!acknowledged} className="mt-3 rounded-[7px] bg-[var(--accent)] px-3 py-2 text-white disabled:opacity-50" onClick={() => { setHandoff(null); setCompleted(true); setAcknowledged(false); }}>
          Finish setup
        </button>
      </section>
    );
  }

  return (
    <section className="mt-5 border-t border-[var(--border)] pt-5">
      <button type="button" disabled={!supported || pending} className="w-full rounded-[8px] border border-[var(--border)] px-4 py-2 font-semibold disabled:opacity-50" onClick={() => void signIn()}>
        {pending ? 'Waiting for passkey…' : 'Sign in with passkey'}
      </button>
      {!supported && <p role="status" className="mt-2 text-[12px] text-[var(--muted)]">Passkeys are not available in this browser.</p>}
      {completed && <p role="status" className="mt-3 text-[13px] text-[var(--green)]">Recovery complete. Sign in with your passkey.</p>}
      <button type="button" className="mt-4 text-[12px] font-semibold text-[var(--accent)] underline" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        Root setup or recovery
      </button>
      {expanded && (
        <div className="mt-4 space-y-5">
          <form className="space-y-3" onSubmit={setUp}>
            <h2 className="font-semibold">First root setup</h2>
            <label className="block text-[12px] font-semibold">Activation grant<input aria-label="Activation grant" type="password" autoComplete="off" required pattern="[A-Za-z0-9_-]{43}" value={activationGrant} onChange={event => setActivationGrant(event.target.value)} className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" /></label>
            <button type="submit" disabled={!supported || pending} className="rounded-[7px] bg-[var(--accent)] px-3 py-2 text-white disabled:opacity-50">Set up root passkey</button>
          </form>
          <form className="space-y-3 border-t border-[var(--border)] pt-4" onSubmit={recover}>
            <h2 className="font-semibold">Recover active root</h2>
            <label className="block text-[12px] font-semibold">Root user id<input aria-label="Root user id" required maxLength={128} value={rootUserId} onChange={event => setRootUserId(event.target.value)} className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" /></label>
            <label className="block text-[12px] font-semibold">Recovery code<input aria-label="Recovery code" type="password" autoComplete="off" required pattern="[A-Za-z0-9_-]{43}" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" /></label>
            <button type="submit" disabled={!supported || pending} className="rounded-[7px] bg-[var(--accent)] px-3 py-2 text-white disabled:opacity-50">Recover root</button>
          </form>
        </div>
      )}
      {error && <div className="mt-4"><ErrorState error={error} /></div>}
    </section>
  );
}
