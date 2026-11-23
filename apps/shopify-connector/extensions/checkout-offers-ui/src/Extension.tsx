import { useEffect, useRef, useState } from 'preact/hooks';
import type { CandidateOffer, EvaluationResponse } from '@incentives/contracts';
import {
  INCENTIVES_CODE_ATTRIBUTE,
  INCENTIVES_EVAL_ATTRIBUTE,
  buildEvaluationRequest,
  cartChangeFingerprint,
  formatMoney,
  getShopifyApi,
  hasPositiveDiscount,
  rejectedCodeOutcome,
  type ShopifyAttribute,
} from './extension-utils.js';

const API_BASE_URL = (
  import.meta.env.VITE_INCENTIVES_API_URL ?? 'https://shopify.incentives.dev'
).replace(/\/$/u, '');

function attributeValue(attributes: readonly ShopifyAttribute[], key: string): string | undefined {
  return attributes.find(attribute => attribute.key === key)?.value;
}

export function Extension() {
  const api = getShopifyApi();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offers, setOffers] = useState<CandidateOffer[]>([]);
  const [code, setCode] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(() => {
    const raw = attributeValue(api.attributes.value, INCENTIVES_CODE_ATTRIBUTE);
    return raw && raw.trim().length > 0 ? raw : null;
  });
  const state = useRef({ inFlight, appliedCode });
  state.current = { inFlight, appliedCode };
  const lastEvaluationId = useRef<string | null>(null);
  const requestSequence = useRef(0);

  async function clearDiscount(): Promise<boolean> {
    try {
      const result = await api.applyAttributeChange({
        type: 'removeAttribute',
        key: INCENTIVES_EVAL_ATTRIBUTE,
      });
      if (result.type === 'error') {
        setError('We could not update the cart discount. You can continue at the current price.');
        return false;
      }
      await api.applyAttributeChange({
        type: 'removeAttribute',
        key: INCENTIVES_CODE_ATTRIBUTE,
      });
      return true;
    } catch {
      setError('We could not update the cart discount. You can continue at the current price.');
      return false;
    }
  }

  async function writeDiscount(response: EvaluationResponse): Promise<boolean> {
    if (hasPositiveDiscount(response) && response.signedEvaluation) {
      try {
        const result = await api.applyAttributeChange({
          type: 'updateAttribute',
          key: INCENTIVES_EVAL_ATTRIBUTE,
          value: JSON.stringify(response.signedEvaluation),
        });
        if (result.type === 'error') {
          setError('We could not apply this offer to the cart.');
          return false;
        }
        return true;
      } catch {
        setError('We could not apply this offer to the cart.');
        return false;
      }
    }
    return clearDiscount();
  }

  async function evaluate(codes: readonly string[]): Promise<EvaluationResponse | null> {
    if (!api.instructions.value.attributes.canUpdateAttributes) {
      setNotice('Offers are unavailable for this checkout method.');
      return null;
    }

    const checkoutToken = api.checkoutToken.value;
    if (!checkoutToken) {
      setError('Checkout is not ready yet. Please wait a moment.');
      return null;
    }

    setInFlight(true);
    setError(null);
    setNotice(null);
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const token = await api.sessionToken.get();
      const request = buildEvaluationRequest(
        api.lines.value,
        api.cost.subtotalAmount.value,
        codes,
      );
      const response = await fetch(`${API_BASE_URL}/v1/evaluate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          checkoutToken,
          previousEvaluationId: lastEvaluationId.current,
        }),
        signal: controller.signal,
      });
      if (sequence !== requestSequence.current) return null;
      if (response.status === 409) {
        lastEvaluationId.current = null;
        await clearDiscount();
        setNotice('This offer is no longer available. You can continue at full price.');
        return null;
      }
      if (!response.ok) {
        throw new Error(`Evaluation failed with HTTP ${response.status}`);
      }

      const data = (await response.json()) as EvaluationResponse;
      if (sequence !== requestSequence.current) return null;
      lastEvaluationId.current = data.evaluationId;
      setOffers(data.candidateOffers ?? []);
      const written = await writeDiscount(data);
      if (!written) {
        setOffers([]);
        return null;
      }
      return data;
    } catch (error) {
      if (sequence !== requestSequence.current) return null;
      if (error instanceof Error && error.name === 'AbortError') {
        setNotice('Checking offers timed out. You can continue at the current price.');
      } else {
        setError('We could not check offers right now. You can continue at the current price.');
      }
      await clearDiscount();
      return null;
    } finally {
      clearTimeout(timeout);
      if (sequence === requestSequence.current) {
        setInFlight(false);
      }
    }
  }

  const subtotal = api.cost.subtotalAmount.value;
  const lineFingerprint = cartChangeFingerprint(api.lines.value);
  const checkoutToken = api.checkoutToken.value;

  useEffect(() => {
    if (!checkoutToken) return;
    void evaluate(appliedCode ? [appliedCode] : []);
    // The cart fingerprint and subtotal are the intentional re-evaluation triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal.amount, subtotal.currencyCode, lineFingerprint, checkoutToken]);

  useEffect(() => {
    let interceptRunning = false;
    let dispose: (() => void) | undefined;
    void api.buyerJourney.intercept(async ({ canBlockProgress }) => {
      if (!canBlockProgress) {
        return { behavior: 'allow', canBlockProgress: false };
      }
      if (state.current.inFlight) {
        return {
          behavior: 'block',
          canBlockProgress: true,
          reason: 'Checking available offers…',
        };
      }
      if (interceptRunning) {
        return { behavior: 'allow', canBlockProgress: false };
      }
      interceptRunning = true;
      try {
        const data = await evaluate(state.current.appliedCode ? [state.current.appliedCode] : []);
        if (!data || !hasPositiveDiscount(data)) {
          await clearDiscount();
          setNotice('This offer is no longer available. You can continue at full price.');
        }
        return { behavior: 'allow', canBlockProgress: false };
      } finally {
        interceptRunning = false;
      }
    }).then(teardown => {
      dispose = teardown;
    });

    return () => {
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyCode(): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    const data = await evaluate([normalized]);
    if (!data || !hasPositiveDiscount(data) || rejectedCodeOutcome(data, normalized)) {
      setError(`Promo code “${normalized}” is invalid or does not apply to this cart.`);
      await api.applyAttributeChange({
        type: 'removeAttribute',
        key: INCENTIVES_CODE_ATTRIBUTE,
      });
      setAppliedCode(null);
      return;
    }
    const codeWrite = await api.applyAttributeChange({
      type: 'updateAttribute',
      key: INCENTIVES_CODE_ATTRIBUTE,
      value: normalized,
    });
    if (codeWrite.type === 'error') {
      setError('We could not save this promo code.');
      return;
    }
    setAppliedCode(normalized);
    setCode('');
  }

  return (
    <s-stack gap="base">
      <s-heading>Special offers</s-heading>

      {inFlight && (
        <s-text color="subdued">Checking available offers…</s-text>
      )}

      {error && (
        <s-banner tone="critical" heading="Offer unavailable">
          {error}
        </s-banner>
      )}

      {notice && (
        <s-banner tone="warning">
          {notice}
        </s-banner>
      )}

      <s-stack direction="inline" gap="small" alignItems="end">
        <s-text-field
          label="Promo code"
          value={code}
          disabled={inFlight}
          onInput={(event: Event) => {
            const target = event.currentTarget as HTMLInputElement | null;
            setCode(target?.value ?? '');
          }}
        />
        <s-button onClick={applyCode} disabled={inFlight || code.trim().length === 0}>
          Apply code
        </s-button>
      </s-stack>

      {appliedCode && (
        <s-banner tone="success">
          Code applied: {appliedCode}
        </s-banner>
      )}

      {offers.map(offer => {
        if (offer.qualified) {
          return (
            <s-stack key={offer.programRef} direction="inline" justifyContent="space-between" alignItems="center">
              <s-text type="strong">{offer.name}</s-text>
              {offer.estimatedDiscountMinorUnits > 0 && (
                <s-badge tone="neutral">
                  Save {formatMoney(offer.estimatedDiscountMinorUnits, subtotal.currencyCode)}
                </s-badge>
              )}
            </s-stack>
          );
        }

        if (!offer.progress || offer.progress.shortfall <= 0) return null;
        const percent = offer.progress.target > 0
          ? Math.min(100, Math.round((offer.progress.current / offer.progress.target) * 100))
          : 0;

        return (
          <s-stack key={offer.programRef} gap="small-200">
            <s-text type="strong">{offer.name}</s-text>
            <s-text color="subdued">
              Add {formatMoney(offer.progress.shortfall, subtotal.currencyCode)} more to unlock this offer.
            </s-text>
            <s-progress value={percent} max={100} />
          </s-stack>
        );
      })}
    </s-stack>
  );
}
