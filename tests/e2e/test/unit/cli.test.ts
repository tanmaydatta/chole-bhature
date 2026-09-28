import { describe, expect, test } from 'vitest';

import { parseCommand } from '../../src/cli.js';

describe('recipe CLI safety', () => {
  test('requires file inputs and known recipes; forbids inline JSON/secrets', () => {
    expect(() => parseCommand(['add-customer', '--run', 'e2e_0123456789abcdef01234567']))
      .toThrow(/--input/u);
    expect(() => parseCommand(['add-customer', '--input', '{"slug":"buyer"}']))
      .toThrow(/file/u);
    expect(() => parseCommand(['not-a-recipe', '--input', '/tmp/fixture.json']))
      .toThrow(/recipe/u);
    expect(() => parseCommand(['add-customer', '--run', 'e2e_0123456789abcdef01234567',
      '--input', '/tmp/fixture.json', '--execute']))
      .toThrow(/cleanup-run/u);
  });

  test('cleanup defaults to preview and requires an explicit run ID', () => {
    expect(parseCommand(['cleanup-run', '--run', 'e2e_0123456789abcdef01234567']))
      .toMatchObject({ name: 'cleanup-run', execute: false });
    expect(() => parseCommand(['cleanup-run'])).toThrow(/--run/u);
  });
});
