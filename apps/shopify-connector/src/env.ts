import type {
  ApiCredentialCreateInput,
  ApiCredentialCreateResult,
  ApiError,
  BudgetLeaseReleaseRequest,
  BudgetLeaseReserveRequest,
  BudgetLeaseReserveResponse,
  CoreMerchantActivationResult,
  CoreMerchantProvisionResult,
  CustomerPatchRequest,
  CustomerRecord,
  EvaluationRequest,
  EvaluationResponse,
  MerchantActivationRequest,
  MerchantProvisionRequest,
  OperatorCallContext,
  RedemptionRequest,
  RedemptionResponse,
  SchemaDefinitionView,
  SchemaDefinitionsResponse,
  SchemaPublicationResult,
  VariableDefinition,
} from '@incentives/contracts';

/**
 * Cloudflare service binding to the `CoreOperatorService` entrypoint exported by
 * apps/api/src/worker.ts. The binding MUST declare `entrypoint = "CoreOperatorService"`
 * in wrangler.toml, otherwise these RPC methods do not exist at runtime.
 */
export interface CoreServiceBinding {
  evaluate(
    context: OperatorCallContext,
    input: EvaluationRequest,
  ): Promise<EvaluationResponse | ApiError>;
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
  listSchemaDefinitions(context: OperatorCallContext): Promise<SchemaDefinitionsResponse>;
  createSchemaDefinition(
    context: OperatorCallContext,
    input: VariableDefinition,
  ): Promise<SchemaDefinitionView>;
  publishSchema(context: OperatorCallContext): Promise<SchemaPublicationResult>;
  commitRedemption(input: RedemptionRequest & { merchantId: string }): Promise<RedemptionResponse>;
  reserveBudgetLeases?(
    context: OperatorCallContext,
    input: BudgetLeaseReserveRequest,
  ): Promise<BudgetLeaseReserveResponse>;
  releaseBudgetLeases?(
    context: OperatorCallContext,
    input: BudgetLeaseReleaseRequest,
  ): Promise<{ released: boolean }>;
  upsertCustomer?(
    context: OperatorCallContext,
    customerRef: string,
    input: CustomerPatchRequest,
  ): Promise<CustomerRecord>;
  reverseRedemption?(input: {
    merchantId?: string;
    orderId?: number | string;
    idempotencyKey?: string;
  }): Promise<unknown>;
  refundRedemption?(input: {
    merchantId?: string;
    orderId?: number | string;
    refundId?: number | string;
    refundLineItems?: unknown;
  }): Promise<unknown>;
  fetch?(request: Request | string, init?: RequestInit): Promise<Response>;
  [key: string]: unknown;
}

export interface Env {
  CORE: CoreServiceBinding;
  DB: D1Database;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_APP_URL?: string;
  SHOPIFY_DISCOUNT_FUNCTION_HANDLE?: string;
  SHOPIFY_API_VERSION?: string;
  /**
   * 32-byte hex/base64 key used to encrypt Shopify offline access tokens at rest.
   * In production this must be a Worker secret, never a [vars] entry.
   */
  TOKEN_ENCRYPTION_KEY?: string;
  /** Additional browser origins allowed to call the storefront evaluation endpoint. */
  CHECKOUT_ORIGINS?: string;
  /** Optional external operator dashboard URL for the embedded shell link-out. */
  OPERATOR_DASHBOARD_URL?: string;
  APP_ENV?: string;
}
