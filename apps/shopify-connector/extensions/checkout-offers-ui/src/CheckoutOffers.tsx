import React, { useState } from 'react';
import {
  useIncentivesEvaluation,
  type UseIncentivesEvaluationOptions,
  type CandidateOffer,
} from './hooks/useIncentivesEvaluation.js';

export interface CheckoutOffersProps extends UseIncentivesEvaluationOptions {
  title?: string;
}

function formatMoney(minorUnits: number): string {
  return `$${(minorUnits / 100).toFixed(2)}`;
}

export function CheckoutOffers(props: CheckoutOffersProps) {
  const { title = 'Special Offers & Rewards', ...hookOptions } = props;

  const {
    inFlight,
    error,
    candidateOffers,
    appliedOffer,
    appliedCode,
    selectOffer,
    applyPromoCode,
  } = useIncentivesEvaluation(hookOptions);

  const [promoCodeInput, setPromoCodeInput] = useState('');

  const handleApplyPromoCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCodeInput.trim()) return;
    const success = await applyPromoCode(promoCodeInput);
    if (success) {
      setPromoCodeInput('');
    }
  };

  return (
    <div className="incentives-checkout-offers" style={{ padding: '16px', border: '1px solid #e1e3e5', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600 }}>{title}</h3>

      {inFlight && (
        <div role="status" style={{ padding: '8px', marginBottom: '12px', background: '#f4f6f8', borderRadius: '4px', fontSize: '14px' }}>
          Evaluating available offers...
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: '8px', marginBottom: '12px', background: '#fff4f4', color: '#d72c0d', borderRadius: '4px', fontSize: '14px' }}>
          Unable to load offers: {error}
        </div>
      )}

      {/* In-Widget Promo Code Box */}
      <form onSubmit={handleApplyPromoCode} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Enter promo code"
          value={promoCodeInput}
          onChange={(e) => setPromoCodeInput(e.target.value)}
          aria-label="Promo code"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #c9cccf', borderRadius: '4px' }}
        />
        <button
          type="submit"
          aria-label="Apply promo code"
          disabled={inFlight || !promoCodeInput.trim()}
          style={{ padding: '8px 16px', background: '#008060', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Apply Code
        </button>
      </form>

      {appliedCode && (
        <div style={{ padding: '8px', marginBottom: '12px', background: '#f0fdf4', color: '#166534', borderRadius: '4px', fontSize: '13px' }}>
          Code applied: <strong>{appliedCode}</strong>
        </div>
      )}

      {/* Candidate Offers List */}
      {candidateOffers.length > 0 && (
        <div className="candidate-offers-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {candidateOffers.map((offer: CandidateOffer) => {
            const isApplied = appliedOffer === offer.programRef;

            if (offer.qualified) {
              return (
                <div
                  key={offer.programRef}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    border: '1px solid #d3d5d7',
                    borderRadius: '6px',
                    background: isApplied ? '#f0fdf4' : '#ffffff',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{offer.name}</div>
                    {offer.estimatedDiscountMinorUnits > 0 && (
                      <div style={{ color: '#008060', fontSize: '13px', marginTop: '2px' }}>
                        Save {formatMoney(offer.estimatedDiscountMinorUnits)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={isApplied ? `Applied ${offer.name}` : `Claim ${offer.name}`}
                    disabled={isApplied || inFlight}
                    onClick={() => selectOffer(offer)}
                    style={{
                      padding: '6px 14px',
                      background: isApplied ? '#166534' : '#008060',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isApplied ? 'default' : 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    {isApplied ? 'Applied' : 'Claim'}
                  </button>
                </div>
              );
            }

            // Unqualified offer with shortfall progress
            if (offer.progress) {
              const current = offer.progress.current;
              const target = offer.progress.target;
              const shortfall = offer.progress.shortfall;
              const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

              return (
                <div
                  key={offer.programRef}
                  style={{
                    padding: '12px',
                    border: '1px dashed #c9cccf',
                    borderRadius: '6px',
                    background: '#fafbfb',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{offer.name}</div>
                  <div style={{ fontSize: '13px', color: '#5c5f62', marginBottom: '8px' }}>
                    Add {formatMoney(shortfall)} more to unlock {offer.name}
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={{
                      height: '8px',
                      background: '#e4e5e7',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: '#008060',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}

export default CheckoutOffers;
