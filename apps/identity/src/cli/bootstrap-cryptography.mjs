function bytes(value) {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function base64Url(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function randomBootstrapSecret() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function deriveBootstrapGrant(authSecret, flowId, initiatingCodeHash) {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes(authSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    bytes(`identity-recovery-grant-v1:${flowId}:${initiatingCodeHash}`),
  );
  return base64Url(new Uint8Array(signature));
}
