import type { OperatorCallContext } from '@incentives/contracts';
import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app.js';
import type { Env } from './env.js';
import {
  createCredential,
  listCredentials,
  revokeCredential,
} from './routes/credentials.js';
import { provisionMerchant } from './routes/internal-merchants.js';

export class CoreOperatorService extends WorkerEntrypoint<Env> {
  provisionMerchant(context: OperatorCallContext, input: Parameters<typeof provisionMerchant>[2]) {
    return provisionMerchant(this.env, context, input);
  }

  createCredential(context: OperatorCallContext, input: unknown) {
    return createCredential(this.env, context, input);
  }

  listCredentials(context: OperatorCallContext) {
    return listCredentials(this.env, context);
  }

  revokeCredential(context: OperatorCallContext, credentialId: string) {
    return revokeCredential(this.env, context, credentialId);
  }
}

export default createApp();
