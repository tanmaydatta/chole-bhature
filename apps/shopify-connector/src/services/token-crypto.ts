import type { Env } from '../env.js';

const PREFIX = 'enc:v1:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  // Normalize any secret material (hex/base64/passphrase) to a 32-byte key.
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypts a small secret for storage in D1.
 *
 * When TOKEN_ENCRYPTION_KEY is absent (local/test only) the value is stored as
 * plaintext so existing fixtures keep working. Production must set the secret.
 */
export async function encryptToken(env: Env, plaintext: string): Promise<string> {
  const secret = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    if (env.APP_ENV === 'production') {
      throw new Error('TOKEN_ENCRYPTION_KEY is required in production');
    }
    return plaintext;
  }

  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return `${PREFIX}${bytesToBase64(combined)}`;
}

export async function decryptToken(env: Env, stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored;

  const secret = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required to decrypt stored Shopify tokens');
  }

  const combined = base64ToBytes(stored.slice(PREFIX.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return decoder.decode(plaintext);
}

export function isEncryptedToken(value: string | undefined): boolean {
  return value?.startsWith(PREFIX) ?? false;
}
