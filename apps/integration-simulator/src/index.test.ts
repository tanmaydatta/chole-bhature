import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from './index.js';

describe('CLI entrypoint diagnostics and configuration', () => {
  // Break caught: argv secrets/bypass flags accepted, missing environment credentials, or raw file errors exposed.
  test.each([
    ['--secret-key', 'sk_private_should_not_print'], ['--bypass-production', 'true'],
    ['--origin', 'https://example.test', '--origin', 'https://other.test'], [],
  ])('rejects unknown/duplicate/missing arguments with safe stdout only', async args => {
    const output: string[] = [];
    expect(await runCli(args, { INCENTIVES_SECRET_KEY: 'sk_private_should_not_print' }, value => output.push(value))).toBe(1);
    expect(JSON.parse(output.join(''))).toEqual({ phase: 'configuration', code: 'INVALID_CONFIG' });
    expect(output.join('')).not.toContain('sk_private');
  });
  test('does not print private file paths or raw JSON parse failures', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'simulator-cli-test-'));
    try {
      const file = path.join(directory, 'private-customer-payload.json');
      await writeFile(file, '{"profile":"sensitive-customer-data"', { mode: 0o600 });
      const output: string[] = [];
      expect(await runCli(['--origin', 'http://127.0.0.1:1', '--environment', 'local', '--scenario', file],
        { INCENTIVES_SECRET_KEY: 'sk_private_should_not_print' }, value => output.push(value))).toBe(1);
      expect(JSON.parse(output.join(''))).toEqual({ phase: 'configuration', code: 'INVALID_CONFIG' });
      expect(output.join('')).not.toMatch(/private-customer|sensitive-customer|sk_private/u);
    } finally { await rm(directory, { recursive: true }); }
  });
  test('reports fixed help without reading credentials or making HTTP calls', async () => {
    const output: string[] = [];
    expect(await runCli(['--help'], {}, value => output.push(value))).toBe(0);
    expect(output.join('')).toContain('--scenario');
    expect(output.join('')).not.toContain('secret-key');
  });
});
