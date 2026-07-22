export function buildBootstrapRootWranglerCommand({ environment, sqlFile }) {
  const target = environment === 'local'
    ? ['incentives-auth-local', '--local']
    : ['incentives-auth-staging', '--env', 'staging', '--remote'];
  return {
    command: 'pnpm',
    arguments: [
      'exec', 'wrangler', 'd1', 'execute', ...target,
      '--file', sqlFile, '--json',
    ],
  };
}
