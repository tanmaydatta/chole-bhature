import { randomBytes } from 'node:crypto';
import { link, open, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test';
import { OperatorSessionViewSchema } from '@incentives/contracts';
import { z } from 'zod';

const RootBootstrapResultSchema = z.object({
  userId: z.string().min(1).refine(value => value.trim().length > 0), status: z.literal('pending'),
  activationGrant: z.string().min(1), expiresAt: z.number().int().positive().safe(),
}).strict();
type RootBootstrapResult = z.infer<typeof RootBootstrapResultSchema>;

export const localPasskeyPhases = ['passkey-browser-launch', 'passkey-context-init', 'passkey-page-init',
  'passkey-webauthn', 'passkey-page-navigation', 'passkey-root-activation',
  'passkey-recovery-confirmation', 'passkey-signin', 'passkey-session-verification',
  'passkey-state-snapshot', 'passkey-context-close', 'passkey-browser-close',
  'passkey-state-publication'] as const;
type LocalPasskeyPhase = typeof localPasskeyPhases[number];

export interface LocalRootStateOptions {
  operatorOrigin: string; expectedRootUserId: string; storageStatePath: string; signal?: AbortSignal;
  owner?: { own(stop: () => Promise<void>): void; phase?(value: LocalPasskeyPhase): void };
}

function active(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Local passkey operation cancelled');
}

// Abort closes acquired browsers now, and closes late launch fulfillment before use.
async function withLocalPasskeyResource<Resource extends { close(): Promise<void> }, Result>(
  launch: () => Promise<Resource>, use: (resource: Resource) => Promise<Result>, signal?: AbortSignal,
  owner?: LocalRootStateOptions['owner'], closingPhase?: LocalPasskeyPhase,
  beforeClose?: () => Promise<void>): Promise<Result> {
  active(signal);
  let acquisition: Promise<Resource>;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    if (closingPhase && !beforeClose) owner?.phase?.(closingPhase);
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local passkey cleanup deadline exceeded')), 10_000);
    });
    // One bound covers pending acquisition and late close; failure stays owned.
    const disposal = acquisition.then(async resource => {
      let dependencyFailed = false;
      // Share the total deadline: even an unfulfilled hook cannot prevent the
      // enclosing close attempt, and arbitrary use is never awaited here.
      try { await Promise.race([Promise.resolve().then(() => beforeClose?.()), deadline]); }
      catch { dependencyFailed = true; }
      if (closingPhase && beforeClose) owner?.phase?.(closingPhase);
      // Always attempt the enclosing browser, even if nested cleanup failed.
      await resource.close();
      if (dependencyFailed) throw new Error('Local passkey nested cleanup incomplete');
    });
    closing = Promise.race([disposal, deadline])
      .finally(() => clearTimeout(timer));
    return closing;
  };
  // Register before the factory can run, including cancellation during launch.
  owner?.own(close);
  acquisition = Promise.resolve().then(() => { active(signal); return launch(); });
  let interrupt!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    interrupt = () => reject(new Error('Local passkey operation cancelled'));
  });
  signal?.addEventListener('abort', interrupt, { once: true });
  const operation = acquisition.then(async acquired => {
    active(signal);
    return use(acquired);
  });
  let failed = false;
  let failure: unknown;
  let result: Result | undefined;
  try { result = await Promise.race([operation, cancelled]); }
  catch (error) { failed = true; failure = error; }
  signal?.removeEventListener('abort', interrupt);
  // Both operation and late disposal retain rejection handlers after a deadline.
  try { await close(); } catch {
    const primary = `Local passkey operation ${signal?.aborted ? 'cancelled' : 'failed'}`;
    throw new AggregateError([new Error(primary), new Error('Local passkey cleanup incomplete')],
      `${primary}; cleanup incomplete`);
  }
  if (failed) throw failure;
  return result as Result;
}

export function withLocalPasskeyBrowser<Result>(launch: () => Promise<Browser>,
  use: (browser: Browser) => Promise<Result>, signal?: AbortSignal,
  owner?: LocalRootStateOptions['owner'], beforeClose?: () => Promise<void>): Promise<Result> {
  return withLocalPasskeyResource(launch, use, signal, owner, 'passkey-browser-close', beforeClose);
}

export function withLocalPasskeyContext<Result>(create: () => Promise<BrowserContext>,
  use: (context: BrowserContext) => Promise<Result>, signal?: AbortSignal,
  owner?: LocalRootStateOptions['owner']): Promise<Result> {
  return withLocalPasskeyResource(create, use, signal, owner, 'passkey-context-close');
}

export function parseLocalRootBootstrapResult(raw: string): RootBootstrapResult {
  try { return RootBootstrapResultSchema.parse(JSON.parse(raw)); }
  catch { throw new Error('Local root bootstrap returned an invalid result'); }
}

function requireLocalOptions(options: LocalRootStateOptions): void {
  try {
    const origin = new URL(options.operatorOrigin);
    if (origin.origin !== options.operatorOrigin || origin.protocol !== 'http:'
      || !['localhost', '127.0.0.1'].includes(origin.hostname)
      || !origin.port || Number(origin.port) === 0
      || !options.expectedRootUserId.trim() || !isAbsolute(options.storageStatePath)) {
      throw new Error();
    }
  } catch { throw new Error('Passkey bootstrap requires a local origin and expected root identity'); }
}

export async function saveLocalPasskeyRootState(
  context: Pick<BrowserContext, 'request' | 'storageState'>,
  options: LocalRootStateOptions,
): Promise<string> {
  requireLocalOptions(options);
  try {
    active(options.signal);
    return await publishLocalRootState(await verifiedLocalRootSnapshot(context, options), options);
  } catch { throw new Error('Local passkey root session verification or state publication failed'); }
}

async function verifiedLocalRootSnapshot(context: Pick<BrowserContext, 'request' | 'storageState'>,
  options: LocalRootStateOptions): Promise<string> {
  active(options.signal);
  options.owner?.phase?.('passkey-session-verification');
  const response = await context.request.get(`${options.operatorOrigin}/operator/v1/session`,
    { failOnStatusCode: false, maxRedirects: 0 });
  if (response.status() !== 200) throw new Error();
  const session = OperatorSessionViewSchema.parse(await response.json());
  if (session.userId !== options.expectedRootUserId || session.platformRole !== 'root'
    || session.authenticationMethods.length !== 1
    || session.authenticationMethods[0] !== 'passkey') throw new Error();
  options.owner?.phase?.('passkey-state-snapshot');
  const snapshot = await context.storageState();
  active(options.signal);
  return JSON.stringify(snapshot);
}

async function publishLocalRootState(serialized: string, options: LocalRootStateOptions): Promise<string> {
  active(options.signal);
  options.owner?.phase?.('passkey-state-publication');
  const temporary = join(dirname(options.storageStatePath),
    `.root-state-${randomBytes(16).toString('hex')}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  let identity: Awaited<ReturnType<typeof file.stat>> | undefined;
  let published = false;
  try {
    active(options.signal);
    identity = await file.stat();
    await file.writeFile(serialized);
    await file.sync();
    await file.close();
    active(options.signal);
    // link publishes a complete private file exclusively, including against symlinks.
    await link(temporary, options.storageStatePath);
    published = true;
    active(options.signal);
  } catch {
    // Report the publication outcome after owned temporary-file cleanup.
  } finally {
    await file.close().catch(() => {});
    if (published && options.signal?.aborted) {
      const current = await stat(options.storageStatePath).catch(() => undefined);
      if (identity && current?.ino === identity.ino && current.dev === identity.dev) {
        await unlink(options.storageStatePath);
      }
      published = false;
    }
    try { await unlink(temporary); }
    catch {
      // The owning local stack removes any residual private temporary file.
      // Preserve successful publication or the earlier write/link failure.
    }
  }
  if (!published) throw new Error('Local root state publication failed');
  return options.storageStatePath;
}

export async function bootstrapLocalRootPasskey(
  options: LocalRootStateOptions & { activationGrant: string },
): Promise<string> {
  requireLocalOptions(options);
  active(options.signal);
  if (!options.activationGrant) throw new Error('Local root activation grant is required');
  try {
    let closeContext: (() => Promise<void>) | undefined;
    const contextOwner: NonNullable<LocalRootStateOptions['owner']> = {
      own(stop) { closeContext = stop; options.owner?.own(stop); },
      phase(value) { options.owner?.phase?.(value); },
    };
    const serialized = await withLocalPasskeyBrowser(() => {
      options.owner?.phase?.('passkey-browser-launch');
      return chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    }, async browser => {
      return await withLocalPasskeyContext(() => {
        options.owner?.phase?.('passkey-context-init');
        return browser.newContext({ baseURL: options.operatorOrigin });
      }, async context => {
        active(options.signal);
        options.owner?.phase?.('passkey-page-init');
        const page = await context.newPage();
        options.owner?.phase?.('passkey-webauthn');
        const cdp = await context.newCDPSession(page);
        await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
          protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
          hasUserVerification: true, isUserVerified: true,
          automaticPresenceSimulation: true,
        } });
        options.owner?.phase?.('passkey-page-navigation');
        await page.goto(options.operatorOrigin);
        options.owner?.phase?.('passkey-root-activation');
        await page.getByRole('button', { name: 'Root setup or recovery' }).click();
        await page.getByLabel('Activation grant').fill(options.activationGrant);
        await page.getByRole('button', { name: 'Set up root passkey' }).click();
        options.owner?.phase?.('passkey-recovery-confirmation');
        await expect(page.getByRole('heading', { name: 'Save your root recovery codes' }))
          .toBeVisible({ timeout: 20_000 });
        await page.getByLabel('I have stored these recovery codes securely').check();
        await page.getByRole('button', { name: 'Finish setup' }).click();
        options.owner?.phase?.('passkey-signin');
        await page.getByRole('button', { name: 'Sign in with passkey' }).click();
        await expect(page.getByRole('heading', { name: 'Sign in to Incentives' }))
          .toBeHidden({ timeout: 20_000 });
        return await verifiedLocalRootSnapshot(context, options);
      }, options.signal, contextOwner);
    }, options.signal, options.owner, async () => { await closeContext?.(); });
    // Finish owned browser cleanup before publishing a success artifact.
    return await publishLocalRootState(serialized, options);
  } catch { throw new Error('Local root passkey bootstrap failed; inspect the local Worker setup'); }
}
