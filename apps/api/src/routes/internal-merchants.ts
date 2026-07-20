import type { OperatorCallContext } from '@incentives/contracts';

import type { Env } from '../env.js';
import { createRepositories } from '../repositories/d1-repositories.js';
import type { MerchantProvision } from '../repositories/types.js';
import { createMerchantService } from '../services/merchant-service.js';

export async function provisionMerchant(
  env: Env,
  context: OperatorCallContext,
  input: MerchantProvision,
) {
  return createMerchantService(createRepositories(env)).provision(context, input);
}
