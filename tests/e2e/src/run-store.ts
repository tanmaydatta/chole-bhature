import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RunIdSchema, type RunId } from './config.js';
import { manifestPath, readManifest, saveManifest, type Manifest } from './manifest.js';

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await stat(path);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new Error('E2E run directory must be private (mode 0700)');
  }
}

async function privateFile(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error('E2E secret file must be private (mode 0600)');
  }
  return readFile(path, 'utf8');
}

export function createRunStore(directory: string, rawRunId: string) {
  const runId: RunId = RunIdSchema.parse(rawRunId);
  const path = manifestPath(directory, runId);
  const proofPath = join(directory, `${runId}.proof`);
  const lockPath = join(directory, `${runId}.lock`);
  return {
    runId,
    manifestPath: path,
    proofPath,
    tokenPath(slug: string) {
      if (!/^[a-z][a-z0-9_]{0,39}$/u.test(slug)) throw new Error('Invalid token slug');
      return join(directory, `${runId}.${slug}.token`);
    },
    memberCookiePath(slug: string) {
      if (!/^[a-z][a-z0-9_]{0,39}$/u.test(slug)) throw new Error('Invalid member slug');
      return join(directory, `${runId}.${slug}.cookie`);
    },
    async save(manifest: Manifest): Promise<void> {
      if (manifest.runId !== runId) throw new Error('Manifest belongs to another run');
      await privateDirectory(directory);
      await saveManifest(path, manifest);
    },
    async read(): Promise<Manifest> {
      const manifest = await readManifest(path);
      if (manifest.runId !== runId) throw new Error('Manifest belongs to another run');
      return manifest;
    },
    async getOrCreateProof(): Promise<string> {
      await privateDirectory(directory);
      try {
        const proof = randomBytes(32).toString('base64url');
        const handle = await open(proofPath, 'wx', 0o600);
        try { await handle.writeFile(proof); } finally { await handle.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const proof = await privateFile(proofPath);
      if (!/^[A-Za-z0-9_-]{43}$/u.test(proof)) throw new Error('Invalid durable run proof');
      return proof;
    },
    async readProof(): Promise<string> {
      const proof = await privateFile(proofPath);
      if (!/^[A-Za-z0-9_-]{43}$/u.test(proof)) throw new Error('Invalid durable run proof');
      return proof;
    },
    async saveToken(slug: string, token: string): Promise<void> {
      await privateDirectory(directory);
      const handle = await open(this.tokenPath(slug), 'wx', 0o600);
      try { await handle.writeFile(token); } finally { await handle.close(); }
    },
    async readToken(slug: string): Promise<string> {
      return privateFile(this.tokenPath(slug));
    },
    async saveMemberCookie(slug: string, cookieHeader: string): Promise<void> {
      if (!cookieHeader || /[\r\n]/u.test(cookieHeader)) throw new Error('Invalid member cookie');
      await privateDirectory(directory);
      const path = this.memberCookiePath(slug);
      const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, cookieHeader, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    },
    async readMemberCookie(slug: string): Promise<string> {
      return privateFile(this.memberCookiePath(slug));
    },
    async lock(): Promise<{ release(): Promise<void> }> {
      await privateDirectory(directory);
      let handle;
      try {
        handle = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`E2E run ${runId} is already active; inspect its lock before retrying`);
        }
        throw error;
      }
      await handle.writeFile(`${process.pid}\n`);
      let released = false;
      return { async release() {
        if (released) return;
        released = true;
        await handle.close();
        await unlink(lockPath);
      } };
    },
  };
}
