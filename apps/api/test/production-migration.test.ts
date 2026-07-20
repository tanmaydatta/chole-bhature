import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';

const testEnv = env as typeof env & {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

const createdAt = '2026-07-18T12:00:00.000Z';
const programConfiguration = {
  id: 'legacy-welcome',
  type: 'promo',
  name: 'Legacy welcome',
  status: 'active',
  eligibility: { match: 'ALL', conditions: [] },
  rewardRules: [{
    id: 'welcome-reward',
    name: 'Welcome reward',
    conditions: { match: 'ALL', conditions: [] },
    reward: {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    },
  }],
  budget: { currency: 'GBP', minorUnits: 5_000 },
  usageCap: 10,
  stackable: false,
  priority: 10,
  autoApply: true,
} as const;

const draftProgramConfiguration = {
  ...programConfiguration,
  id: 'legacy-draft',
  name: 'Legacy draft',
  status: 'draft',
} as const;

async function resetToMigrationOne(): Promise<D1Migration> {
  const migrationOne = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0001_core.sql'
  ));
  const productionMigration = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0002_production_operator.sql'
  ));

  expect(migrationOne, '0001_core.sql must remain available as the upgrade source').toBeDefined();
  expect(
    productionMigration,
    '0002_production_operator.sql must exist before the Plan 2 upgrade can run',
  ).toBeDefined();

  const applicationTables = [
    'product_audit',
    'api_credentials',
    'redemptions',
    'evaluation_decisions',
    'program_counters',
    'program_revisions',
    'programs',
    'customers',
    'schema_versions',
    'variable_definitions',
    'merchants',
  ] as const;
  for (const name of applicationTables) {
    await testEnv.DB.prepare(`DROP TABLE IF EXISTS ${name}`).run();
  }
  await testEnv.DB.prepare('DELETE FROM d1_migrations').run();
  await applyD1Migrations(testEnv.DB, [migrationOne!]);
  return productionMigration!;
}

async function seedRepresentativePlanTwoData(): Promise<void> {
  const definition = {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'string',
    required: true,
  };
  const request = {
    customerRef: 'legacy-customer',
    cart: { currency: 'GBP', subtotal: 5_000, items: [] },
  };
  const decisions = [{
    programRef: 'legacy-welcome',
    programRevision: 1,
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef: 'welcome-reward',
    effects: [{
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    }],
    reasonCodes: ['QUALIFIED'],
    commitRequired: true,
  }];
  const redemptionResult = {
    version: 1,
    result: {
      redemptionId: 'legacy-redemption',
      evaluationId: 'legacy-evaluation',
      externalOrderRef: 'legacy-order',
      programRef: 'legacy-welcome',
      rewardRuleRef: 'welcome-reward',
      status: 'committed',
      effects: decisions[0]!.effects,
    },
    receiptIntegrityHash: 'a'.repeat(64),
  };

  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO schema_versions (
        merchant_id, version, state, published_at, definitions_json
      ) VALUES ('phase-0-merchant', 1, 'published', ?1, ?2)
    `).bind(createdAt, JSON.stringify([definition])),
    testEnv.DB.prepare(`
      INSERT INTO variable_definitions (
        id, merchant_id, schema_version, key, label, source, type, required,
        state, created_at
      ) VALUES (
        'legacy-definition', 'phase-0-merchant', 1, 'customer.tier',
        'Customer tier', 'customer', 'string', 1, 'published', ?1
      )
    `).bind(createdAt),
    testEnv.DB.prepare(`
      INSERT INTO customers (
        id, merchant_id, external_ref, attributes_json, version, updated_at
      ) VALUES (
        'legacy-customer-row', 'phase-0-merchant', 'legacy-customer',
        '{"tier":"gold"}', 2, ?1
      )
    `).bind(createdAt),
    testEnv.DB.prepare(`
      INSERT INTO programs (
        id, merchant_id, external_ref, type, name, status, config_json,
        priority, max_uses, usage_count, budget_remaining, created_at, updated_at
      ) VALUES (
        'legacy-program-row', 'phase-0-merchant', 'legacy-welcome', 'promo',
        'Legacy welcome', 'active', ?1, 10, 10, 3, 4500, ?2, ?2
      )
    `).bind(JSON.stringify(programConfiguration), createdAt),
    testEnv.DB.prepare(`
      INSERT INTO programs (
        id, merchant_id, external_ref, type, name, status, config_json,
        priority, max_uses, usage_count, budget_remaining, created_at, updated_at
      ) VALUES (
        'legacy-draft-row', 'phase-0-merchant', 'legacy-draft', 'promo',
        'Legacy draft', 'draft', ?1, 10, 10, 1, 4750, ?2, ?2
      )
    `).bind(JSON.stringify(draftProgramConfiguration), createdAt),
    testEnv.DB.prepare(`
      INSERT INTO evaluation_decisions (
        id, merchant_id, customer_ref, customer_version, schema_version,
        request_json, facts_json, decisions_json, integrity_hash, expires_at, created_at
      ) VALUES (
        'legacy-evaluation', 'phase-0-merchant', 'legacy-customer', 2, 1,
        ?1, ?2, ?3, 'legacy-integrity', '2026-07-18T12:05:00.000Z', ?4
      )
    `).bind(
      JSON.stringify(request),
      JSON.stringify({ scalar: { 'customer.tier': 'gold' }, lineItems: [], programs: [] }),
      JSON.stringify(decisions),
      createdAt,
    ),
    testEnv.DB.prepare(`
      INSERT INTO redemptions (
        id, merchant_id, external_order_ref, evaluation_id, result_json,
        discount_minor_units, currency, created_at
      ) VALUES (
        'legacy-redemption', 'phase-0-merchant', 'legacy-order',
        'legacy-evaluation', ?1, 500, 'GBP', ?2
      )
    `).bind(JSON.stringify(redemptionResult), createdAt),
  ]);
}

test('upgrades a populated Plan 2 database without breaking ownership or history', async () => {
  const productionMigration = await resetToMigrationOne();
  await seedRepresentativePlanTwoData();

  await applyD1Migrations(testEnv.DB, [productionMigration]);

  expect(await testEnv.DB.prepare(`
    SELECT id, name, status FROM merchants WHERE id = 'phase-0-merchant'
  `).first()).toEqual({
    id: 'phase-0-merchant',
    name: 'Phase 0 Merchant',
    status: 'active',
  });
  expect(await testEnv.DB.prepare(`
    SELECT id, merchant_id, external_ref, type, status, active_revision, draft_revision
    FROM programs WHERE id = 'legacy-program-row'
  `).first()).toEqual({
    id: 'legacy-program-row',
    merchant_id: 'phase-0-merchant',
    external_ref: 'legacy-welcome',
    type: 'promo',
    status: 'active',
    active_revision: 1,
    draft_revision: null,
  });
  expect(await testEnv.DB.prepare(`
    SELECT program_id, merchant_id, revision, config_json, created_at, created_by,
      published_at, published_by
    FROM program_revisions
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
  `).first()).toEqual({
    program_id: 'legacy-program-row',
    merchant_id: 'phase-0-merchant',
    revision: 1,
    config_json: JSON.stringify(programConfiguration),
    created_at: createdAt,
    created_by: 'system:migration',
    published_at: createdAt,
    published_by: 'system:migration',
  });
  expect(await testEnv.DB.prepare(`
    SELECT id, active_revision, draft_revision
    FROM programs WHERE id = 'legacy-draft-row'
  `).first()).toEqual({
    id: 'legacy-draft-row',
    active_revision: null,
    draft_revision: 1,
  });
  expect(await testEnv.DB.prepare(`
    SELECT program_id, revision, config_json, created_at, created_by,
      published_at, published_by
    FROM program_revisions
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-draft-row'
  `).first()).toEqual({
    program_id: 'legacy-draft-row',
    revision: 1,
    config_json: JSON.stringify(draftProgramConfiguration),
    created_at: createdAt,
    created_by: 'system:migration',
    published_at: null,
    published_by: null,
  });
  expect(await testEnv.DB.prepare(`
    SELECT program_id, merchant_id, max_uses, usage_count, budget_remaining
    FROM program_counters
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
  `).first()).toEqual({
    program_id: 'legacy-program-row',
    merchant_id: 'phase-0-merchant',
    max_uses: 10,
    usage_count: 3,
    budget_remaining: 4500,
  });

  expect(await testEnv.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM schema_versions WHERE merchant_id = 'phase-0-merchant') AS schemas,
      (SELECT COUNT(*) FROM variable_definitions WHERE merchant_id = 'phase-0-merchant') AS definitions,
      (SELECT COUNT(*) FROM customers WHERE merchant_id = 'phase-0-merchant') AS customers,
      (SELECT COUNT(*) FROM evaluation_decisions WHERE merchant_id = 'phase-0-merchant') AS evaluations,
      (SELECT COUNT(*) FROM redemptions WHERE merchant_id = 'phase-0-merchant') AS redemptions
  `).first()).toEqual({
    schemas: 1,
    definitions: 1,
    customers: 1,
    evaluations: 1,
    redemptions: 1,
  });
  expect((await testEnv.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);

  const updatedDraftConfiguration = {
    ...draftProgramConfiguration,
    name: 'Legacy draft updated by old worker',
  };
  await testEnv.DB.prepare(`
    UPDATE programs
    SET config_json = ?1, max_uses = 12, usage_count = 2, budget_remaining = 4250
    WHERE id = 'legacy-draft-row'
  `).bind(JSON.stringify(updatedDraftConfiguration)).run();
  expect(await testEnv.DB.prepare(`
    SELECT config_json FROM program_revisions
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-draft-row' AND revision = 1
  `).first()).toEqual({ config_json: JSON.stringify(updatedDraftConfiguration) });
  expect(await testEnv.DB.prepare(`
    SELECT max_uses, usage_count, budget_remaining FROM program_counters
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-draft-row'
  `).first()).toEqual({
    max_uses: 12,
    usage_count: 2,
    budget_remaining: 4250,
  });

  await testEnv.DB.prepare("DELETE FROM programs WHERE id = 'legacy-draft-row'").run();
  expect(await testEnv.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM program_revisions WHERE program_id = 'legacy-draft-row') AS revisions,
      (SELECT COUNT(*) FROM program_counters WHERE program_id = 'legacy-draft-row') AS counters
  `).first()).toEqual({ revisions: 0, counters: 0 });

  await testEnv.DB.prepare(`
    INSERT INTO merchants (id, name, status, created_at, updated_at)
    VALUES ('other-merchant', 'Other merchant', 'active', ?1, ?1)
  `).bind(createdAt).run();
  await expect(testEnv.DB.prepare(`
    INSERT INTO program_revisions (
      program_id, merchant_id, revision, config_json, created_at, created_by
    ) VALUES (
      'legacy-program-row', 'other-merchant', 2, ?1, ?2, 'other-user'
    )
  `).bind(JSON.stringify(programConfiguration), createdAt).run()).rejects.toThrow();
  await expect(testEnv.DB.prepare(`
    INSERT INTO program_counters (
      program_id, merchant_id, max_uses, usage_count, budget_remaining
    ) VALUES ('legacy-program-row', 'other-merchant', 10, 0, 5000)
  `).run()).rejects.toThrow();
});
