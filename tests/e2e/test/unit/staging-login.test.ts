import { mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { parseStagingLoginArgs, savePrivateStorageState } from '../../src/staging-login.js';

const created: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(created.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function privateDirectory(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'e2e-stage-login-')));
  created.push(path);
  await chmod(path, 0o700);
  return path;
}

describe('interactive staging owner login', () => {
  test('requires an absolute output path and pins the staging origin', () => {
    expect(() => parseStagingLoginArgs(['--output', 'state.json'], {})).toThrow(/absolute/i);
    expect(() => parseStagingLoginArgs([], {})).toThrow(/--output/i);
    expect(() => parseStagingLoginArgs(['--output', '/private/tmp/state.json'], {
      E2E_OPERATOR_ORIGIN: 'https://evil.example',
    })).toThrow(/staging origin/i);
    expect(() => parseStagingLoginArgs(['--output', '/private/tmp/state.json'], {
      E2E_TARGET: 'local',
    })).toThrow(/staging/i);
    expect(parseStagingLoginArgs(['--output', '/private/tmp/state.json'], {}).target.operatorOrigin)
      .toBe('https://operator.staging.wastd.dev');
  });

  test('atomically writes a private state file and refuses overwrite', async () => {
    const directory = await privateDirectory();
    const output = join(directory, 'root-state.json');
    const state = { cookies: [{ name: 'session', value: 'redact-me', domain: 'operator.staging.wastd.dev',
      path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const }], origins: [] };
    await savePrivateStorageState(output, state);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(state);
    await expect(savePrivateStorageState(output, { cookies: [], origins: [] }))
      .rejects.toThrow(/already exists/i);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(state);
  });

  test('rejects unsafe destination directory and pre-existing symlink', async () => {
    const privatePath = await privateDirectory();
    const unsafe = await privateDirectory();
    await chmod(unsafe, 0o755);
    await expect(savePrivateStorageState(join(unsafe, 'state.json'), { cookies: [], origins: [] }))
      .rejects.toThrow(/private directory/i);
    const output = join(privatePath, 'state.json');
    await writeFile(join(privatePath, 'target.json'), 'existing');
    await symlink(join(privatePath, 'target.json'), output);
    await expect(savePrivateStorageState(output, { cookies: [], origins: [] }))
      .rejects.toThrow(/already exists/i);
    expect(await readFile(resolve(privatePath, 'target.json'), 'utf8')).toBe('existing');
  });

  test('removes its temporary file if serialization fails', async () => {
    const directory = await privateDirectory();
    const invalid: { cookies: unknown[]; origins: unknown[]; loop?: unknown } = {
      cookies: [], origins: [],
    };
    invalid.loop = invalid;
    await expect(savePrivateStorageState(join(directory, 'state.json'),
      invalid as never)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});
