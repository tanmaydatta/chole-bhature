import type {
  MerchantActivationRequest,
  MerchantActivationResult,
  MerchantProvisionRequest,
  MerchantProvisionResult,
  OperatorCallContext,
} from '@incentives/contracts';

import { requireOperatorContext } from '../auth/operator-context.js';
import type { Repositories } from '../repositories/types.js';

export function createMerchantService(repositories: Repositories) {
  return {
    async provision(
      operatorInput: OperatorCallContext,
      input: MerchantProvisionRequest,
    ): Promise<MerchantProvisionResult> {
      const operator = requireOperatorContext(operatorInput, 'credentials:manage');
      if (operator.merchantId !== input.id) {
        throw new Error('Operator merchant selection does not match the provisioned merchant');
      }
      return repositories.merchants.provision(input);
    },

    async activate(
      operatorInput: OperatorCallContext,
      input: MerchantActivationRequest,
    ): Promise<MerchantActivationResult> {
      const operator = requireOperatorContext(operatorInput, 'credentials:manage');
      if (operator.merchantId !== input.id) {
        throw new Error('Operator merchant selection does not match the activated merchant');
      }
      return repositories.merchants.activate(input, new Date().toISOString());
    },
  };
}
