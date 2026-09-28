export async function assertAuthE2eMigrations(database: D1Database): Promise<void> {
  const expected = [
    '0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql',
  ];
  const migrations = await database.prepare(`SELECT name FROM d1_migrations
    WHERE name IN ('0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql')`)
    .all<{ name: string }>();
  const tables = await database.prepare(`SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name IN
      ('e2e_run_claims', 'e2e_run_disposal_audit', 'e2e_fixture_sessions', 'session')`)
    .all<{ name: string; sql: string }>();
  if (!expected.every(name => migrations.results.some(row => row.name === name))
    || !['e2e_run_claims', 'e2e_run_disposal_audit', 'e2e_fixture_sessions', 'session']
      .every(name => tables.results.some(row => row.name === name))
    || !tables.results.find(row => row.name === 'session')?.sql.includes('e2e-fixture')) {
    throw new Error('Auth E2E migrations 0005/0006 are missing or incomplete');
  }
}
