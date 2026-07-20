interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
}

interface AuthenticationOptions {
  challenge: string;
  rpId: string;
}

export interface TestCredential {
  id: string;
  credentialId: Uint8Array;
  publicKey: string;
  privateKey: CryptoKey;
}

const textEncoder = new TextEncoder();

function concat(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((length, array) => length + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sha256(value: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof value === 'string' ? textEncoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, counter, false);
  return bytes;
}

function cborText(value: string): Uint8Array {
  const bytes = textEncoder.encode(value);
  if (bytes.length >= 24) throw new Error('Fixture only supports short CBOR text');
  return concat(Uint8Array.of(0x60 + bytes.length), bytes);
}

function cborBytes(value: Uint8Array): Uint8Array {
  if (value.length < 24) return concat(Uint8Array.of(0x40 + value.length), value);
  if (value.length <= 0xff) return concat(Uint8Array.of(0x58, value.length), value);
  return concat(Uint8Array.of(0x59, value.length >> 8, value.length & 0xff), value);
}

function cosePublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.of(0xa5),
    Uint8Array.of(0x01, 0x02),
    Uint8Array.of(0x03, 0x26),
    Uint8Array.of(0x20, 0x01),
    Uint8Array.of(0x21), cborBytes(x),
    Uint8Array.of(0x22), cborBytes(y),
  );
}

function derInteger(raw: Uint8Array): Uint8Array {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  let value = raw.slice(start);
  if ((value[0] ?? 0) & 0x80) value = concat(Uint8Array.of(0), value);
  return concat(Uint8Array.of(0x02, value.length), value);
}

function toDerSignature(signature: Uint8Array): Uint8Array {
  if (signature[0] === 0x30) return signature;
  if (signature.length !== 64) throw new Error('Unexpected ECDSA signature shape');
  const r = derInteger(signature.slice(0, 32));
  const s = derInteger(signature.slice(32));
  return concat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export async function createTestCredential(): Promise<TestCredential> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  if (!jwk.x || !jwk.y) throw new Error('P-256 JWK is missing coordinates');
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  return {
    id: base64Url(credentialId),
    credentialId,
    publicKey: base64(cosePublicKey(fromBase64Url(jwk.x), fromBase64Url(jwk.y))),
    privateKey: keyPair.privateKey,
  };
}

export async function registrationResponse(
  options: RegistrationOptions,
  credential: TestCredential,
  origin: string,
  userVerified = true,
) {
  const clientData = textEncoder.encode(JSON.stringify({
    type: 'webauthn.create',
    challenge: options.challenge,
    origin,
    crossOrigin: false,
  }));
  const publicKey = Uint8Array.from(atob(credential.publicKey), character => character.charCodeAt(0));
  const credentialLength = Uint8Array.of(
    credential.credentialId.length >> 8,
    credential.credentialId.length & 0xff,
  );
  const flags = 0x01 | 0x40 | (userVerified ? 0x04 : 0);
  const authData = concat(
    await sha256(options.rp.id),
    Uint8Array.of(flags),
    counterBytes(0),
    new Uint8Array(16),
    credentialLength,
    credential.credentialId,
    publicKey,
  );
  const attestationObject = concat(
    Uint8Array.of(0xa3),
    cborText('fmt'), cborText('none'),
    cborText('authData'), cborBytes(authData),
    cborText('attStmt'), Uint8Array.of(0xa0),
  );

  return {
    id: credential.id,
    rawId: credential.id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64Url(clientData),
      attestationObject: base64Url(attestationObject),
      transports: ['internal'],
    },
  };
}

export async function authenticationResponse(
  options: AuthenticationOptions,
  credential: TestCredential,
  origin: string,
  counter: number,
  userVerified: boolean,
) {
  const clientData = textEncoder.encode(JSON.stringify({
    type: 'webauthn.get',
    challenge: options.challenge,
    origin,
    crossOrigin: false,
  }));
  const authenticatorData = concat(
    await sha256(options.rpId),
    Uint8Array.of(0x01 | (userVerified ? 0x04 : 0)),
    counterBytes(counter),
  );
  const signed = concat(authenticatorData, await sha256(clientData));
  const signature = toDerSignature(new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    credential.privateKey,
    signed,
  )));

  return {
    id: credential.id,
    rawId: credential.id,
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: base64Url(clientData),
      authenticatorData: base64Url(authenticatorData),
      signature: base64Url(signature),
      userHandle: null,
    },
  };
}
