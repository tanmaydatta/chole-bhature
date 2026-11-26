import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvaluationResponse } from '@incentives/contracts';
import {
  checkoutCart,
  evaluateCart,
  loadBootstrap,
  type BootstrapData,
  type CheckoutResult,
} from './lib/api.js';
import { formatINR } from './lib/format.js';
import {
  DEMO_CUSTOMERS,
  MENU,
  MAX_LINE_QUANTITY,
  type DemoCustomerMode,
  type MenuItem,
} from './shared/demo.js';
import {
  buildOffersView,
  type CandidateOfferView,
  type OffersView,
} from './shared/offers.js';
import './styles.css';

type View = 'menu' | 'checkout' | 'confirmation';

function cartLines(cart: Record<string, number>) {
  return Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
}

function itemCount(cart: Record<string, number>): number {
  return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

function cartSubtotal(cart: Record<string, number>, menu: MenuItem[]): number {
  return menu.reduce((sum, item) => sum + item.priceMinor * (cart[item.id] ?? 0), 0);
}

function modeLabel(mode: 'core' | 'local'): string {
  return mode === 'core' ? 'Core API' : 'Local evaluator';
}

const CANDIDATE_STATUS_LABEL: Record<CandidateOfferView['status'], string> = {
  paused: 'Paused',
  outranked: 'Outranked',
  progress: 'Locked',
  locked: 'Locked',
};

function CandidateRow({ candidate }: { candidate: CandidateOfferView }) {
  const progress = candidate.progress;
  const percent = progress && progress.target > 0
    ? Math.min(100, Math.round((progress.current / progress.target) * 100))
    : 0;

  return (
    <div className={`offer status-${candidate.status}`}>
      <div className="offer-row">
        <span className="offer-name">{candidate.name}</span>
        <span className={`offer-status ${candidate.status === 'locked' ? 'locked' : ''}`}>
          {CANDIDATE_STATUS_LABEL[candidate.status]}
        </span>
      </div>
      {progress ? (
        <>
          <div
            className="progress"
            role="progressbar"
            aria-label={`${candidate.name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="offer-note">
            Add {formatINR(progress.shortfall)} more to unlock
          </span>
        </>
      ) : (
        <span className="offer-note">{candidate.note}</span>
      )}
    </div>
  );
}

function OfferList({ view }: { view: OffersView }) {
  if (
    view.applied.length === 0
    && view.codes.length === 0
    && view.candidates.length === 0
  ) {
    return <span className="offer-note">Add items to see eligible offers.</span>;
  }

  return (
    <div className="offer-list">
      {view.applied.map(offer => (
        <div className="offer applied" key={offer.programRef}>
          <div className="offer-row">
            <span className="offer-name">{offer.name}</span>
            <span className="offer-status">
              {offer.freeShipping
                ? 'Free delivery'
                : `Save ${formatINR(offer.savingsMinorUnits)}`}
            </span>
          </div>
        </div>
      ))}
      {view.codes.map(code => (
        <div className={`offer ${code.applied ? 'applied' : 'rejected'}`} key={code.normalizedCode}>
          <div className="offer-row">
            <span className="offer-name">Code {code.code}</span>
            <span className={`offer-status ${code.applied ? '' : 'locked'}`}>
              {code.applied
                ? code.savingsMinorUnits > 0
                  ? `Applied · ${formatINR(code.savingsMinorUnits)} off`
                  : 'Applied'
                : code.label}
            </span>
          </div>
          {!code.applied && <span className="offer-note">{code.label}</span>}
        </div>
      ))}
      {view.candidates.map(candidate => (
        <CandidateRow key={candidate.programRef} candidate={candidate} />
      ))}
    </div>
  );
}

function MenuCard({
  item,
  quantity,
  onAdd,
  onRemove,
}: {
  item: MenuItem;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const atMax = quantity >= MAX_LINE_QUANTITY;
  return (
    <article className="menu-card">
      <div className="menu-card-top">
        <div className="emoji-tile" aria-hidden="true">{item.emoji}</div>
        <span className="price">{formatINR(item.priceMinor)}</span>
      </div>
      <div>
        {item.tag && <span className="tag">{item.tag}</span>}
        <h3>{item.name}</h3>
        <p>{item.description}</p>
      </div>
      <div className="menu-card-bottom">
        {quantity > 0 ? (
          <div className="stepper" aria-label={`${item.name} quantity`}>
            <button type="button" onClick={onRemove} aria-label={`Remove one ${item.name}`}>−</button>
            <span>{quantity}</span>
            <button
              type="button"
              onClick={onAdd}
              disabled={atMax}
              aria-label={atMax ? `${item.name} quantity limit reached` : `Add one ${item.name}`}
            >
              +
            </button>
          </div>
        ) : (
          <button className="add-button" type="button" onClick={onAdd}>Add</button>
        )}
      </div>
    </article>
  );
}

function Totals({
  subtotal,
  discount,
  delivery,
  total,
}: {
  subtotal: number;
  discount: number;
  delivery: number;
  total: number;
}) {
  return (
    <div className="totals">
      <div className="total-row"><span>Item total</span><strong>{formatINR(subtotal)}</strong></div>
      <div className="total-row"><span>Delivery</span><strong>{delivery === 0 ? 'FREE' : formatINR(delivery)}</strong></div>
      <div className="total-row discount"><span>Offer savings</span><strong>−{formatINR(discount)}</strong></div>
      <div className="total-row grand"><span>To pay</span><strong>{formatINR(total)}</strong></div>
    </div>
  );
}

interface CartPanelProps {
  cart: Record<string, number>;
  menu: MenuItem[];
  view: OffersView | null;
  offsets: { subtotal: number; discount: number; delivery: number; total: number };
  loading: boolean;
  error: string | null;
  codeInput: string;
  codeError: string | null;
  appliedCode: string | null;
  checkingCode: boolean;
  canCheckout: boolean;
  onCodeInput: (value: string) => void;
  onApplyCode: () => void;
  onClearCode: () => void;
  onAdd: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onCheckout: () => void;
  onStartOver: () => void;
  onClose?: () => void;
}

function CartPanel({
  cart,
  menu,
  view,
  offsets,
  loading,
  error,
  codeInput,
  codeError,
  appliedCode,
  checkingCode,
  canCheckout,
  onCodeInput,
  onApplyCode,
  onClearCode,
  onAdd,
  onRemove,
  onCheckout,
  onStartOver,
  onClose,
}: CartPanelProps) {
  const lines = cartLines(cart);
  const count = itemCount(cart);
  const codesActive = (view?.codes.length ?? 0) > 0;

  return (
    <aside
      className={onClose ? 'cart-panel open' : 'cart-panel'}
      aria-label="Cart"
      {...(onClose ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      <div className="cart-head">
        <div>
          <h2>Your thali</h2>
          <p>{count} {count === 1 ? 'item' : 'items'} · demo checkout</p>
        </div>
        <div className="cart-head-actions">
          {onClose && (
            <button className="ghost-button" type="button" onClick={onClose} autoFocus>Close</button>
          )}
          <button className="text-button" type="button" onClick={onStartOver}>Start over</button>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="cart-empty">
          <div style={{ fontSize: 34, marginBottom: 8 }} aria-hidden="true">🫙</div>
          Your thali is empty. Add something delicious.
        </div>
      ) : (
        <div className="cart-lines">
          {lines.map(line => {
            const item = menu.find(candidate => candidate.id === line.itemId);
            if (!item) return null;
            const atMax = line.quantity >= MAX_LINE_QUANTITY;
            return (
              <div className="cart-line" key={line.itemId}>
                <span className="cart-line-name">{item.emoji} {item.name}</span>
                <span className="cart-line-price">{formatINR(item.priceMinor * line.quantity)}</span>
                <span className="cart-line-meta">{line.quantity} × {formatINR(item.priceMinor)}</span>
                <div className="stepper" aria-label={`${item.name} quantity`}>
                  <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove one ${item.name}`}>−</button>
                  <span>{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onAdd(item.id)}
                    disabled={atMax}
                    aria-label={atMax ? `${item.name} quantity limit reached` : `Add one ${item.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="offer-panel">
        <h3 className="offer-panel-title">Offers for this thali</h3>
        {loading && <span className="loading-note">Checking offers…</span>}
        {error && <div className="error-banner">{error}</div>}
        {!loading && !error && !view && (
          <span className="offer-note">Add items to see eligible offers.</span>
        )}
        {!loading && !error && view && <OfferList view={view} />}

        {codesActive && (
          <p className="offer-note code-mode-note">
            A code replaces auto-apply offers. Remove it to let them apply again.
          </p>
        )}

        {appliedCode ? (
          <div className="applied-code">
            <span>Code {appliedCode} applied</span>
            <button type="button" onClick={onClearCode}>Remove</button>
          </div>
        ) : (
          <>
            <div className="code-form">
              <input
                className="code-input"
                aria-label="Promo code"
                placeholder="Have a code?"
                value={codeInput}
                onChange={event => onCodeInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onApplyCode();
                  }
                }}
              />
              <button
                className="code-apply"
                type="button"
                onClick={onApplyCode}
                disabled={checkingCode || codeInput.trim().length === 0}
              >
                {checkingCode ? 'Checking…' : 'Apply'}
              </button>
            </div>
            <div className="code-hints">
              <span>Try <code>WELCOME50</code> as a new customer.</span>
              <span>Or <code>FEAST10</code> on any order.</span>
            </div>
            {codeError && <div className="code-error">{codeError}</div>}
          </>
        )}
      </div>

      {lines.length > 0 && (
        <div className="cart-actions">
          <Totals {...offsets} />
          <button
            className="primary-button"
            type="button"
            onClick={onCheckout}
            disabled={loading || !canCheckout}
          >
            {loading ? 'Updating…' : `Checkout · ${formatINR(offsets.total)}`}
          </button>
        </div>
      )}
    </aside>
  );
}

function CheckoutView({
  menu,
  cart,
  view,
  offsets,
  loading,
  error,
  canCheckout,
  onBack,
  onPlaceOrder,
}: {
  menu: MenuItem[];
  cart: Record<string, number>;
  view: OffersView | null;
  offsets: { subtotal: number; discount: number; delivery: number; total: number };
  loading: boolean;
  error: string | null;
  canCheckout: boolean;
  onBack: () => void;
  onPlaceOrder: () => void;
}) {
  const lines = cartLines(cart);
  const appliedCodes = (view?.codes ?? []).filter(code => code.applied);

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <h1>Review your order</h1>
        <p>
          This is a product demo. No payment is taken; the platform evaluates the
          cart, applies the offer, and commits a redemption.
        </p>

        <div className="checkout-section">
          <h2>Your thali</h2>
          <div className="checkout-lines">
            {lines.map(line => {
              const item = menu.find(candidate => candidate.id === line.itemId);
              if (!item) return null;
              return (
                <div className="checkout-line" key={line.itemId}>
                  <span>{item.emoji} {item.name} × {line.quantity}</span>
                  <strong>{formatINR(item.priceMinor * line.quantity)}</strong>
                </div>
              );
            })}
          </div>
        </div>

        <div className="checkout-section">
          <h2>Applied offers</h2>
          {view === null || (view.applied.length === 0 && appliedCodes.length === 0) ? (
            <span className="offer-note">
              No offer is applied to this order. You can still place the demo order.
            </span>
          ) : (
            <div className="offer-list">
              {view.applied.map(offer => (
                <div className="offer applied" key={offer.programRef}>
                  <div className="offer-row">
                    <span className="offer-name">{offer.name}</span>
                    <span className="offer-status">
                      {offer.freeShipping
                        ? 'Free delivery'
                        : `Save ${formatINR(offer.savingsMinorUnits)}`}
                    </span>
                  </div>
                </div>
              ))}
              {appliedCodes.map(code => (
                <div className="offer applied" key={code.normalizedCode}>
                  <div className="offer-row">
                    <span className="offer-name">Code {code.code}</span>
                    <span className="offer-status">
                      {code.savingsMinorUnits > 0
                        ? `Applied · ${formatINR(code.savingsMinorUnits)} off`
                        : 'Applied'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {appliedCodes.length > 0 && (
            <p className="offer-note code-mode-note">
              Auto-apply offers are paused while a code is active.
            </p>
          )}
        </div>

        <div className="checkout-section">
          <Totals {...offsets} />
        </div>

        {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}

        <div className="checkout-actions">
          <button
            className="primary-button"
            type="button"
            onClick={onPlaceOrder}
            disabled={loading || !canCheckout}
          >
            {loading ? 'Placing order…' : `Place demo order · ${formatINR(offsets.total)}`}
          </button>
          <button className="ghost-button" type="button" onClick={onBack} disabled={loading}>
            Back to menu
          </button>
        </div>
      </section>
    </main>
  );
}

function ConfirmationView({
  confirmation,
  currency,
  onBack,
}: {
  confirmation: CheckoutResult;
  currency: string;
  onBack: () => void;
}) {
  const { redemption, deliveryFeeMinor: delivery } = confirmation;
  const { priceBreakdown } = redemption;
  const total = priceBreakdown.discountedMerchandiseSubtotal + delivery;

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <div className="confirmation-mark" aria-hidden="true">✓</div>
        <h1 style={{ marginTop: 18 }}>Order confirmed</h1>
        <p>
          Your demo order is placed. The redemption was committed against the
          evaluation, using the {modeLabel(confirmation.mode)}.
        </p>
        <div className="confirmation-id">
          Order: {confirmation.orderId}<br />
          Redemption: {redemption.redemptionId}
        </div>

        <div className="checkout-section">
          <h2>Savings</h2>
          <Totals
            subtotal={priceBreakdown.originalMerchandiseSubtotal}
            discount={priceBreakdown.totalDiscount}
            delivery={delivery}
            total={total}
          />
          <p className="offer-note" style={{ marginTop: 12 }}>
            {redemption.entries.length} program{redemption.entries.length === 1 ? '' : 's'} committed · {currency}
          </p>
        </div>

        <div className="checkout-actions">
          <button className="primary-button" type="button" onClick={onBack}>Back to menu</button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerMode, setCustomerMode] = useState<DemoCustomerMode>('new');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('menu');
  const [confirmation, setConfirmation] = useState<CheckoutResult | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cartButtonRef = useRef<HTMLButtonElement | null>(null);
  const codeRequestId = useRef(0);

  const menu = bootstrap?.menu ?? MENU;
  const mode = bootstrap?.mode ?? 'local';
  const customers = bootstrap?.customers ?? Object.values(DEMO_CUSTOMERS).map(customer => ({
    mode: customer.mode,
    label: customer.label,
    description: customer.description,
  }));
  const checkoutEnabled = bootstrap?.checkoutEnabled ?? true;
  const coreReady = bootstrap?.coreReady ?? true;

  const lines = useMemo(() => cartLines(cart), [cart]);
  const cartKey = useMemo(
    () => JSON.stringify({ lines, customerMode, appliedCode }),
    [lines, customerMode, appliedCode],
  );
  const count = itemCount(cart);
  const subtotal = evaluation?.priceBreakdown.originalMerchandiseSubtotal
    ?? cartSubtotal(cart, menu);
  const discount = evaluation?.priceBreakdown.totalDiscount ?? 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  const offsets = { subtotal, discount, delivery: deliveryFee, total };
  const offersView = useMemo(
    () => (evaluation === null ? null : buildOffersView(evaluation)),
    [evaluation],
  );
  const canCheckout = lines.length > 0
    && !loading
    && !checkingCode
    && !error
    && checkoutEnabled
    && coreReady;

  useEffect(() => {
    void loadBootstrap().then(setBootstrap).catch(() => {
      // The shared menu keeps the UI usable if the BFF is restarting.
      setBootstrap({
        menu: MENU,
        customers: Object.values(DEMO_CUSTOMERS).map(customer => ({
          mode: customer.mode,
          label: customer.label,
          description: customer.description,
        })),
        codeHints: [],
        currency: 'INR',
        mode: 'local',
        coreReady: true,
        missingConfig: [],
        checkoutEnabled: true,
      });
    });
  }, []);

  useEffect(() => {
    const currentLines = cartLines(cart);
    if (currentLines.length === 0) {
      setEvaluation(null);
      setDeliveryFee(0);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    evaluateCart(currentLines, customerMode, appliedCode ? [appliedCode] : [])
      .then(result => {
        if (!active) return;
        setEvaluation(result.evaluation);
        setDeliveryFee(result.deliveryFeeMinor);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setEvaluation(null);
        setDeliveryFee(0);
        setError(cause instanceof Error ? cause.message : 'Offers are unavailable right now.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
    // cartKey is the stable serialization of the evaluation inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  useEffect(() => {
    if (!appliedCode || !evaluation?.codeResults) return;
    const result = evaluation.codeResults.find(
      candidate => candidate.normalizedCode === appliedCode,
    );
    if (!result || result.outcome === 'selected') return;
    setAppliedCode(null);
    setCodeError(
      result.outcome === 'not_qualified'
        ? `${appliedCode} no longer applies to this order.`
        : `${appliedCode} could not be applied.`,
    );
  }, [appliedCode, evaluation]);

  useEffect(() => {
    if (!cartOpen) return;
    const panel = document.querySelector<HTMLElement>('.cart-panel.open');

    function focusableElements(): HTMLElement[] {
      if (!panel) return [];
      return [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter(element => element.offsetParent !== null);
    }

    function closeAndRestore() {
      setCartOpen(false);
      window.requestAnimationFrame(() => cartButtonRef.current?.focus());
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestore();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableElements();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [cartOpen]);

  function closeCart() {
    setCartOpen(false);
    window.requestAnimationFrame(() => cartButtonRef.current?.focus());
  }

  function add(itemId: string) {
    codeRequestId.current += 1;
    setCheckingCode(false);
    setCart(current => {
      const quantity = current[itemId] ?? 0;
      if (quantity >= MAX_LINE_QUANTITY) return current;
      return { ...current, [itemId]: quantity + 1 };
    });
  }

  function remove(itemId: string) {
    codeRequestId.current += 1;
    setCheckingCode(false);
    setCart(current => {
      const quantity = (current[itemId] ?? 0) - 1;
      const next = { ...current, [itemId]: Math.max(0, quantity) };
      if (next[itemId] === 0) delete next[itemId];
      return next;
    });
  }

  async function applyCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code || checkingCode) return;
    if (cartLines(cart).length === 0) {
      setCodeError('Add items before applying a code.');
      return;
    }
    const requestId = ++codeRequestId.current;
    setCodeError(null);
    setCheckingCode(true);
    try {
      const result = await evaluateCart(cartLines(cart), customerMode, [code]);
      if (requestId !== codeRequestId.current) return;
      const codeResult = result.evaluation.codeResults?.find(
        candidate => candidate.normalizedCode === code,
      );
      if (codeResult?.outcome === 'selected') {
        setAppliedCode(code);
        setCodeInput('');
        setEvaluation(result.evaluation);
        setDeliveryFee(result.deliveryFeeMinor);
        setError(null);
      } else if (codeResult?.outcome === 'combination_rejected') {
        setCodeError('That code cannot be combined with another code.');
      } else if (codeResult?.outcome === 'not_qualified') {
        setCodeError('This code is valid but your customer profile is not eligible.');
      } else {
        setCodeError(`Code ${code} is invalid or does not apply to this cart.`);
      }
    } catch (cause) {
      if (requestId === codeRequestId.current) {
        setCodeError(cause instanceof Error ? cause.message : 'Could not validate that code.');
      }
    } finally {
      if (requestId === codeRequestId.current) setCheckingCode(false);
    }
  }

  async function placeOrder() {
    if (!canCheckout) return;
    setLoading(true);
    setError(null);
    try {
      const result = await checkoutCart(
        cartLines(cart),
        customerMode,
        appliedCode ? [appliedCode] : [],
      );
      setConfirmation(result);
      setView('confirmation');
      setCartOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not place the demo order.');
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    codeRequestId.current += 1;
    setCheckingCode(false);
    setCart({});
    setAppliedCode(null);
    setCodeInput('');
    setCodeError(null);
    setEvaluation(null);
    setDeliveryFee(0);
    setConfirmation(null);
    setView('menu');
    setError(null);
    setCartOpen(false);
  }

  function changeCustomer(next: DemoCustomerMode) {
    codeRequestId.current += 1;
    setCheckingCode(false);
    setCustomerMode(next);
    setAppliedCode(null);
    setCodeError(null);
  }

  if (view === 'checkout') {
    return (
      <CheckoutView
        menu={menu}
        cart={cart}
        view={offersView}
        offsets={offsets}
        loading={loading}
        error={error}
        canCheckout={canCheckout}
        onBack={() => setView('menu')}
        onPlaceOrder={() => void placeOrder()}
      />
    );
  }

  if (view === 'confirmation' && confirmation) {
    return (
      <ConfirmationView
        confirmation={confirmation}
        currency={evaluation?.priceBreakdown.currency ?? 'INR'}
        onBack={startOver}
      />
    );
  }

  const categories = [...new Set(menu.map(item => item.category))];
  const configProblem = !coreReady
    ? `Core mode is missing ${bootstrap?.missingConfig.join(', ') || 'configuration'}. The storefront will not fall back silently.`
    : null;

  return (
    <div className="app-shell">
      <header className="topbar" inert={cartOpen}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">🫓</div>
          <div>
            <div className="brand-name">Chole Bhature Co.</div>
            <p className="brand-sub">Incentives demo · no real payment</p>
          </div>
        </div>
        <div className="top-actions">
          <span
            className={`demo-badge ${mode}`}
            title={mode === 'core'
              ? 'Orders are evaluated and redeemed through the incentives API'
              : 'Orders are evaluated by the bundled local evaluator'}
          >
            {modeLabel(mode)}
          </span>
          <select
            className="customer-select"
            aria-label="Demo customer"
            title={customers.find(customer => customer.mode === customerMode)?.description}
            value={customerMode}
            onChange={event => changeCustomer(event.target.value as DemoCustomerMode)}
          >
            {customers.map(customer => (
              <option key={customer.mode} value={customer.mode}>
                {customer.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="page" inert={cartOpen}>
        <section className="hero">
          <div>
            <div className="hero-chips">
              <span className="hero-chip">🪔 Today’s feast</span>
              <span className="hero-chip mode-chip">{modeLabel(mode)}</span>
            </div>
            <h1>Big plates.<br />Bigger savings.</h1>
            <p>
              {mode === 'core'
                ? 'Every cart is evaluated by the incentives API: one auto-apply offer wins, a code replaces auto offers, and budgets are enforced before checkout.'
                : 'The local evaluator mirrors the incentives API rules: one auto-apply offer wins and a code replaces auto offers. Set DEMO_MODE=core to evaluate against the real API.'}
            </p>
          </div>
          <div className="hero-offer">
            <strong>Up to 20% off</strong>
            <span>on ₹499+ (max ₹150).<br />Free delivery when it wins.</span>
          </div>
        </section>

        {configProblem && <div className="error-banner config-banner">{configProblem}</div>}
        {!checkoutEnabled && (
          <div className="error-banner config-banner">
            Checkout is disabled for this deployment.
          </div>
        )}

        <div className="layout">
          <main className="menu">
            {categories.map(category => {
              const items = menu.filter(item => item.category === category);
              return (
                <section className="menu-section" key={category}>
                  <div className="section-title">
                    <h2>{category}</h2>
                    <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
                  </div>
                  <div className="menu-grid">
                    {items.map(item => (
                      <MenuCard
                        key={item.id}
                        item={item}
                        quantity={cart[item.id] ?? 0}
                        onAdd={() => add(item.id)}
                        onRemove={() => remove(item.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </main>

          <CartPanel
            cart={cart}
            menu={menu}
            view={offersView}
            offsets={offsets}
            loading={loading}
            error={error}
            codeInput={codeInput}
            codeError={codeError}
            appliedCode={appliedCode}
            checkingCode={checkingCode}
            canCheckout={canCheckout}
            onCodeInput={setCodeInput}
            onApplyCode={() => void applyCode()}
            onClearCode={() => { setAppliedCode(null); setCodeError(null); }}
            onAdd={add}
            onRemove={remove}
            onCheckout={() => setView('checkout')}
            onStartOver={startOver}
          />
        </div>
      </div>

      {count > 0 && (
        <div className="mobile-cart-bar" inert={cartOpen}>
          <div>
            <strong>{count} {count === 1 ? 'item' : 'items'} · {formatINR(total)}</strong>
            <span>{discount > 0 ? `You saved ${formatINR(discount)}` : 'Offers update in cart'}</span>
          </div>
          <button ref={cartButtonRef} type="button" onClick={() => setCartOpen(true)}>
            View cart
          </button>
        </div>
      )}

      {cartOpen && (
        <>
          <button
            type="button"
            className="mobile-backdrop open"
            aria-label="Close cart"
            tabIndex={-1}
            onClick={closeCart}
          />
          <CartPanel
            cart={cart}
            menu={menu}
            view={offersView}
            offsets={offsets}
            loading={loading}
            error={error}
            codeInput={codeInput}
            codeError={codeError}
            appliedCode={appliedCode}
            checkingCode={checkingCode}
            canCheckout={canCheckout}
            onCodeInput={setCodeInput}
            onApplyCode={() => void applyCode()}
            onClearCode={() => { setAppliedCode(null); setCodeError(null); }}
            onAdd={add}
            onRemove={remove}
            onCheckout={() => { setCartOpen(false); setView('checkout'); }}
            onStartOver={startOver}
            onClose={closeCart}
          />
        </>
      )}
    </div>
  );
}
