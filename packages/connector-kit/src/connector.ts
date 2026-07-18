import type {
  CartSnapshot,
  CustomerSnapshot,
  Effect,
  IncentiveDecision,
  OrderSnapshot,
} from '@incentives/contracts';

export interface ConnectorCapabilities {
  readonly automaticDiscounts: boolean;
  readonly discountCodes: boolean;
  readonly lineItemAdjustments: boolean;
  readonly checkoutBlocking: boolean;
  readonly customerAttributes: boolean;
  readonly orderWebhooks: boolean;
  readonly walletRedemption: boolean;
}

export interface VerificationResult {
  readonly verified: boolean;
}

export interface CommerceConnector<TCustomer, TCart, TOrder, TDecision> {
  capabilities(): ConnectorCapabilities;
  normalizeCustomer(input: TCustomer): CustomerSnapshot;
  normalizeCart(input: TCart): CartSnapshot;
  normalizeOrder(input: TOrder): OrderSnapshot;
  mapDecision(decision: IncentiveDecision): TDecision;
  verifyIncomingRequest(request: Request): Promise<VerificationResult>;
}

export class UnsupportedConnectorCapabilityError extends Error {
  readonly code = 'UNSUPPORTED_CONNECTOR_CAPABILITY';

  constructor(readonly effectType: Effect['type']) {
    super(`Connector cannot represent effect: ${effectType}`);
    this.name = 'UnsupportedConnectorCapabilityError';
  }
}
