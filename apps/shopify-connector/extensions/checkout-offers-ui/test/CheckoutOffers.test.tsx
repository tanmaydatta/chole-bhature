// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { CheckoutOffers } from '../src/CheckoutOffers.js';
import type {
  CartLine,
  Cost,
  DiscountCode,
  InterceptorResult,
} from '../src/hooks/useIncentivesEvaluation.js';

describe('CheckoutOffers Extension Component', () => {
  const originalFetch = globalThis.fetch;
  let mockCartLines: CartLine[];
  let mockCost: Cost;
  let mockDiscountCodes: DiscountCode[];
  let mockApplyAttributeChange: any;
  let mockApplyDiscountCodeChange: any;
  let interceptorFn: ((props: { canBlockProgress: boolean }) => InterceptorResult) | null = null;
  let mockBuyerJourneyIntercept: any;

  beforeEach(() => {
    mockCartLines = [
      {
        id: 'gid://shopify/CartLine/1',
        quantity: 2,
        merchandise: {
          id: 'gid://shopify/ProductVariant/101',
          title: 'Premium Bhature',
        },
        cost: {
          totalAmount: { amount: 50.0, currencyCode: 'USD' },
        },
      },
    ];

    mockCost = {
      subtotalAmount: { amount: 50.0, currencyCode: 'USD' },
      totalAmount: { amount: 50.0, currencyCode: 'USD' },
    };

    mockDiscountCodes = [];
    mockApplyAttributeChange = vi.fn().mockResolvedValue({ type: 'success' });
    mockApplyDiscountCodeChange = vi.fn().mockResolvedValue({ type: 'success' });
    interceptorFn = null;
    mockBuyerJourneyIntercept = vi.fn().mockImplementation((callback) => {
      interceptorFn = callback;
      return () => {
        interceptorFn = null;
      };
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders eligible candidate offers and allows claiming an offer with signed attribute write', async () => {
    const mockEvalResponse = {
      evaluationId: 'eval-mock-101',
      schemaVersion: 1,
      expiresAt: '2026-11-19T12:00:00.000Z',
      decisions: [],
      priceBreakdown: {
        currency: 'USD',
        originalMerchandiseSubtotal: 5000,
        discountAllocations: [],
        totalDiscount: 1000,
        discountedMerchandiseSubtotal: 4000,
      },
      candidateOffers: [
        {
          programRef: 'tier-10',
          name: '10% off entire order',
          qualified: true,
          estimatedDiscountMinorUnits: 1000,
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockEvalResponse,
    });

    render(
      <CheckoutOffers
        apiUrl="https://api.incentives.dev"
        publishableKey="pk_live_test_123"
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        signingSecret="test-secret-456"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    // Initial evaluation should be triggered
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.incentives.dev/v1/evaluate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer pk_live_test_123',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    // Offer title and estimated discount should be displayed
    expect(await screen.findByText('10% off entire order')).toBeDefined();
    expect(screen.getByText(/save \$10\.00/i)).toBeDefined();

    // Click Claim button to claim offer
    const applyBtn = screen.getByRole('button', { name: /claim/i });
    fireEvent.click(applyBtn);

    // Should update _incentives_eval attribute
    await waitFor(() => {
      expect(mockApplyAttributeChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateAttribute',
          key: '_incentives_eval',
          value: expect.any(String),
        })
      );
    });

    const parsedAttr = JSON.parse(mockApplyAttributeChange.mock.calls[0][0].value);
    expect(parsedAttr).toMatchObject({
      evaluationId: 'eval-mock-101',
      cartId: 'gid://shopify/Cart/c1-test',
      subtotalMinorUnits: 5000,
      currency: 'USD',
      discountMinorUnits: 1000,
      target: 'order',
      expiresAt: '2026-11-19T12:00:00.000Z',
    });
    expect(parsedAttr.signature).toBeDefined();
    expect(typeof parsedAttr.signature).toBe('string');
  });

  it('renders tier shortfall progress bar for unqualified candidate offers with progress', async () => {
    const mockEvalResponse = {
      evaluationId: 'eval-mock-102',
      schemaVersion: 1,
      expiresAt: '2026-11-19T12:00:00.000Z',
      decisions: [],
      priceBreakdown: {
        currency: 'USD',
        originalMerchandiseSubtotal: 8000,
        discountAllocations: [],
        totalDiscount: 0,
        discountedMerchandiseSubtotal: 8000,
      },
      candidateOffers: [
        {
          programRef: 'tier-20',
          name: '20% off large carts',
          qualified: false,
          estimatedDiscountMinorUnits: 2000,
          progress: {
            current: 8000,
            target: 10000,
            shortfall: 2000,
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockEvalResponse,
    });

    render(
      <CheckoutOffers
        apiUrl="https://api.incentives.dev"
        publishableKey="pk_live_test_123"
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        signingSecret="test-secret-456"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    // Verify shortfall message is displayed
    const shortfallText = await screen.findByText(/add \$20\.00 more to unlock 20% off large carts/i);
    expect(shortfallText).toBeDefined();

    // Verify progress bar element
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeDefined();
    expect(progressBar.getAttribute('aria-valuenow')).toBe('80');
    expect(progressBar.getAttribute('aria-valuemin')).toBe('0');
    expect(progressBar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('in-widget promo code box submits code and applies discount and attribute', async () => {
    const mockInitialResponse = {
      evaluationId: 'eval-initial',
      schemaVersion: 1,
      expiresAt: '2026-11-19T12:00:00.000Z',
      decisions: [],
      priceBreakdown: {
        currency: 'USD',
        originalMerchandiseSubtotal: 5000,
        discountAllocations: [],
        totalDiscount: 0,
        discountedMerchandiseSubtotal: 5000,
      },
      candidateOffers: [],
    };

    const mockCodeResponse = {
      evaluationId: 'eval-code-applied',
      schemaVersion: 1,
      expiresAt: '2026-11-19T12:00:00.000Z',
      decisions: [
        {
          programRef: 'promo-summer25',
          outcome: 'qualified',
          effects: [{ type: 'percentage_discount', percentage: 25 }],
        },
      ],
      priceBreakdown: {
        currency: 'USD',
        originalMerchandiseSubtotal: 5000,
        discountAllocations: [],
        totalDiscount: 1250,
        discountedMerchandiseSubtotal: 3750,
      },
      codeResults: [{ code: 'SUMMER25', outcome: 'accepted' }],
    };

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInitialResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockCodeResponse,
      });

    render(
      <CheckoutOffers
        apiUrl="https://api.incentives.dev"
        publishableKey="pk_live_test_123"
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        signingSecret="test-secret-456"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    // Find promo code input and submit button
    const codeInput = await screen.findByPlaceholderText(/enter promo code/i);
    const submitBtn = screen.getByRole('button', { name: /apply code|apply/i });

    // Type promo code and apply
    fireEvent.change(codeInput, { target: { value: 'SUMMER25' } });
    fireEvent.click(submitBtn);

    // Verify second fetch called with codes array
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      const secondCallBody = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body);
      expect(secondCallBody.codes).toEqual(['SUMMER25']);
    });

    // Verify applyDiscountCodeChange called
    await waitFor(() => {
      expect(mockApplyDiscountCodeChange).toHaveBeenCalledWith({
        type: 'addDiscountCode',
        code: 'SUMMER25',
      });
    });

    // Verify applyAttributeChange called with new signed payload
    expect(mockApplyAttributeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updateAttribute',
        key: '_incentives_eval',
        value: expect.any(String),
      })
    );

    const payload = JSON.parse(mockApplyAttributeChange.mock.calls[0][0].value);
    expect(payload.evaluationId).toBe('eval-code-applied');
    expect(payload.discountMinorUnits).toBe(1250);
  });

  it('useBuyerJourneyIntercept blocks progression while evaluation is in-flight', async () => {
    let resolveEvaluation: ((value: any) => void) | null = null;
    const pendingPromise = new Promise((resolve) => {
      resolveEvaluation = resolve;
    });

    globalThis.fetch = vi.fn().mockReturnValue(pendingPromise);

    render(
      <CheckoutOffers
        apiUrl="https://api.incentives.dev"
        publishableKey="pk_live_test_123"
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        signingSecret="test-secret-456"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    // Interceptor must have been registered
    expect(mockBuyerJourneyIntercept).toHaveBeenCalled();
    expect(interceptorFn).toBeDefined();

    // While request is in-flight, interceptor must BLOCK progress
    const inFlightResult = interceptorFn!({ canBlockProgress: true });
    expect(inFlightResult.canBlockProgress).toBe(true);
    expect(inFlightResult).toHaveProperty('reason');

    // Also renders loading / evaluating indicator
    expect(screen.getByText(/evaluating/i)).toBeDefined();

    // Now resolve the promise
    resolveEvaluation!({
      ok: true,
      json: async () => ({
        evaluationId: 'eval-resolved',
        schemaVersion: 1,
        expiresAt: '2026-11-19T12:00:00.000Z',
        decisions: [],
        priceBreakdown: {
          currency: 'USD',
          originalMerchandiseSubtotal: 5000,
          discountAllocations: [],
          totalDiscount: 0,
          discountedMerchandiseSubtotal: 5000,
        },
        candidateOffers: [],
      }),
    });

    // After resolution, interceptor must ALLOW progress
    await waitFor(() => {
      const settledResult = interceptorFn!({ canBlockProgress: true });
      expect(settledResult.canBlockProgress).toBe(false);
    });
  });

  it('handles evaluation API failure gracefully without crashing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(
      <CheckoutOffers
        apiUrl="https://api.incentives.dev"
        publishableKey="pk_live_test_123"
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        signingSecret="test-secret-456"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    // Displays error message gracefully
    const errorMessage = await screen.findByText(/unable to load offers|error/i);
    expect(errorMessage).toBeDefined();

    // When errored, interceptor does not block the checkout permanently
    const interceptResult = interceptorFn!({ canBlockProgress: true });
    expect(interceptResult.canBlockProgress).toBe(false);
  });

  it('reads publishable key and apiUrl from app metafield or extension settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        evaluationId: 'eval-metafield-1',
        schemaVersion: 1,
        expiresAt: '2026-11-19T12:00:00.000Z',
        decisions: [],
        priceBreakdown: {
          currency: 'USD',
          originalMerchandiseSubtotal: 5000,
          discountAllocations: [],
          totalDiscount: 0,
          discountedMerchandiseSubtotal: 5000,
        },
        candidateOffers: [],
      }),
    });

    render(
      <CheckoutOffers
        settings={{
          apiUrl: 'https://settings-api.incentives.dev',
          publishableKey: 'pk_settings_test_789',
        }}
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://settings-api.incentives.dev/v1/evaluate',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer pk_settings_test_789',
          }),
        })
      );
    });
  });

  it('reads publishable key and apiUrl from app metafield when settings are omitted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        evaluationId: 'eval-metafield-2',
        schemaVersion: 1,
        expiresAt: '2026-11-19T12:00:00.000Z',
        decisions: [],
        priceBreakdown: {
          currency: 'USD',
          originalMerchandiseSubtotal: 5000,
          discountAllocations: [],
          totalDiscount: 0,
          discountedMerchandiseSubtotal: 5000,
        },
        candidateOffers: [],
      }),
    });

    render(
      <CheckoutOffers
        appMetafields={[
          {
            metafield: {
              namespace: '$app:incentives',
              key: 'api_url',
              value: 'https://metafield-api.incentives.dev',
            },
          },
          {
            metafield: {
              namespace: '$app:incentives',
              key: 'publishable_key',
              value: 'pk_metafield_test_999',
            },
          },
        ]}
        cartId="gid://shopify/Cart/c1-test"
        shopDomain="test-store.myshopify.com"
        cartLines={mockCartLines}
        cost={mockCost}
        discountCodes={mockDiscountCodes}
        applyAttributeChange={mockApplyAttributeChange}
        applyDiscountCodeChange={mockApplyDiscountCodeChange}
        buyerJourneyIntercept={mockBuyerJourneyIntercept}
      />
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://metafield-api.incentives.dev/v1/evaluate',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer pk_metafield_test_999',
          }),
        })
      );
    });
  });
});
