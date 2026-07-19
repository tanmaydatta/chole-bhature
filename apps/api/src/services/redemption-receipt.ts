import { z } from 'zod';

import { canonicalJson } from '../json.js';
import type { RedemptionCreate } from '../repositories/types.js';

const SigningSecretSchema = z.string().min(16).max(4_096);
const encoder = new TextEncoder();

type UnsignedRedemptionReceipt = Omit<RedemptionCreate, 'receiptIntegrityHash'>;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/u.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(SigningSecretSchema.parse(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function receiptPayload(receipt: UnsignedRedemptionReceipt | RedemptionCreate) {
  return {
    kind: 'redemption_receipt_v1',
    merchantId: receipt.merchantId,
    redemptionId: receipt.redemptionId,
    evaluationId: receipt.evaluationId,
    programRef: receipt.result.programRef,
    ...(receipt.result.rewardRuleRef === undefined
      ? {}
      : { rewardRuleRef: receipt.result.rewardRuleRef }),
    effects: receipt.result.effects,
    ...(receipt.externalOrderRef === undefined
      ? {}
      : { externalOrderRef: receipt.externalOrderRef }),
    ...(receipt.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: receipt.idempotencyKey }),
    discountMinorUnits: receipt.discountMinorUnits,
    currency: receipt.currency,
    status: receipt.result.status,
    createdAt: receipt.createdAt,
  };
}

export async function signRedemptionReceipt(
  receipt: UnsignedRedemptionReceipt,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(canonicalJson(receiptPayload(receipt))),
  );
  return bytesToHex(signature);
}

export async function verifyRedemptionReceipt(
  receipt: RedemptionCreate,
  secret: string,
): Promise<boolean> {
  const signature = hexToBytes(receipt.receiptIntegrityHash);
  if (signature === null) return false;
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    signature,
    encoder.encode(canonicalJson(receiptPayload(receipt))),
  );
}
