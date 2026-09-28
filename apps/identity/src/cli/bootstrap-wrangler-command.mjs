export function buildBootstrapRootWranglerCommand({ environment, sqlFile,
  localConfig, localPersistTo }) {
  if ((localConfig || localPersistTo) && environment !== 'local') {
    throw new Error('Local Wrangler override is local only');
  }
  if (Boolean(localConfig) !== Boolean(localPersistTo)) {
    throw new Error('Local Wrangler config and persistence path must be supplied together');
  }
  const target = environment === 'local'
    ? ['incentives-auth-local', '--local',
      ...(localConfig ? ['--config', localConfig, '--persist-to', localPersistTo] : [])]
    : ['incentives-auth-staging', '--env', 'staging', '--remote'];
  return {
    command: 'pnpm',
    arguments: [
      'exec', 'wrangler', 'd1', 'execute', ...target,
      '--file', sqlFile, '--json',
    ],
  };
}
