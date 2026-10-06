import { bootstrapRootCore, validateBootstrapInput } from '../../apps/identity/src/cli/bootstrap-root-core.mjs';
import { withBootstrapAuthDatabase } from './cloudflare.mjs';

// No CLI, environment lookup or deployment authority. Positive execution is local-only.
export async function bootstrapCiRoot({ authDatabaseId, key, authSecret, email, d1Client }) {
  try {
    const correlationId = crypto.randomUUID();
    validateBootstrapInput({ authSecret, email, correlationId });
    return await withBootstrapAuthDatabase(d1Client, { authDatabaseId, key }, async (database, now) => {
      const { activationGrant, expiresAt } = await bootstrapRootCore({ database, authSecret, email, correlationId, now: () => now });
      return { activationGrant, expiresAt };
    });
  } catch { throw new Error('Local CI root bootstrap refused or failed.'); }
}
