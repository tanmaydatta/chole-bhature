import {
  MerchantActivationRequestSchema,
  MerchantActivationResultSchema,
  MerchantProvisionRequestSchema,
  MerchantProvisionResultSchema,
  type MerchantActivationRequest,
  type MerchantProvisionRequest,
  type OperatorCallContext,
} from '@incentives/contracts';

import type { Env } from '../env.js';
import { createRepositories } from '../repositories/d1-repositories.js';
import { createMerchantService } from '../services/merchant-service.js';

export async function provisionMerchant(
  env: Env,
  context: OperatorCallContext,
  input: MerchantProvisionRequest,
) {
  return MerchantProvisionResultSchema.parse(
    await createMerchantService(createRepositories(env)).provision(
      context,
      MerchantProvisionRequestSchema.parse(input),
    ),
  );
}

export async function activateMerchant(
  env: Env,
  context: OperatorCallContext,
  input: MerchantActivationRequest,
) {
  return MerchantActivationResultSchema.parse(
    await createMerchantService(createRepositories(env)).activate(
      context,
      MerchantActivationRequestSchema.parse(input),
    ),
  );
}
