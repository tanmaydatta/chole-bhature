export interface BootstrapStatement { sql: string; params?: (string | number | null)[] }
export interface BootstrapDatabase {
  first<T>(sql: string, params?: (string | number | null)[]): Promise<T | null>;
  /** All statements must commit or roll back together. */
  batch(statements: BootstrapStatement[]): Promise<unknown>;
}
export interface BootstrapCoreInput {
  database: BootstrapDatabase;
  authSecret: string;
  email: string;
  correlationId: string;
  now?: () => number;
}
export interface BootstrapCoreResult { userId: string; status: 'pending'; activationGrant: string; expiresAt: number }
export function validateBootstrapInput(input: Omit<BootstrapCoreInput, 'database'>): { email: string; now: number };
export function renderBootstrapSql(statement: BootstrapStatement): string;
export function bootstrapRootCore(input: BootstrapCoreInput): Promise<BootstrapCoreResult>;
