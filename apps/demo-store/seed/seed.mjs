#!/usr/bin/env node
/**
 * Seeds the demo tenant used by the storefront when DEMO_MODE=core.
 *
 * The operator session decides which merchant is seeded, so run this against
 * the demo merchant only. The script is idempotent: existing variables and
 * programs are left alone, and already-active programs are not republished.
 *
 * Usage:
 *   OPERATOR_URL=https://operator.example.com \
 *   OPERATOR_COOKIE='session=...' \
 *   node apps/demo-store/seed/seed.mjs
 *
 * `OPERATOR_ORIGIN` defaults to the origin of OPERATOR_URL and is sent as the
 * Origin header required by the operator API's CSRF checks.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.OPERATOR_URL?.trim().replace(/\/+$/u, '');
const cookie = process.env.OPERATOR_COOKIE?.trim();
if (!baseUrl || !cookie) {
  console.error(
    'Set OPERATOR_URL and OPERATOR_COOKIE to a session for the demo merchant.\n'
    + 'Example: OPERATOR_URL=https://operator.example.com OPERATOR_COOKIE="session=..." node apps/demo-store/seed/seed.mjs',
  );
  process.exit(1);
}

const origin = process.env.OPERATOR_ORIGIN?.trim() ?? new URL(baseUrl).origin;
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));

async function request(method, path, body, options = {}) {
  const allowStatuses = options.allowStatuses ?? [];
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      origin,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok && !allowStatuses.includes(response.status)) {
    const code = parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object'
      ? parsed.error.code
      : undefined;
    throw new Error(`${method} ${path} failed: ${response.status}${code ? ` (${code})` : ''}`);
  }
  return { status: response.status, body: parsed };
}

function programPath(id) {
  return `/operator/v1/programs/${encodeURIComponent(id)}`;
}

async function main() {
  const definitions = await request('GET', '/operator/v1/schema/definitions');
  const knownKeys = new Set(
    (definitions.body?.definitions ?? [])
      .map(entry => entry?.definition?.key)
      .filter(key => typeof key === 'string'),
  );

  for (const variable of fixture.variables) {
    if (knownKeys.has(variable.key)) {
      console.log(`schema   ${variable.key} (exists)`);
      continue;
    }
    await request('POST', '/operator/v1/schema/definitions', variable);
    console.log(`schema   ${variable.key} (created)`);
  }
  await request('POST', '/operator/v1/schema/publish', {});

  for (const customer of fixture.customers) {
    await request(
      'PATCH',
      `/operator/v1/customers/${encodeURIComponent(customer.ref)}`,
      { attributes: customer.attributes },
    );
    console.log(`customer ${customer.ref} (upserted)`);
  }

  for (const program of fixture.programs) {
    const existing = await request('GET', programPath(program.id), undefined, {
      allowStatuses: [404],
    });
    if (existing.status === 404) {
      await request('POST', '/operator/v1/programs', program);
      console.log(`program  ${program.id} (created)`);
    } else {
      console.log(`program  ${program.id} (exists)`);
    }
    if (existing.body?.lifecycle?.status === 'active') continue;
    await request('POST', `${programPath(program.id)}/publish`, {});
    console.log(`program  ${program.id} (published)`);
  }

  console.log(`
Seed complete.

Point the storefront at the same merchant:
  DEMO_MODE=core
  DEMO_CORE_URL=${baseUrl}
  CORE_PUBLISHABLE_KEY=pk_...   # publishable credential with evaluations:write
  CORE_SECRET_KEY=sk_...        # secret credential with redemptions:write (wrangler secret)

Use the seeded demo_customer_new / demo_customer_regular / demo_customer_vip profiles.
`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
