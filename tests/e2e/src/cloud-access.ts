import { validateCloudTargetCandidate, type CloudTargetExpectation } from './cloud-target.js';
import { request, type APIResponse, type Browser, type BrowserContext } from '@playwright/test';

function invalidAccess(): never {
  throw new TypeError('Invalid cloud Access request or credential.');
}

function accessBoundary<T>(read: () => T): T {
  try { return read(); } catch { return invalidAccess(); }
}

export interface CloudAccessRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: unknown;
  readonly data?: unknown;
}

export async function openCloudAccessRequestContext(candidate: unknown,
  expectation: CloudTargetExpectation, credential: unknown) {
  const policy = createCloudAccessPolicy(candidate, expectation, credential);
  const context = await request.newContext();
  let closed = false;
  let disposal: Promise<void> | undefined;
  return Object.freeze({ async fetch(url: string, options: CloudAccessRequestOptions = {}): Promise<APIResponse> {
    if (closed) throw new Error('Cloud Access request context is closed.');
    const dispatch = accessBoundary(() => {
      if (!options || typeof options !== 'object'
        || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) invalidAccess();
      const fields = Object.getOwnPropertyDescriptors(options);
      if (Reflect.ownKeys(fields).some(name => typeof name !== 'string'
        || !['method', 'headers', 'data'].includes(name) || !Object.hasOwn(fields[name], 'value'))) invalidAccess();
      const method = fields.method?.value as string | undefined;
      if (method !== undefined && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) invalidAccess();
      const headers = policy.headersFor(url, fields.headers?.value);
      if (!Object.hasOwn(headers, 'CF-Access-Client-Id')
        || Object.keys(headers).some(name => name.toLowerCase() === 'host')) invalidAccess();
      return { method, headers, ...(fields.data ? { data: structuredClone(fields.data.value) } : {}) };
    });
    let response: APIResponse;
    try {
      response = await context.fetch(url, { ...dispatch, maxRedirects: 0 });
    } catch { throw new Error('Cloud Access HTTP request failed.'); }
    if (response.status() >= 300 && response.status() < 400) {
      await response.dispose();
      throw new Error('Cloud Access HTTP redirects are unsupported.');
    }
    return response;
  }, dispose(): Promise<void> {
    closed = true;
    return disposal ??= context.dispose();
  } });
}

export async function openCloudAccessBrowserContext(browser: Browser, candidate: unknown,
  expectation: CloudTargetExpectation, credential: unknown): Promise<BrowserContext> {
  const policy = createCloudAccessPolicy(candidate, expectation, credential);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.route('**/*', async route => {
      let response: APIResponse | undefined;
      try {
        const headers = policy.headersFor(route.request().url(), await route.request().allHeaders());
        if (!Object.hasOwn(headers, 'CF-Access-Client-Id')) invalidAccess();
        response = await route.fetch({ headers, maxRedirects: 0 });
        if (response.status() >= 300 && response.status() < 400) {
          await route.abort('blockedbyclient');
        } else {
          await route.fulfill({ response });
        }
      } catch {
        // Request/transport errors may contain credentials; fail without logging.
        await route.abort('blockedbyclient').catch(() => {});
      } finally {
        await response?.dispose().catch(() => {});
      }
    });
    return context;
  } catch {
    await context.close();
    throw new Error('Cloud Access browser routing setup failed.');
  }
}

function snapshotHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalidAccess();
  const result: Record<string, string> = {};
  for (const name of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)
      || !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable
      || typeof descriptor.value !== 'string' || Array.from(descriptor.value).some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
      || ['cf-access-client-id', 'cf-access-client-secret'].includes(name.toLowerCase())) invalidAccess();
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true,
      writable: true, configurable: true });
  }
  return result;
}

function requestUrl(value: string): URL {
  try {
    if (typeof value !== 'string' || /\s/u.test(value)) invalidAccess();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || url.href !== value) invalidAccess();
    return url;
  } catch { return invalidAccess(); }
}

export function createCloudAccessPolicy(candidate: unknown, expectation: CloudTargetExpectation,
  credential: unknown) {
  return accessBoundary(() => {
    const target = validateCloudTargetCandidate(candidate, expectation);
    if (!credential || typeof credential !== 'object'
      || ![Object.prototype, null].includes(Object.getPrototypeOf(credential))) invalidAccess();
    const fields = Object.getOwnPropertyDescriptors(credential);
    if (Reflect.ownKeys(fields).length !== 2
      || !['clientId', 'clientSecret'].every(name => Object.hasOwn(fields, name)
        && Object.hasOwn(fields[name], 'value') && fields[name]?.enumerable
        && typeof fields[name]?.value === 'string' && /^[!-~]+$/u.test(fields[name]?.value))) invalidAccess();
    const clientId = fields.clientId?.value as string;
    const clientSecret = fields.clientSecret?.value as string;
    return Object.freeze({ headersFor(url: string, headers: unknown = {}): Record<string, string> {
      return accessBoundary(() => {
        const result = snapshotHeaders(headers);
        const parsed = requestUrl(url);
        for (const [name, value] of Object.entries(result)) {
          if (name.toLowerCase() === 'authority'
            || (name.toLowerCase() === 'host' && value !== parsed.host)) invalidAccess();
        }
        if (parsed.origin === target.apiOrigin || parsed.origin === target.operatorOrigin) {
          result['CF-Access-Client-Id'] = clientId;
          result['CF-Access-Client-Secret'] = clientSecret;
        }
        return result;
      });
    } });
  });
}
