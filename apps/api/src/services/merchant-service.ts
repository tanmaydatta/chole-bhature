import type { OperatorCallContext } from '@incentives/contracts';

import { requireOperatorContext } from '../auth/operator-context.js';
import type { Repositories, MerchantProvision, MerchantRecord } from '../repositories/types.js';

export function createMerchantService(repositories: Repositories) {
  return {
    async provision(
      operatorInput: OperatorCallContext,
      input: MerchantProvision,
    ): Promise<MerchantRecord> {
      const operator = requireOperatorContext(operatorInput, 'credentials:manage');
      if (operator.merchantId !== input.id) {
        throw new Error('Operator merchant selection does not match the provisioned merchant');
      }
      const provisioned = await repositories.merchants.provision(input);
      if (provisioned.status === 'active') return provisioned;
      const active = await repositories.merchants.activate(provisioned.id, new Date().toISOString());
      if (active === null) throw new Error('Provisioned merchant could not be activated');
      return active;
    },
  };
}
