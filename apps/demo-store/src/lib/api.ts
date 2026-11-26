import type { EvaluationResponse, RedemptionResponse } from '@incentives/contracts';
import type { DemoCustomerMode, MenuItem } from '../shared/demo.js';

export interface BootstrapData {
  menu: MenuItem[];
  customers: Array<{ mode: DemoCustomerMode; label: string; description: string }>;
  codeHints: ReadonlyArray<{ code: string; label: string }>;
  currency: string;
  coreMode: boolean;
}

export interface CartLineInput {
  itemId: string;
  quantity: number;
}

export interface EvaluationResult {
  evaluation: EvaluationResponse;
  deliveryFeeMinor: number;
}

export interface CheckoutResult {
  orderId: string;
  deliveryFeeMinor: number;
  redemption: RedemptionResponse;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.message ?? body?.error ?? `Request failed: ${response.status}`);
  }
  return body as T;
}

export async function loadBootstrap(): Promise<BootstrapData> {
  return requestJson<BootstrapData>('/api/bootstrap');
}

export async function evaluateCart(
  items: CartLineInput[],
  customerMode: DemoCustomerMode,
  codes: string[],
): Promise<EvaluationResult> {
  return requestJson<EvaluationResult>('/api/evaluate', {
    method: 'POST',
    body: JSON.stringify({ items, customerMode, codes }),
  });
}

export async function checkoutCart(
  items: CartLineInput[],
  customerMode: DemoCustomerMode,
  codes: string[],
): Promise<CheckoutResult> {
  return requestJson<CheckoutResult>('/api/checkout', {
    method: 'POST',
    body: JSON.stringify({ items, customerMode, codes }),
  });
}

export async function resetDemo(): Promise<void> {
  await requestJson('/api/demo/reset', { method: 'POST', body: '{}' });
}
