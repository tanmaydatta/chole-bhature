import type {
  CandidateOffer,
  EvaluationRequest,
  EvaluationResponse,
} from '@incentives/contracts';

export const INCENTIVES_EVAL_ATTRIBUTE = '_incentives_eval';

export interface ShopifyMoney {
  amount: number;
  currencyCode: string;
}

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  cost: {
    totalAmount: ShopifyMoney;
  };
  merchandise: {
    id: string;
    product?: {
      id: string;
    };
  };
}

export interface ShopifyAttribute {
  key: string;
  value: string;
}

export interface InterceptorResult {
  behavior: 'allow' | 'block';
  canBlockProgress: boolean;
  reason?: string;
}

export interface ShopifyExtensionApi {
  shop: {
    myshopifyDomain: string;
  };
  cost: {
    subtotalAmount: {
      value: ShopifyMoney;
    };
  };
  lines: {
    value: ShopifyCartLine[];
  };
  checkoutToken: {
    value: string | undefined;
  };
  sessionToken: {
    get(): Promise<string>;
  };
  attributes: {
    value: ShopifyAttribute[];
  };
  instructions: {
    value: {
      attributes: {
        canUpdateAttributes: boolean;
      };
    };
  };
  applyAttributeChange(change: {
    type: 'updateAttribute';
    key: string;
    value: string;
  } | {
    type: 'removeAttribute';
    key: string;
  }): Promise<{ type: 'success' | 'error'; message?: string }>;
  buyerJourney: {
    intercept(
      callback: (props: { canBlockProgress: boolean }) => InterceptorResult | Promise<InterceptorResult>,
    ): () => void;
  };
}

export function getShopifyApi(): ShopifyExtensionApi {
  return (globalThis as typeof globalThis & { shopify: ShopifyExtensionApi }).shopify;
}

export function cartItems(lines: readonly ShopifyCartLine[]): EvaluationRequest['cart']['items'] {
  return lines.map(line => {
    const quantity = Math.max(1, line.quantity);
    return {
      lineRef: line.id,
      productRef: line.merchandise.product?.id ?? line.merchandise.id,
      variantRef: line.merchandise.id,
      quantity,
      unitPrice: Math.round((line.cost.totalAmount.amount * 100) / quantity),
    };
  });
}

export function buildEvaluationRequest(
  lines: readonly ShopifyCartLine[],
  subtotal: ShopifyMoney,
  codes: readonly string[] = [],
): EvaluationRequest {
  return {
    cart: {
      currency: subtotal.currencyCode,
      subtotal: Math.round(subtotal.amount * 100),
      items: cartItems(lines),
    },
    codes: codes.filter(code => code.trim().length > 0),
    includeCandidateOffers: true,
  };
}

export function cartChangeFingerprint(lines: readonly ShopifyCartLine[]): string {
  return lines
    .map(line => `${line.id}:${line.quantity}:${line.cost.totalAmount.amount}`)
    .join('|');
}

export function formatMoney(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

export function hasPositiveDiscount(response: EvaluationResponse): boolean {
  return response.priceBreakdown.totalDiscount > 0 && response.signedEvaluation !== undefined;
}

export function rejectedCodeOutcome(
  response: EvaluationResponse,
  code: string,
): boolean {
  const normalized = code.trim().toUpperCase();
  return (response.codeResults ?? []).some(result => (
    result.code.toUpperCase() === normalized
    && result.outcome !== 'selected'
  ));
}

export function qualifiedOffers(offers: readonly CandidateOffer[] | undefined): CandidateOffer[] {
  return (offers ?? []).filter(offer => offer.qualified);
}

export function progressOffers(offers: readonly CandidateOffer[] | undefined): CandidateOffer[] {
  return (offers ?? []).filter(offer => !offer.qualified && offer.progress !== undefined);
}
