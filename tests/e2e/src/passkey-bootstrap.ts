import { randomBytes } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { OperatorSessionViewSchema } from '@incentives/contracts';
import { z } from 'zod';

const RootBootstrapResultSchema = z.object({
  userId: z.string().min(1).refine(value => value.trim().length > 0), status: z.literal('pending'),
  activationGrant: z.string().min(1), expiresAt: z.number().int().positive().safe(),
}).strict();
type RootBootstrapResult = z.infer<typeof RootBootstrapResultSchema>;

export interface LocalRootStateOptions {
  operatorOrigin: string; expectedRootUserId: string; storageStatePath: string;
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
    return await publishLocalRootState(await verifiedLocalRootSnapshot(context, options), options);
  } catch { throw new Error('Local passkey root session verification or state publication failed'); }
}

async function verifiedLocalRootSnapshot(context: Pick<BrowserContext, 'request' | 'storageState'>,
  options: LocalRootStateOptions): Promise<string> {
  const response = await context.request.get(`${options.operatorOrigin}/operator/v1/session`,
    { failOnStatusCode: false, maxRedirects: 0 });
  if (response.status() !== 200) throw new Error();
  const session = OperatorSessionViewSchema.parse(await response.json());
  if (session.userId !== options.expectedRootUserId || session.platformRole !== 'root'
    || session.authenticationMethods.length !== 1
    || session.authenticationMethods[0] !== 'passkey') throw new Error();
  return JSON.stringify(await context.storageState());
}

async function publishLocalRootState(serialized: string, options: LocalRootStateOptions): Promise<string> {
  const temporary = join(dirname(options.storageStatePath),
    `.root-state-${randomBytes(16).toString('hex')}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  let published = false;
  try {
    await file.writeFile(serialized);
    await file.sync();
    await file.close();
    // link publishes a complete private file exclusively, including against symlinks.
    await link(temporary, options.storageStatePath);
    published = true;
  } catch {
    // Report the publication outcome after owned temporary-file cleanup.
  } finally {
    await file.close().catch(() => {});
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
  if (!options.activationGrant) throw new Error('Local root activation grant is required');
  try {
    let serialized: string;
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    try {
      const context = await browser.newContext({ baseURL: options.operatorOrigin });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
          protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
          hasUserVerification: true, isUserVerified: true,
          automaticPresenceSimulation: true,
        } });
        await page.goto(options.operatorOrigin);
        await page.getByRole('button', { name: 'Root setup or recovery' }).click();
        await page.getByLabel('Activation grant').fill(options.activationGrant);
        await page.getByRole('button', { name: 'Set up root passkey' }).click();
        await expect(page.getByRole('heading', { name: 'Save your root recovery codes' }))
          .toBeVisible({ timeout: 20_000 });
        await page.getByLabel('I have stored these recovery codes securely').check();
        await page.getByRole('button', { name: 'Finish setup' }).click();
        await page.getByRole('button', { name: 'Sign in with passkey' }).click();
        await expect(page.getByRole('heading', { name: 'Sign in to Incentives' }))
          .toBeHidden({ timeout: 20_000 });
        serialized = await verifiedLocalRootSnapshot(context, options);
      } finally { await context.close(); }
    } finally { await browser.close(); }
    // Finish owned browser cleanup before publishing a success artifact.
    return await publishLocalRootState(serialized, options);
  } catch { throw new Error('Local root passkey bootstrap failed; inspect the local Worker setup'); }
}
