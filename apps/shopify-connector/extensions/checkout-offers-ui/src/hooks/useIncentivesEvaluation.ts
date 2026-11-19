import { useState, useEffect, useRef, useCallback } from 'react';
import type { EvaluationRequest, EvaluationResponse, CandidateOffer } from '@incentives/contracts';

export type { CandidateOffer };

export interface CartLine {
  id: string;
  quantity: number;
  merchandise?: {
    id: string;
    title?: string;
    [key: string]: unknown;
  };
  cost?: {
    totalAmount?: {
      amount: number;
      currencyCode: string;
    };
  };
}

export interface Money {
  amount: number;
  currencyCode: string;
}

export interface Cost {
  subtotalAmount: Money;
  totalAmount: Money;
}

export interface DiscountCode {
  code: string;
}

export interface AppMetafield {
  metafield: {
    namespace: string;
    key: string;
    value: string;
  };
}

export type AttributeChange =
  | { type: 'updateAttribute'; key: string; value: string }
  | { type: 'deleteAttribute'; key: string };

export type DiscountCodeChange =
  | { type: 'addDiscountCode'; code: string }
  | { type: 'removeDiscountCode'; code: string };

export type InterceptorResult =
  | { behavior?: 'block'; canBlockProgress: true; reason: string; label?: string }
  | { behavior?: 'allow'; canBlockProgress: false; reason?: string };

export interface SignedEvaluationPayload {
  evaluationId: string;
  shopDomain?: string;
  cartId: string;
  subtotalMinorUnits: number;
  currency: string;
  discountMinorUnits: number;
  target?: string;
  expiresAt?: string;
  signature: string;
}

export interface ExtensionSettings {
  apiUrl?: string;
  publishableKey?: string;
  signingSecret?: string;
}

export interface UseIncentivesEvaluationOptions {
  apiUrl?: string;
  publishableKey?: string;
  cartId?: string;
  shopDomain?: string;
  signingSecret?: string;
  settings?: ExtensionSettings;
  appMetafields?: AppMetafield[];
  cartLines?: CartLine[];
  cost?: Cost;
  discountCodes?: DiscountCode[];
  applyAttributeChange?:
    | ((change: AttributeChange) => Promise<{ type: string; message?: string }>)
    | ((...args: any[]) => any);
  applyDiscountCodeChange?:
    | ((change: DiscountCodeChange) => Promise<{ type: string; message?: string }>)
    | ((...args: any[]) => any);
  buyerJourneyIntercept?:
    | ((
        interceptor: (props: { canBlockProgress: boolean }) => InterceptorResult | Promise<InterceptorResult>
      ) => () => void)
    | ((...args: any[]) => any);
}

export async function computePayloadSignature(
  data: {
    evaluationId: string;
    cartId: string;
    subtotalMinorUnits: number;
    currency: string;
    discountMinorUnits: number;
    expiresAt?: string;
  },
  secret: string
): Promise<string> {
  const message = `${data.evaluationId}:${data.cartId}:${data.subtotalMinorUnits}:${data.currency}:${data.discountMinorUnits}:${data.expiresAt ?? ''}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function useIncentivesEvaluation(options: UseIncentivesEvaluationOptions) {
  const {
    cartId = 'gid://shopify/Cart/default',
    shopDomain = 'default.myshopify.com',
    settings,
    appMetafields = [],
    cartLines = [],
    cost,
    discountCodes = [],
    applyAttributeChange,
    applyDiscountCodeChange,
    buyerJourneyIntercept,
  } = options;

  const apiUrl =
    options.apiUrl ??
    settings?.apiUrl ??
    appMetafields.find((m) => m.metafield?.key === 'api_url')?.metafield?.value ??
    'https://api.incentives.dev';

  const publishableKey =
    options.publishableKey ??
    settings?.publishableKey ??
    appMetafields.find((m) => m.metafield?.key === 'publishable_key')?.metafield?.value ??
    '';

  const signingSecret =
    options.signingSecret ??
    settings?.signingSecret ??
    appMetafields.find(
      (m) => m.metafield?.key === 'signing-secret' || m.metafield?.key === 'signing_secret'
    )?.metafield?.value ??
    'default-secret';

  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [candidateOffers, setCandidateOffers] = useState<CandidateOffer[]>([]);
  const [appliedOffer, setAppliedOffer] = useState<string | null>(null);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);

  // Keep refs to avoid unnecessary re-evaluations
  const inFlightRef = useRef(inFlight);
  inFlightRef.current = inFlight;
  const appliedCodeRef = useRef(appliedCode);
  appliedCodeRef.current = appliedCode;
  const appliedOfferRef = useRef(appliedOffer);
  appliedOfferRef.current = appliedOffer;
  const isInitialMount = useRef(true);

  // Intercept checkout progress while evaluation is in-flight
  useEffect(() => {
    if (!buyerJourneyIntercept) return;

    const unsubscribe = buyerJourneyIntercept((_props) => {
      if (inFlightRef.current) {
        return {
          behavior: 'block',
          canBlockProgress: true,
          reason: 'Evaluation in progress',
          label: 'Evaluating available offers...',
        };
      }
      return {
        behavior: 'allow',
        canBlockProgress: false,
      };
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [buyerJourneyIntercept]);

  const runEvaluation = useCallback(
    async (submittedCodes?: string[]): Promise<EvaluationResponse | null> => {
      setInFlight(true);
      setError(null);

      try {
        const subtotal = Math.round(Number(cost?.subtotalAmount?.amount ?? 0) * 100);
        const currency = cost?.subtotalAmount?.currencyCode ?? 'USD';

        const codesToEvaluate =
          submittedCodes !== undefined
            ? submittedCodes
            : discountCodes.map((d) => d.code).filter(Boolean);

        const items = cartLines.map((line) => {
          const qty = line.quantity ?? 1;
          const totalAmount = Number(line.cost?.totalAmount?.amount ?? 0);
          const unitPrice = Math.round((totalAmount * 100) / Math.max(1, qty));
          return {
            lineRef: line.id,
            productRef: line.merchandise?.id ?? line.id,
            variantRef: line.merchandise?.id,
            unitPrice,
            quantity: qty,
          };
        });

        const reqBody: EvaluationRequest = {
          cart: {
            currency,
            subtotal,
            items,
          },
          codes: codesToEvaluate,
          includeCandidateOffers: true,
        };

        const res = await fetch(`${apiUrl}/v1/evaluate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${publishableKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reqBody),
        });

        if (!res.ok) {
          throw new Error(`Evaluation failed: HTTP ${res.status}`);
        }

        const data: EvaluationResponse = await res.json();
        setEvaluation(data);
        setCandidateOffers(data.candidateOffers ?? []);

        return data;
      } catch (err: any) {
        const message = err?.message ?? 'Failed to evaluate incentives';
        setError(message);
        return null;
      } finally {
        setInFlight(false);
      }
    },
    [apiUrl, publishableKey, cost, cartLines, discountCodes]
  );

  // Run evaluation on mount or when subtotal/cartLines change
  const cartFingerprint = `${cost?.subtotalAmount?.amount}:${cost?.subtotalAmount?.currencyCode}:${cartLines.length}`;
  useEffect(() => {
    let active = true;
    const currentCode = appliedCodeRef.current;
    const currentOffer = appliedOfferRef.current;
    const codesToEvaluate = currentCode ? [currentCode] : undefined;

    runEvaluation(codesToEvaluate).then(async (newEval) => {
      if (!active || !newEval || !applyAttributeChange) return;

      // Skip re-writing on initial mount before any offer or code was applied
      if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
      }

      const subtotalMinorUnits = Math.round(Number(cost?.subtotalAmount?.amount ?? 0) * 100);
      const currency = cost?.subtotalAmount?.currencyCode ?? 'USD';

      if (currentCode) {
        const totalDiscount = newEval.priceBreakdown?.totalDiscount ?? 0;
        if (totalDiscount > 0) {
          const signature = await computePayloadSignature(
            {
              evaluationId: newEval.evaluationId,
              cartId,
              subtotalMinorUnits,
              currency,
              discountMinorUnits: totalDiscount,
              expiresAt: newEval.expiresAt,
            },
            signingSecret
          );
          const payload: SignedEvaluationPayload = {
            evaluationId: newEval.evaluationId,
            shopDomain,
            cartId,
            subtotalMinorUnits,
            currency,
            discountMinorUnits: totalDiscount,
            target: 'order',
            expiresAt: newEval.expiresAt,
            signature,
          };
          await applyAttributeChange({
            type: 'updateAttribute',
            key: '_incentives_eval',
            value: JSON.stringify(payload),
          });
        }
      } else if (currentOffer) {
        const matchingOffer = newEval.candidateOffers?.find(
          (o) => o.programRef === currentOffer && o.qualified
        );
        if (matchingOffer && matchingOffer.estimatedDiscountMinorUnits) {
          const discountMinorUnits = matchingOffer.estimatedDiscountMinorUnits;
          const signature = await computePayloadSignature(
            {
              evaluationId: newEval.evaluationId,
              cartId,
              subtotalMinorUnits,
              currency,
              discountMinorUnits,
              expiresAt: newEval.expiresAt,
            },
            signingSecret
          );
          const payload: SignedEvaluationPayload = {
            evaluationId: newEval.evaluationId,
            shopDomain,
            cartId,
            subtotalMinorUnits,
            currency,
            discountMinorUnits,
            target: 'order',
            expiresAt: newEval.expiresAt,
            signature,
          };
          await applyAttributeChange({
            type: 'updateAttribute',
            key: '_incentives_eval',
            value: JSON.stringify(payload),
          });
        }
      }
    });

    return () => {
      active = false;
    };
  }, [
    cartFingerprint,
    runEvaluation,
    applyAttributeChange,
    cost,
    cartId,
    signingSecret,
    shopDomain,
  ]);

  const selectOffer = useCallback(
    async (offer: CandidateOffer): Promise<boolean> => {
      if (!evaluation || !applyAttributeChange) {
        return false;
      }

      try {
        const subtotalMinorUnits = Math.round(Number(cost?.subtotalAmount?.amount ?? 0) * 100);
        const currency = cost?.subtotalAmount?.currencyCode ?? 'USD';
        const discountMinorUnits = offer.estimatedDiscountMinorUnits ?? 0;

        const signature = await computePayloadSignature(
          {
            evaluationId: evaluation.evaluationId,
            cartId,
            subtotalMinorUnits,
            currency,
            discountMinorUnits,
            expiresAt: evaluation.expiresAt,
          },
          signingSecret
        );

        const payload: SignedEvaluationPayload = {
          evaluationId: evaluation.evaluationId,
          shopDomain,
          cartId,
          subtotalMinorUnits,
          currency,
          discountMinorUnits,
          target: 'order',
          expiresAt: evaluation.expiresAt,
          signature,
        };

        await applyAttributeChange({
          type: 'updateAttribute',
          key: '_incentives_eval',
          value: JSON.stringify(payload),
        });

        setAppliedOffer(offer.programRef);
        return true;
      } catch (err: any) {
        setError(err?.message ?? 'Failed to apply offer');
        return false;
      }
    },
    [evaluation, applyAttributeChange, cost, cartId, signingSecret, shopDomain]
  );

  const applyPromoCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!code.trim()) return false;
      const normalizedCode = code.trim().toUpperCase();

      const evalData = await runEvaluation([normalizedCode]);
      if (!evalData) return false;

      const totalDiscount = evalData.priceBreakdown?.totalDiscount ?? 0;
      const isRejected = evalData.codeResults?.some(
        (c) =>
          c.code === normalizedCode &&
          (c.outcome === 'invalid_code' ||
            c.outcome === 'exhausted' ||
            c.outcome === 'not_qualified' ||
            c.outcome === 'unavailable' ||
            c.outcome === 'combination_rejected' ||
            c.outcome === ('rejected' as any))
      );
      if (isRejected || totalDiscount <= 0) {
        setError(`Promo code "${normalizedCode}" is invalid or does not apply to this cart`);
        return false;
      }

      if (applyDiscountCodeChange) {
        await applyDiscountCodeChange({
          type: 'addDiscountCode',
          code: normalizedCode,
        });
      }

      if (applyAttributeChange) {
        const subtotalMinorUnits = Math.round(Number(cost?.subtotalAmount?.amount ?? 0) * 100);
        const currency = cost?.subtotalAmount?.currencyCode ?? 'USD';

        const signature = await computePayloadSignature(
          {
            evaluationId: evalData.evaluationId,
            cartId,
            subtotalMinorUnits,
            currency,
            discountMinorUnits: totalDiscount,
            expiresAt: evalData.expiresAt,
          },
          signingSecret
        );

        const payload: SignedEvaluationPayload = {
          evaluationId: evalData.evaluationId,
          shopDomain,
          cartId,
          subtotalMinorUnits,
          currency,
          discountMinorUnits: totalDiscount,
          target: 'order',
          expiresAt: evalData.expiresAt,
          signature,
        };

        await applyAttributeChange({
          type: 'updateAttribute',
          key: '_incentives_eval',
          value: JSON.stringify(payload),
        });
      }

      setAppliedCode(normalizedCode);
      return true;
    },
    [runEvaluation, applyDiscountCodeChange, applyAttributeChange, cost, cartId, signingSecret, shopDomain]
  );

  return {
    inFlight,
    error,
    evaluation,
    candidateOffers,
    appliedOffer,
    appliedCode,
    selectOffer,
    applyPromoCode,
    reEvaluate: runEvaluation,
  };
}
