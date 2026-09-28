import { randomBytes } from 'node:crypto';
import { lstat, link, open, realpath, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { chromium, request, type BrowserContext } from '@playwright/test';
import { OperatorSessionViewSchema } from '@incentives/contracts';

import { loadTarget, type Target } from './config.js';
import { OperatorClient } from './operator-client.js';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export function parseStagingLoginArgs(args: string[], env: NodeJS.ProcessEnv): {
  output: string; target: Target;
} {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new Error('Usage: pnpm e2e:staging:login --output /absolute/private/root-state.json');
  }
  if (!isAbsolute(args[1])) throw new Error('Storage-state output path must be absolute');
  if (env.E2E_TARGET && env.E2E_TARGET !== 'staging') {
    throw new Error('Staging login cannot use a non-staging E2E_TARGET');
  }
  const target = loadTarget({ ...env, E2E_TARGET: 'staging', E2E_ENABLE_STAGING: '1' });
  return { output: args[1], target };
}

export async function assertPrivateOutputPath(output: string): Promise<void> {
  if (!isAbsolute(output) || resolve(output) !== output) {
    throw new Error('Storage-state output path must be normalized and absolute');
  }
  const directory = dirname(output);
  const resolvedDirectory = await realpath(directory);
  const info = await stat(directory);
  if (resolvedDirectory !== directory || !info.isDirectory()
    || (info.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('Storage-state output requires an existing owner-owned private directory (mode 0700) without symlinks');
  }
  try {
    await lstat(output);
    throw new Error('Storage-state output already exists; choose a new private path');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function savePrivateStorageState(output: string, state: StorageState): Promise<void> {
  await assertPrivateOutputPath(output);
  const temporary = `${output}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(state), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Storage-state output already exists; choose a new private path');
      }
      throw error;
    }
  } finally {
    await unlink(temporary);
  }
}

async function isRootSession(context: BrowserContext, target: Target): Promise<boolean> {
  const response = await context.request.get(`${target.operatorOrigin}/operator/v1/session`, {
    headers: { origin: target.operatorOrigin }, failOnStatusCode: false,
  });
  if (response.status() === 401 || response.status() === 403) return false;
  if (!response.ok()) throw new Error(`Staging session check failed (${response.status()})`);
  const session = OperatorSessionViewSchema.safeParse(await response.json());
  return session.success && session.data.platformRole === 'root';
}

export async function runStagingLogin(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const { output, target } = parseStagingLoginArgs(args, env);
  await assertPrivateOutputPath(output);
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(target.operatorOrigin, { waitUntil: 'domcontentloaded' });
    process.stdout.write('Complete the normal owner passkey sign-in in Chrome. Waiting up to five minutes for a root session.\n');
    const deadline = Date.now() + 5 * 60_000;
    let authenticated = false;
    while (Date.now() < deadline && !page.isClosed()) {
      authenticated = await isRootSession(context, target);
      if (authenticated) break;
      await page.waitForTimeout(1_000);
    }
    if (!authenticated) throw new Error('A root passkey session was not established within five minutes');
    const state = await context.storageState();
    const verifier = await request.newContext({
      baseURL: target.operatorOrigin, storageState: state,
      extraHTTPHeaders: { origin: target.operatorOrigin },
    });
    try {
      await new OperatorClient(verifier, target.operatorOrigin).requireRoot();
    } finally {
      await verifier.dispose();
    }
    await savePrivateStorageState(output, state);
    process.stdout.write(`Saved a verified root browser state to ${output}. Re-run login with a new path when the session expires.\n`);
  } finally {
    await browser.close();
  }
}
