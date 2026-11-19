import type {
  ApiCredentialCreateInput,
  ApiCredentialCreateResult,
  CoreMerchantActivationResult,
  CoreMerchantProvisionResult,
  MerchantActivationRequest,
  MerchantProvisionRequest,
  OperatorCallContext,
} from '@incentives/contracts';

export interface CoreServiceBinding {
  provisionMerchant(
    context: OperatorCallContext,
    input: MerchantProvisionRequest,
  ): Promise<CoreMerchantProvisionResult>;
  activateMerchant?(
    context: OperatorCallContext,
    input: MerchantActivationRequest,
  ): Promise<CoreMerchantActivationResult>;
  createCredential(
    context: OperatorCallContext,
    input: ApiCredentialCreateInput,
  ): Promise<ApiCredentialCreateResult>;
  commitRedemption?(input: unknown): Promise<unknown>;
  [key: string]: unknown;
}

export interface Env {
  CORE: CoreServiceBinding;
  DB: D1Database;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_APP_URL?: string;
  SHOPIFY_DISCOUNT_FUNCTION_ID?: string;
  SHOPIFY_API_VERSION?: string;
  APP_ENV?: string;
}
