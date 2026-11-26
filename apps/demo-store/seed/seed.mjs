#!/usr/bin/env node
/**
 * Seeds the demo tenant used by the storefront when DEMO_MODE=core.
 *
 * The operator session decides which merchant is seeded, so run this against
 * the demo merchant only. The script is idempotent: existing variables and
 * programs are left alone, a draft schema is only published when one exists,
 * and already-active programs are not republished.
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const seedFixture = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));

export function createRequester({ baseUrl, cookie, origin }) {
  return async function request(method, path, body, options = {}) {
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
  };
}

function programPath(id) {
  return `/operator/v1/programs/${encodeURIComponent(id)}`;
}

/**
 * Runs the seed against an injected operator API client so the rerun behaviour
 * can be tested without a live environment.
 */
export async function runSeed({ request, fixture = seedFixture, log = console.log }) {
  const definitionsResponse = await request('GET', '/operator/v1/schema/definitions');
  const definitionsState = definitionsResponse.body ?? {};
  const knownKeys = new Set(
    (definitionsState.definitions ?? [])
      .map(entry => entry?.definition?.key)
      .filter(key => typeof key === 'string'),
  );

  let createdVariables = 0;
  for (const variable of fixture.variables) {
    if (knownKeys.has(variable.key)) {
      log(`schema   ${variable.key} (exists)`);
      continue;
    }
    await request('POST', '/operator/v1/schema/definitions', variable);
    createdVariables += 1;
    log(`schema   ${variable.key} (created)`);
  }

  const hasDraft = typeof definitionsState.draftVersion === 'number';
  if (createdVariables > 0 || hasDraft) {
    await request('POST', '/operator/v1/schema/publish', {});
    log('schema   published');
  } else if (typeof definitionsState.publishedVersion === 'number') {
    log('schema   already published');
  } else {
    log('schema   unchanged');
  }

  for (const customer of fixture.customers) {
    await request(
      'PATCH',
      `/operator/v1/customers/${encodeURIComponent(customer.ref)}`,
      { attributes: customer.attributes },
    );
    log(`customer ${customer.ref} (upserted)`);
  }

  for (const program of fixture.programs) {
    const existing = await request('GET', programPath(program.id), undefined, {
      allowStatuses: [404],
    });
    if (existing.status === 404) {
      await request('POST', '/operator/v1/programs', program);
      log(`program  ${program.id} (created)`);
    } else {
      log(`program  ${program.id} (exists)`);
    }
    if (existing.body?.lifecycle?.status === 'active') continue;
    await request('POST', `${programPath(program.id)}/publish`, {});
    log(`program  ${program.id} (published)`);
  }
}

async function main() {
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
  await runSeed({ request: createRequester({ baseUrl, cookie, origin }) });

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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
