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
    'redemption_commit_guards',
    'redemption_entries',
    'redemption_operations',
    'promo_code_claims',
    'product_audit',
    'credential_rate_limit_windows',
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

function requiredMigration(name: string): D1Migration {
  const migration = testEnv.TEST_MIGRATIONS.find(candidate => candidate.name === name);
  expect(migration, `${name} must remain available`).toBeDefined();
  return migration!;
}

async function resetToMigrationFive(): Promise<D1Migration> {
  const productionMigration = await resetToMigrationOne();
  await seedRepresentativePlanTwoData();
  await applyD1Migrations(testEnv.DB, [
    productionMigration,
    requiredMigration('0003_credential_origins.sql'),
    requiredMigration('0004_program_committed_spend.sql'),
    requiredMigration('0005_publishable_rate_limits.sql'),
  ]);
  return requiredMigration('0006_promo_selection_redemption_bundles.sql');
}

async function insertLegacyCodedProgram(input: {
  rowId: string;
  programRef: string;
  code: string;
  status?: 'active' | 'draft' | 'ended' | 'paused' | 'scheduled';
  startDate?: string;
  endDate?: string;
}): Promise<void> {
  const status = input.status ?? 'active';
  const config = {
    ...programConfiguration,
    id: input.programRef,
    name: `Legacy ${input.programRef}`,
    status,
    autoApply: false,
    code: input.code,
    stackable: true,
    ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
    ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
  };
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO programs (
        id, merchant_id, external_ref, type, name, status, config_json, priority,
        max_uses, usage_count, budget_remaining, active_revision, draft_revision,
        created_at, updated_at
      ) VALUES (
        ?1, 'phase-0-merchant', ?2, 'promo', ?3, ?4, ?5,
        10, 10, 0, 5000, 1, NULL, ?6, ?6
      )
    `).bind(
      input.rowId,
      input.programRef,
      config.name,
      status,
      JSON.stringify(config),
      createdAt,
    ),
    testEnv.DB.prepare(`
      INSERT INTO program_revisions (
        program_id, merchant_id, revision, config_json, created_at, created_by,
        published_at, published_by
      ) VALUES (
        ?1, 'phase-0-merchant', 1, ?2, ?3, 'migration-test',
        ?3, 'migration-test'
      )
    `).bind(input.rowId, JSON.stringify(config), createdAt),
    testEnv.DB.prepare(`
      INSERT INTO program_counters (
        program_id, merchant_id, max_uses, usage_count, budget_remaining,
        committed_spend
      ) VALUES (?1, 'phase-0-merchant', 10, 0, 5000, 0)
    `).bind(input.rowId),
  ]);
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
      idempotencyKey: 'legacy-key',
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
        id, merchant_id, external_order_ref, idempotency_key, evaluation_id, result_json,
        discount_minor_units, currency, created_at
      ) VALUES (
        'legacy-redemption', 'phase-0-merchant', 'legacy-order', 'legacy-key',
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

test('forward-migrates logical committed spend from populated Task 2 counters', async () => {
  const productionMigration = await resetToMigrationOne();
  await seedRepresentativePlanTwoData();
  await applyD1Migrations(testEnv.DB, [productionMigration]);
  const spendMigration = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0004_program_committed_spend.sql'
  ));
  expect(spendMigration, 'the committed-spend forward migration must exist').toBeDefined();

  await applyD1Migrations(testEnv.DB, [spendMigration!]);

  expect((await testEnv.DB.prepare(`
    SELECT program_id AS programId, committed_spend AS committedSpend
    FROM program_counters WHERE merchant_id = 'phase-0-merchant'
    ORDER BY program_id
  `).all()).results).toEqual([
    { programId: 'legacy-draft-row', committedSpend: 250 },
    { programId: 'legacy-program-row', committedSpend: 500 },
  ]);
});

test('backfills publishable quotas and creates isolated fixed-window state without affecting secrets', async () => {
  const productionMigration = await resetToMigrationOne();
  await seedRepresentativePlanTwoData();
  const originsMigration = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0003_credential_origins.sql'
  ));
  const spendMigration = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0004_program_committed_spend.sql'
  ));
  const rateLimitMigration = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0005_publishable_rate_limits.sql'
  ));
  expect(originsMigration).toBeDefined();
  expect(spendMigration).toBeDefined();
  expect(rateLimitMigration, 'the publishable rate-limit migration must exist').toBeDefined();
  await applyD1Migrations(testEnv.DB, [
    productionMigration,
    originsMigration!,
    spendMigration!,
  ]);
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO api_credentials (
        id, merchant_id, name, environment, kind, scopes_json,
        allowed_origins_json, digest, suffix, status, created_at, created_by
      ) VALUES (
        'legacy-publishable', 'phase-0-merchant', 'Legacy browser key', 'production',
        'publishable', '["schema:read"]', '["https://shop.example"]',
        ?1, 'pub12345', 'active', ?2, 'migration-test'
      )
    `).bind('a'.repeat(64), createdAt),
    testEnv.DB.prepare(`
      INSERT INTO api_credentials (
        id, merchant_id, name, environment, kind, scopes_json,
        allowed_origins_json, digest, suffix, status, created_at, created_by
      ) VALUES (
        'legacy-secret', 'phase-0-merchant', 'Legacy server key', 'production',
        'secret', '["customers:write"]', '[]',
        ?1, 'sec12345', 'active', ?2, 'migration-test'
      )
    `).bind('b'.repeat(64), createdAt),
  ]);

  await applyD1Migrations(testEnv.DB, [rateLimitMigration!]);

  expect((await testEnv.DB.prepare(`
    SELECT id, requests_per_minute AS requestsPerMinute
    FROM api_credentials WHERE id IN ('legacy-publishable', 'legacy-secret')
    ORDER BY id
  `).all()).results).toEqual([
    { id: 'legacy-publishable', requestsPerMinute: 60 },
    { id: 'legacy-secret', requestsPerMinute: null },
  ]);
  expect(await testEnv.DB.prepare(`
    SELECT COUNT(*) AS count FROM credential_rate_limit_windows
  `).first()).toEqual({ count: 0 });
  await expect(testEnv.DB.prepare(`
    UPDATE api_credentials SET requests_per_minute = 0
    WHERE id = 'legacy-publishable'
  `).run()).rejects.toThrow();
  await expect(testEnv.DB.prepare(`
    UPDATE api_credentials SET requests_per_minute = 60
    WHERE id = 'legacy-secret'
  `).run()).rejects.toThrow();
});

test('recovers spend from a rolled-back counter-first Worker update sequence', async () => {
  const productionMigration = await resetToMigrationOne();
  await seedRepresentativePlanTwoData();
  await applyD1Migrations(testEnv.DB, [productionMigration]);
  const spendMigration = testEnv.TEST_MIGRATIONS.find(migration => (
    migration.name === '0004_program_committed_spend.sql'
  ));
  expect(spendMigration).toBeDefined();
  await applyD1Migrations(testEnv.DB, [spendMigration!]);

  await testEnv.DB.prepare(`
    UPDATE program_counters
    SET usage_count = 4, budget_remaining = 4_250
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
  `).run();
  await testEnv.DB.prepare(`
    UPDATE programs
    SET usage_count = 4, budget_remaining = 4_250
    WHERE merchant_id = 'phase-0-merchant' AND id = 'legacy-program-row'
  `).run();

  expect(await testEnv.DB.prepare(`
    SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining,
      committed_spend AS committedSpend
    FROM program_counters
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
  `).first()).toEqual({
    usageCount: 4,
    budgetRemaining: 4_250,
    committedSpend: 750,
  });
});

test('adds promo claims, evaluation identity, idempotency operations, and bundle storage', async () => {
  const migration = await resetToMigrationFive();
  await applyD1Migrations(testEnv.DB, [migration]);

  const tableNames = (await testEnv.DB.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all<{ name: string }>()).results.map(table => table.name);
  const columns = async (table: string) => (
    await testEnv.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`)
      .all<{ name: string }>()
  ).results.map(column => column.name);

  expect(tableNames).toEqual(expect.arrayContaining([
    'promo_code_claims',
    'redemption_operations',
    'redemptions',
    'redemption_entries',
    'redemption_commit_guards',
  ]));
  expect(await columns('evaluation_decisions')).toEqual(expect.arrayContaining([
    'mode',
    'submitted_codes_json',
    'code_results_json',
    'request_digest',
    'correlation_id',
  ]));
  expect(await columns('redemption_operations')).toEqual(expect.arrayContaining([
    'idempotency_key',
    'state',
    'terminal_error_code',
    'request_digest',
  ]));
  expect(await columns('redemptions')).toEqual(expect.arrayContaining([
    'request_digest',
    'result_json',
  ]));
  const indexes = (await testEnv.DB.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all<{ name: string }>()).results.map(index => index.name);
  expect(indexes).toEqual(expect.arrayContaining([
    'promo_code_claims_lookup',
    'redemption_operations_merchant_external_order_unique',
    'redemption_operations_merchant_evaluation_index',
    'redemptions_merchant_external_order_ref_unique',
    'redemptions_merchant_idempotency_key_unique',
    'redemptions_merchant_evaluation_index',
    'redemption_entries_merchant_program_counts_index',
  ]));
});

test('keeps pre-0006 column-list inserts schema-compatible without populating new ledgers', async () => {
  const migration = await resetToMigrationFive();
  await applyD1Migrations(testEnv.DB, [migration]);

  const before = await testEnv.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM redemption_operations) AS operationCount,
      (SELECT COUNT(*) FROM redemption_entries) AS entryCount
  `).first<{ operationCount: number; entryCount: number }>();
  const evaluationId = 'post-0006-old-worker-evaluation';
  const redemptionId = 'post-0006-old-worker-redemption';
  const idempotencyKey = 'post-0006-old-worker-key';
  const externalOrderRef = 'post-0006-old-worker-order';
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
  const result = {
    version: 1,
    result: {
      redemptionId,
      evaluationId,
      externalOrderRef,
      idempotencyKey,
      programRef: 'legacy-welcome',
      rewardRuleRef: 'welcome-reward',
      status: 'committed',
      effects: decisions[0]!.effects,
    },
    receiptIntegrityHash: 'b'.repeat(64),
  };

  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO evaluation_decisions (
        id, merchant_id, customer_ref, customer_version, schema_version,
        request_json, facts_json, decisions_json, integrity_hash, expires_at, created_at
      ) VALUES (
        ?1, 'phase-0-merchant', 'legacy-customer', 2, 1,
        ?2, ?3, ?4, 'old-worker-integrity',
        '2026-07-18T12:10:00.000Z', '2026-07-18T12:06:00.000Z'
      )
    `).bind(
      evaluationId,
      JSON.stringify(request),
      JSON.stringify({ scalar: { 'customer.tier': 'gold' }, lineItems: [], programs: [] }),
      JSON.stringify(decisions),
    ),
    testEnv.DB.prepare(`
      INSERT INTO redemptions (
        id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
        result_json, discount_minor_units, currency, created_at
      ) VALUES (
        ?1, 'phase-0-merchant', ?2, ?3, ?4, ?5, 500, 'GBP',
        '2026-07-18T12:07:00.000Z'
      )
    `).bind(
      redemptionId,
      externalOrderRef,
      idempotencyKey,
      evaluationId,
      JSON.stringify(result),
    ),
  ]);

  expect(await testEnv.DB.prepare(`
    SELECT mode, submitted_codes_json AS submittedCodesJson,
      code_results_json AS codeResultsJson, request_digest AS requestDigest,
      correlation_id AS correlationId
    FROM evaluation_decisions WHERE id = ?1
  `).bind(evaluationId).first()).toEqual({
    mode: 'automatic',
    submittedCodesJson: '[]',
    codeResultsJson: '[]',
    requestDigest: 'legacy:unknown',
    correlationId: 'migration:unknown',
  });
  expect(await testEnv.DB.prepare(`
    SELECT request_digest AS requestDigest
    FROM redemptions WHERE id = ?1
  `).bind(redemptionId).first()).toEqual({
    requestDigest: 'legacy:unknown',
  });
  expect(await testEnv.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM redemption_operations) AS operationCount,
      (SELECT COUNT(*) FROM redemption_entries) AS entryCount
  `).first()).toEqual(before);
});

test('normalizes valid legacy triggers and backfills singular redemption history', async () => {
  const migration = await resetToMigrationFive();
  const legacyAutomatic = {
    ...programConfiguration,
    code: '  OLD-AUTO  ',
    stackable: true,
    stackingGroup: 'legacy-auto',
  };
  const legacyCoded = {
    ...programConfiguration,
    id: 'legacy-coded',
    name: 'Legacy coded',
    autoApply: false,
    code: '  vip20  ',
    stackable: true,
    stackingGroup: 'legacy-coded',
  };
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      UPDATE programs SET config_json = ?1
      WHERE merchant_id = 'phase-0-merchant' AND id = 'legacy-program-row'
    `).bind(JSON.stringify(legacyAutomatic)),
    testEnv.DB.prepare(`
      UPDATE program_revisions SET config_json = ?1
      WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
    `).bind(JSON.stringify(legacyAutomatic)),
    testEnv.DB.prepare(`
      INSERT INTO programs (
        id, merchant_id, external_ref, type, name, status, config_json, priority,
        max_uses, usage_count, budget_remaining, active_revision, draft_revision,
        created_at, updated_at
      ) VALUES (
        'legacy-coded-row', 'phase-0-merchant', 'legacy-coded', 'promo',
        'Legacy coded', 'active', ?1, 10, 10, 0, 5000, 1, NULL, ?2, ?2
      )
    `).bind(JSON.stringify(legacyCoded), createdAt),
    testEnv.DB.prepare(`
      INSERT INTO program_revisions (
        program_id, merchant_id, revision, config_json, created_at, created_by,
        published_at, published_by
      ) VALUES (
        'legacy-coded-row', 'phase-0-merchant', 1, ?1, ?2, 'migration-test',
        ?2, 'migration-test'
      )
    `).bind(JSON.stringify(legacyCoded), createdAt),
    testEnv.DB.prepare(`
      INSERT INTO program_counters (
        program_id, merchant_id, max_uses, usage_count, budget_remaining,
        committed_spend
      ) VALUES ('legacy-coded-row', 'phase-0-merchant', 10, 0, 5000, 0)
    `),
  ]);

  await applyD1Migrations(testEnv.DB, [migration]);

  const automatic = JSON.parse((await testEnv.DB.prepare(`
    SELECT config_json AS configJson FROM program_revisions
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
  `).first<{ configJson: string }>())!.configJson) as Record<string, unknown>;
  expect(automatic).toMatchObject({ autoApply: true, stackable: false });
  expect(automatic).not.toHaveProperty('code');
  expect(automatic).not.toHaveProperty('stackingGroup');

  const coded = JSON.parse((await testEnv.DB.prepare(`
    SELECT config_json AS configJson FROM program_revisions
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-coded-row'
  `).first<{ configJson: string }>())!.configJson) as Record<string, unknown>;
  expect(coded).toMatchObject({ autoApply: false, code: 'vip20', stackable: true });
  expect(coded).not.toHaveProperty('stackingGroup');
  expect(await testEnv.DB.prepare(`
    SELECT display_code AS displayCode, normalized_code AS normalizedCode
    FROM promo_code_claims
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-coded-row'
  `).first()).toEqual({ displayCode: 'vip20', normalizedCode: 'VIP20' });

  expect(await testEnv.DB.prepare(`
    SELECT position, program_ref AS programRef, program_revision AS programRevision,
      reward_rule_ref AS rewardRuleRef, effects_json AS effectsJson,
      discount_minor_units AS discountMinorUnits, currency
    FROM redemption_entries WHERE redemption_id = 'legacy-redemption'
  `).first()).toEqual({
    position: 0,
    programRef: 'legacy-welcome',
    programRevision: 1,
    rewardRuleRef: 'welcome-reward',
    effectsJson: JSON.stringify([{
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    }]),
    discountMinorUnits: 500,
    currency: 'GBP',
  });
  expect(await testEnv.DB.prepare(`
    SELECT mode, submitted_codes_json AS submittedCodesJson,
      code_results_json AS codeResultsJson, request_digest AS requestDigest,
      correlation_id AS correlationId
    FROM evaluation_decisions WHERE id = 'legacy-evaluation'
  `).first()).toEqual({
    mode: 'automatic',
    submittedCodesJson: '[]',
    codeResultsJson: '[]',
    requestDigest: 'legacy:legacy-evaluation',
    correlationId: 'migration:legacy-evaluation',
  });
  expect(await testEnv.DB.prepare(`
    SELECT merchant_id AS merchantId, idempotency_key AS idempotencyKey,
      external_order_ref AS externalOrderRef, request_digest AS requestDigest,
      state, terminal_error_code AS terminalErrorCode, retryable,
      redemption_id AS redemptionId
    FROM redemption_operations
    WHERE merchant_id = 'phase-0-merchant' AND idempotency_key = 'legacy-key'
  `).first()).toEqual({
    merchantId: 'phase-0-merchant',
    idempotencyKey: 'legacy-key',
    externalOrderRef: 'legacy-order',
    requestDigest: 'legacy:legacy-redemption',
    state: 'committed',
    terminalErrorCode: null,
    retryable: null,
    redemptionId: 'legacy-redemption',
  });
});

test('aborts ambiguous legacy trigger configurations instead of guessing intent', async () => {
  const migration = await resetToMigrationFive();
  const ambiguous = {
    ...programConfiguration,
    id: 'ambiguous-coded',
    name: 'Ambiguous coded',
    autoApply: undefined,
    code: 'MAYBE-A-CODE',
  };
  await testEnv.DB.prepare(`
    UPDATE programs SET config_json = ?1
    WHERE merchant_id = 'phase-0-merchant' AND id = 'legacy-program-row'
  `).bind(JSON.stringify(ambiguous)).run();
  await testEnv.DB.prepare(`
    UPDATE program_revisions SET config_json = ?1
    WHERE merchant_id = 'phase-0-merchant' AND program_id = 'legacy-program-row'
  `).bind(JSON.stringify(ambiguous)).run();

  await expect(applyD1Migrations(testEnv.DB, [migration]))
    .rejects.toThrow(/legacy promo trigger/i);
  expect(await testEnv.DB.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'promo_code_claims'
  `).first()).toEqual({ count: 0 });
});

test.each([
  ['Unicode uppercase expansion', 'ß'],
  ['non-ASCII edge whitespace', '\u00a0VIP20\u00a0'],
])('aborts %s that SQL cannot normalize like the shared helper', async (_case, code) => {
  const migration = await resetToMigrationFive();
  await insertLegacyCodedProgram({
    rowId: 'unsafe-normalization-row',
    programRef: 'unsafe-normalization',
    code,
  });

  await expect(applyD1Migrations(testEnv.DB, [migration]))
    .rejects.toThrow(/application-assisted normalization/i);
  expect(await testEnv.DB.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'promo_code_claims'
  `).first()).toEqual({ count: 0 });
});

test.each([
  ['before Unicode', 'logical', 'A\u0000ß'],
  ['before Unicode', 'revision', 'A\u0000ß'],
  ['before an overlength suffix', 'logical', `A\u0000${'B'.repeat(128)}`],
  ['before an overlength suffix', 'revision', `A\u0000${'B'.repeat(128)}`],
] as const)(
  'aborts an embedded NUL %s in a %s legacy code',
  async (_case, source, code) => {
    const migration = await resetToMigrationFive();
    await insertLegacyCodedProgram({
      rowId: 'nul-code-row',
      programRef: 'nul-code',
      code,
    });
    const otherSourceUpdate = source === 'logical'
      ? `
          UPDATE program_revisions
          SET config_json = json_set(config_json, '$.code', 'SAFE')
          WHERE merchant_id = 'phase-0-merchant' AND program_id = 'nul-code-row'
        `
      : `
          UPDATE programs
          SET config_json = json_set(config_json, '$.code', 'SAFE')
          WHERE merchant_id = 'phase-0-merchant' AND id = 'nul-code-row'
        `;
    await testEnv.DB.prepare(otherSourceUpdate).run();
    const nulProbe = source === 'logical'
      ? await testEnv.DB.prepare(`
          SELECT instr(
            CAST(json_extract(config_json, '$.code') AS BLOB),
            X'00'
          ) AS nulPosition
          FROM programs
          WHERE merchant_id = 'phase-0-merchant' AND id = 'nul-code-row'
        `).first()
      : await testEnv.DB.prepare(`
          SELECT instr(
            CAST(json_extract(config_json, '$.code') AS BLOB),
            X'00'
          ) AS nulPosition
          FROM program_revisions
          WHERE merchant_id = 'phase-0-merchant' AND program_id = 'nul-code-row'
        `).first();
    expect(nulProbe).toEqual({ nulPosition: 2 });

    await expect(applyD1Migrations(testEnv.DB, [migration]))
      .rejects.toThrow(/legacy promo trigger/i);
    expect(await testEnv.DB.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'promo_code_claims'
    `).first()).toEqual({ count: 0 });
  },
);

test('aborts a printable ASCII legacy code above the shared 128-character limit', async () => {
  const migration = await resetToMigrationFive();
  await insertLegacyCodedProgram({
    rowId: 'oversized-code-row',
    programRef: 'oversized-code',
    code: 'A'.repeat(129),
  });

  await expect(applyD1Migrations(testEnv.DB, [migration]))
    .rejects.toThrow(/legacy promo trigger/i);
  expect(await testEnv.DB.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'promo_code_claims'
  `).first()).toEqual({ count: 0 });
});

test('releases inactive and elapsed legacy claims while retaining reusable active ownership', async () => {
  const migration = await resetToMigrationFive();
  await insertLegacyCodedProgram({
    rowId: 'ended-code-row',
    programRef: 'ended-code',
    code: 'REUSED',
    status: 'ended',
    endDate: '2026-07-01',
  });
  await insertLegacyCodedProgram({
    rowId: 'active-code-row',
    programRef: 'active-code',
    code: 'reused',
  });
  await insertLegacyCodedProgram({
    rowId: 'elapsed-code-row',
    programRef: 'elapsed-code',
    code: 'ELAPSED',
    endDate: '2000-01-01',
  });
  await insertLegacyCodedProgram({
    rowId: 'inactive-code-row',
    programRef: 'inactive-code',
    code: 'INACTIVE',
    status: 'draft',
  });

  await applyD1Migrations(testEnv.DB, [migration]);

  expect((await testEnv.DB.prepare(`
    SELECT program_ref AS programRef, released_at AS releasedAt
    FROM promo_code_claims
    WHERE program_ref IN ('ended-code', 'active-code', 'elapsed-code', 'inactive-code')
    ORDER BY program_ref
  `).all()).results).toEqual([
    { programRef: 'active-code', releasedAt: null },
    { programRef: 'elapsed-code', releasedAt: '2000-01-01' },
    { programRef: 'ended-code', releasedAt: '2026-07-01' },
    { programRef: 'inactive-code', releasedAt: createdAt },
  ]);
});

test('aborts overlapping unreleased legacy code claims before creating target tables', async () => {
  const migration = await resetToMigrationFive();
  await insertLegacyCodedProgram({
    rowId: 'overlap-one-row',
    programRef: 'overlap-one',
    code: ' vip20 ',
    startDate: '2026-07-01',
  });
  await insertLegacyCodedProgram({
    rowId: 'overlap-two-row',
    programRef: 'overlap-two',
    code: 'VIP20',
    startDate: '2026-07-15',
  });

  await expect(applyD1Migrations(testEnv.DB, [migration]))
    .rejects.toThrow(/overlapping legacy promo code/i);
  expect(await testEnv.DB.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'promo_code_claims'
  `).first()).toEqual({ count: 0 });
});

test.each([
  ['missing version', "json_remove(result_json, '$.version')"],
  ['null committed status', "json_set(result_json, '$.result.status', json('null'))"],
  ['missing receipt hash', "json_remove(result_json, '$.receiptIntegrityHash')"],
])('aborts a legacy redemption with %s', async (_case, resultExpression) => {
  const migration = await resetToMigrationFive();
  await testEnv.DB.prepare(`
    UPDATE redemptions SET result_json = ${resultExpression}
    WHERE id = 'legacy-redemption'
  `).run();

  await expect(applyD1Migrations(testEnv.DB, [migration]))
    .rejects.toThrow(/legacy redemption/i);
  expect(await testEnv.DB.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'redemption_entries'
  `).first()).toEqual({ count: 0 });
});

test('backfills the revision from the unique full legacy decision match', async () => {
  const migration = await resetToMigrationFive();
  const row = await testEnv.DB.prepare(`
    SELECT decisions_json AS decisionsJson
    FROM evaluation_decisions WHERE id = 'legacy-evaluation'
  `).first<{ decisionsJson: string }>();
  const [matchingDecision] = JSON.parse(row!.decisionsJson) as Array<Record<string, unknown>>;
  const decoyDecision = {
    ...matchingDecision,
    programRevision: 99,
    rewardRuleRef: 'decoy-rule',
    effects: [],
  };
  await testEnv.DB.prepare(`
    UPDATE evaluation_decisions SET decisions_json = ?1
    WHERE id = 'legacy-evaluation'
  `).bind(JSON.stringify([decoyDecision, matchingDecision])).run();

  await applyD1Migrations(testEnv.DB, [migration]);

  expect(await testEnv.DB.prepare(`
    SELECT program_revision AS programRevision
    FROM redemption_entries WHERE redemption_id = 'legacy-redemption'
  `).first()).toEqual({ programRevision: 1 });
});
