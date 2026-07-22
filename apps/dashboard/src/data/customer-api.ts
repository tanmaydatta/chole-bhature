import { bffClient } from '../lib/bff-client';

export const customerApi = {
  get: bffClient.customer,
  patch: bffClient.patchCustomer,
};
