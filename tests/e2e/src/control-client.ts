import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { E2eControlBootstrapSchema, E2eControlBootstrapResultSchema, E2eControlCapabilitiesSchema, E2eControlRunViewSchema, E2eControlEnvelopeSchema, E2eControlErrorSchema, type E2eControlBootstrapResult, type E2eControlCapabilities, type E2eControlRunView } from '@incentives/contracts';
import { newRunId } from './config.js';
export interface LocalControlTarget {
  operatorOrigin: string;
  apiOrigin: string;
  generation: string;
  targetId: string;
  setupSecret: string;
}
class ControlFailure extends Error {
}
const refused = (phase = 'validation', status?: number, code?: string) => new ControlFailure('Local preauth control request refused; phase=' + phase +
  (status === undefined ? '' : '; status=' + status) + (code === undefined ? '' : '; code=' + code));
export function assertLocalControlTarget(target: LocalControlTarget): void {
  try {
    for (const value of [target.operatorOrigin, target.apiOrigin]) {
      const url = new URL(value);
      if (url.origin !== value || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port)
        throw refused();
    }
    E2eControlEnvelopeSchema.parse(envelope(target));
    if (!target.setupSecret || /[\s,]/u.test(target.setupSecret))
      throw refused();
  }
  catch {
    throw refused();
  }
}
function envelope(target: LocalControlTarget) {
  return { protocol: 'incentives-e2e-control' as const, version: 2 as const, generation: target.generation, targetId: target.targetId, requestId: crypto.randomUUID() };
}
export async function privateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700)
    throw refused();
}
export async function createControlRecord(path: string, target: LocalControlTarget): Promise<string> {
  try {
    assertLocalControlTarget(target);
    await privateDirectory(dirname(path));
    const input = E2eControlBootstrapSchema.parse({ operation: 'bootstrap', envelope: envelope(target), runId: newRunId(),
      proof: randomBytes(32).toString('base64url'), controllerToken: randomBytes(32).toString('base64url'), name: 'Local Promo fixture' });
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(input) + '\n');
      await file.sync();
    }
    finally {
      await file.close();
    }
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    }
    finally {
      await directory.close();
    }
    return path;
  }
  catch {
    throw refused();
  }
}
export async function readControlRecord(path: string) {
  try {
    await privateDirectory(dirname(path));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size > 16384)
      throw refused();
    return E2eControlBootstrapSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  }
  catch {
    throw refused();
  }
}
export class ControlClient {
  readonly target: Readonly<LocalControlTarget>;
  constructor(target: LocalControlTarget) { assertLocalControlTarget(target); this.target = Object.freeze({ ...target }); }
  private async request(path: string, input: unknown): Promise<unknown> {
    const phase = path === 'capabilities' || path === 'bootstrap' ? path : path.endsWith('/dispose') ? 'dispose' : 'status';
    try {
      const result = await new Promise<{
        status: number;
        body: unknown;
      }>((resolve, reject) => {
        // Node's HTTP client has no browser metadata or implicit redirect following.
        const req = httpRequest(this.target.operatorOrigin + '/operator/v1/e2e-control/' + path, { method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { authorization: 'E2E-Setup ' + this.target.setupSecret, 'content-type': 'application/json' } }, response => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65536) {
            response.destroy();
            reject(refused(phase));
          }
          else
            chunks.push(chunk); });
          response.once('error', () => reject(refused(phase)));
          response.once('end', () => { try {
            resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          }
          catch {
            reject(refused(phase));
          } });
        });
        req.setTimeout(10000, () => req.destroy());
        req.once('error', () => reject(refused(phase)));
        req.end(JSON.stringify(input));
      });
      if (result.status < 200 || result.status >= 300) {
        const error = E2eControlErrorSchema.safeParse(result.body);
        throw refused(phase, result.status, error.success ? error.data.error.code : 'UNKNOWN');
      }
      return result.body;
    }
    catch (error) {
      throw error instanceof ControlFailure ? error : refused(phase);
    }
  }
  async capabilities(): Promise<E2eControlCapabilities> {
    try {
      const result = E2eControlCapabilitiesSchema.parse(await this.request('capabilities', { operation: 'capabilities', envelope: envelope(this.target) }));
      if (result.runtime.environment !== 'local' || result.runtime.generation !== this.target.generation || result.runtime.targetId !== this.target.targetId
        || !['0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql', '0007_e2e_control_leases.sql'].every(name => result.migrations.auth.includes(name))
        || !['0008_e2e_tenant_lifecycle.sql', '0009_e2e_control_leases.sql'].every(name => result.migrations.product.includes(name)))
        throw refused();
      return result;
    }
    catch (error) {
      throw error instanceof ControlFailure ? error : refused('capabilities');
    }
  }
  async bootstrap(path: string): Promise<E2eControlBootstrapResult> {
    try {
      const input = await readControlRecord(path);
      if (input.envelope.generation !== this.target.generation || input.envelope.targetId !== this.target.targetId)
        throw refused();
      const result = E2eControlBootstrapResultSchema.parse(await this.request('bootstrap', input));
      if (result.lease.runId !== input.runId || result.lease.generation !== this.target.generation || result.lease.targetId !== this.target.targetId
        || result.lease.phase !== 'active' || result.lease.expiresAt <= Date.now() || result.admin.runId !== input.runId
        || result.admin.merchantId !== result.lease.merchantId || result.admin.organizationId !== result.lease.organizationId
        || result.admin.cookieAttributes.expiresAt > result.lease.expiresAt)
        throw refused();
      return result;
    }
    catch (error) {
      throw error instanceof ControlFailure ? error : refused('bootstrap');
    }
  }
  async action(path: string, operation: 'status' | 'dispose'): Promise<E2eControlRunView> {
    try {
      const record = await readControlRecord(path);
      const result = E2eControlRunViewSchema.parse(await this.request('runs/' + record.runId + '/' + operation, { operation, envelope: envelope(this.target), runId: record.runId, proof: record.proof }));
      if (result.lease.runId !== record.runId || result.lease.generation !== this.target.generation || result.lease.targetId !== this.target.targetId)
        throw refused();
      const authTables = ['client_provisionings', 'organizations', 'users', 'memberships', 'invitations', 'sessions', 'fixture_sessions', 'auth_profile', 'account', 'passkey', 'local_email_capture', 'verification', 'identity_audit'];
      const productTables = ['redemption_entries', 'redemption_operations', 'redemptions', 'evaluation_decisions', 'promo_code_claims', 'program_counters', 'program_revisions', 'programs',
        'api_credentials', 'customers', 'variable_definitions', 'schema_versions', 'product_audit', 'merchants', 'redemption_commit_guards', 'credential_rate_limit_windows'];
      if (!authTables.every(table => Object.hasOwn(result.auth, table)) || !productTables.every(table => Object.hasOwn(result.product, table)))
        throw refused();
      return result;
    }
    catch (error) {
      throw error instanceof ControlFailure ? error : refused(operation);
    }
  }
}
