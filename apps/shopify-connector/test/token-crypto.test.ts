import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env.js';
import { decryptToken, encryptToken } from '../src/services/token-crypto.js';

const key = 'a'.repeat(64);

describe('token crypto', () => {
  it('round-trips encrypted secrets', async () => {
    const env = { TOKEN_ENCRYPTION_KEY: key, APP_ENV: 'production' } as Env;
    const ciphertext = await encryptToken(env, 'shpat_secret_token');
    expect(ciphertext).toMatch(/^enc:v1:/u);
    expect(ciphertext).not.toContain('shpat_secret_token');
    await expect(decryptToken(env, ciphertext)).resolves.toBe('shpat_secret_token');
  });

  it('fails closed in production when the key is missing', async () => {
    const env = { APP_ENV: 'production' } as Env;
    await expect(encryptToken(env, 'secret')).rejects.toThrow('TOKEN_ENCRYPTION_KEY');
  });

  it('keeps local plaintext for fixtures', async () => {
    const env = { APP_ENV: 'local' } as Env;
    await expect(encryptToken(env, 'secret')).resolves.toBe('secret');
    await expect(decryptToken(env, 'secret')).resolves.toBe('secret');
  });
});
