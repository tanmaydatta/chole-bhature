import { bootstrapRootCore } from './bootstrap-root-core.mjs';
import { buildBootstrapRootWranglerCommand as buildWranglerCommand } from './bootstrap-wrangler-command.mjs';

export interface BootstrapRootInput {
  database: D1Database;
  authSecret: string;
  email: string;
  correlationId: string;
  now?: () => number;
}

export interface BootstrapRootResult {
  userId: string;
  status: 'pending';
  activationGrant: string;
  expiresAt: number;
}

export interface BootstrapRootCommandDependencies {
  bootstrap(email: string, correlationId: string): Promise<BootstrapRootResult>;
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export type BootstrapEnvironment = 'local' | 'staging';

export interface BootstrapWranglerCommand {
  command: string;
  arguments: string[];
}

export function buildBootstrapRootWranglerCommand(input: {
  environment: BootstrapEnvironment;
  sqlFile: string;
  localConfig?: string;
  localPersistTo?: string;
}): BootstrapWranglerCommand {
  return buildWranglerCommand(input);
}

export async function bootstrapRoot(input: BootstrapRootInput): Promise<BootstrapRootResult> {
  return bootstrapRootCore({
    ...input,
    database: {
      first: <T>(sql: string, params: (string | number | null)[] = []) => input.database.prepare(sql).bind(...params).first<T>(),
      batch: statements => input.database.batch(statements.map(({ sql, params = [] }) => input.database.prepare(sql).bind(...params))),
    },
  });
}

export async function runBootstrapRootCommand(
  arguments_: string[],
  dependencies: BootstrapRootCommandDependencies,
): Promise<number> {
  if (
    arguments_.length !== 4
    || arguments_[0] !== '--environment'
    || !['local', 'staging'].includes(arguments_[1] ?? '')
    || arguments_[2] !== '--email'
    || !arguments_[3]
  ) {
    dependencies.writeError(
      'Usage: bootstrap-root --environment <local|staging> --email <root-email>',
    );
    return 2;
  }
  try {
    const correlationId = crypto.randomUUID();
    const result = await dependencies.bootstrap(arguments_[3], correlationId);
    dependencies.writeOutput(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    dependencies.writeError('Root bootstrap failed. Inspect the correlation audit for details.');
    return 1;
  }
}
