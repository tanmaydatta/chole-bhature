import { useEffect, useMemo, useState } from 'react';
import type { CandidateOffer, EvaluationResponse, RedemptionResponse } from '@incentives/contracts';
import {
  checkoutCart,
  evaluateCart,
  loadBootstrap,
  resetDemo,
  type BootstrapData,
  type CartLineInput,
} from './lib/api.js';
import { formatINR } from './lib/format.js';
import {
  DEMO_CUSTOMERS,
  MENU,
  type DemoCustomerMode,
  type MenuItem,
} from './shared/demo.js';
import './styles.css';

type View = 'menu' | 'checkout' | 'confirmation';

interface Confirmation {
  orderId: string;
  deliveryFeeMinor: number;
  redemption: RedemptionResponse;
}

function cartLines(cart: Record<string, number>): CartLineInput[] {
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

function offerNote(offer: CandidateOffer): string {
  if (offer.qualified) return 'Applied automatically';
  if (offer.programRef === 'vip-15') return 'VIP customers only';
  if (offer.programRef === 'paneer-15') return 'Add Paneer Tikka to unlock';
  if (offer.progress) {
    return `Add ${formatINR(offer.progress.shortfall)} more to unlock`;
  }
  return 'Not available for this cart';
}

function OfferRow({ offer }: { offer: CandidateOffer }) {
  const progress = offer.progress;
  const percent = progress && progress.target > 0
    ? Math.min(100, Math.round((progress.current / progress.target) * 100))
    : 0;

  return (
    <div className="offer">
      <div className="offer-row">
        <span className="offer-name">{offer.name}</span>
        <span className={`offer-status ${offer.qualified ? '' : 'locked'}`}>
          {offer.qualified
            ? offer.estimatedDiscountMinorUnits > 0
              ? `Save ${formatINR(offer.estimatedDiscountMinorUnits)}`
              : 'Applied'
            : 'Locked'}
        </span>
      </div>
      {progress ? (
        <>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="offer-note">{offerNote(offer)}</span>
        </>
      ) : (
        <span className="offer-note">{offerNote(offer)}</span>
      )}
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
            <button type="button" onClick={onAdd} aria-label={`Add one ${item.name}`}>+</button>
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

function CartPanel({
  cart,
  menu,
  evaluation,
  deliveryFee,
  loading,
  error,
  codeInput,
  codeError,
  appliedCode,
  onCodeInput,
  onApplyCode,
  onClearCode,
  onAdd,
  onRemove,
  onCheckout,
  onReset,
  open = false,
}: {
  cart: Record<string, number>;
  menu: MenuItem[];
  evaluation: EvaluationResponse | null;
  deliveryFee: number;
  loading: boolean;
  error: string | null;
  codeInput: string;
  codeError: string | null;
  appliedCode: string | null;
  onCodeInput: (value: string) => void;
  onApplyCode: () => void;
  onClearCode: () => void;
  onAdd: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onCheckout: () => void;
  onReset: () => void;
  open?: boolean;
}) {
  const lines = cartLines(cart);
  const subtotal = evaluation?.priceBreakdown.originalMerchandiseSubtotal ?? cartSubtotal(cart, menu);
  const discount = evaluation?.priceBreakdown.totalDiscount ?? 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  const offers = evaluation?.candidateOffers ?? [];

  return (
    <aside className={`cart-panel${open ? ' open' : ''}`} aria-label="Cart">
      <div className="cart-head">
        <div>
          <h2>Your thali</h2>
          <p>{itemCount(cart)} {itemCount(cart) === 1 ? 'item' : 'items'} · demo checkout</p>
        </div>
        <button className="text-button" type="button" onClick={onReset}>Reset demo</button>
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
            return (
              <div className="cart-line" key={line.itemId}>
                <span className="cart-line-name">{item.emoji} {item.name}</span>
                <span className="cart-line-price">{formatINR(item.priceMinor * line.quantity)}</span>
                <span className="cart-line-meta">{line.quantity} × {formatINR(item.priceMinor)}</span>
                <div className="stepper" aria-label={`${item.name} quantity`}>
                  <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove one ${item.name}`}>−</button>
                  <span>{line.quantity}</span>
                  <button type="button" onClick={() => onAdd(item.id)} aria-label={`Add one ${item.name}`}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="offer-panel">
        <h3 className="offer-panel-title">Offers for this thali</h3>
        <div className="offer-list">
          {loading && <span className="loading-note">Checking offers…</span>}
          {error && <div className="error-banner">{error}</div>}
          {!loading && !error && offers.length === 0 && (
            <span className="offer-note">Add items to see eligible offers.</span>
          )}
          {offers.map(offer => <OfferRow key={offer.programRef} offer={offer} />)}
        </div>

        {appliedCode ? (
          <div className="applied-code">
            <span>Code {appliedCode} applied</span>
            <button type="button" onClick={onClearCode}>Remove</button>
          </div>
        ) : (
          <>
            <div className="code-form" style={{ marginTop: 12 }}>
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
              <button className="code-apply" type="button" onClick={onApplyCode} disabled={loading || codeInput.trim().length === 0}>
                Apply
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
        <>
          <Totals subtotal={subtotal} discount={discount} delivery={deliveryFee} total={total} />
          <button className="primary-button" type="button" onClick={onCheckout} disabled={loading}>
            {loading ? 'Updating…' : `Checkout · ${formatINR(total)}`}
          </button>
        </>
      )}
    </aside>
  );
}

function CheckoutView({
  cart,
  menu,
  evaluation,
  deliveryFee,
  loading,
  error,
  onBack,
  onPlaceOrder,
}: {
  cart: Record<string, number>;
  menu: MenuItem[];
  evaluation: EvaluationResponse | null;
  deliveryFee: number;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onPlaceOrder: () => void;
}) {
  const subtotal = evaluation?.priceBreakdown.originalMerchandiseSubtotal ?? cartSubtotal(cart, menu);
  const discount = evaluation?.priceBreakdown.totalDiscount ?? 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  const lines = cartLines(cart);

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <h1>Review your order</h1>
        <p>This is a product demo. No payment is taken; the platform evaluates the cart, applies the offer, and commits a redemption.</p>

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
          <div className="offer-list">
            {(evaluation?.candidateOffers ?? []).filter(offer => offer.qualified).map(offer => (
              <OfferRow key={offer.programRef} offer={offer} />
            ))}
            {(evaluation?.candidateOffers ?? []).every(offer => !offer.qualified) && (
              <span className="offer-note">No public offer applies yet. You can still place the demo order.</span>
            )}
          </div>
        </div>

        <div className="checkout-section">
          <Totals subtotal={subtotal} discount={discount} delivery={deliveryFee} total={total} />
        </div>

        {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}

        <div className="checkout-actions">
          <button className="primary-button" type="button" onClick={onPlaceOrder} disabled={loading || lines.length === 0}>
            {loading ? 'Placing order…' : `Place demo order · ${formatINR(total)}`}
          </button>
          <button className="ghost-button" type="button" onClick={onBack} disabled={loading}>Back to menu</button>
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
  confirmation: Confirmation;
  currency: string;
  onBack: () => void;
}) {
  const { redemption, deliveryFeeMinor } = confirmation;
  const { priceBreakdown } = redemption;
  const total = priceBreakdown.discountedMerchandiseSubtotal + deliveryFeeMinor;
  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <div className="confirmation-mark" aria-hidden="true">✓</div>
        <h1 style={{ marginTop: 18 }}>Order confirmed</h1>
        <p>Your demo order is placed. The redemption was committed against the evaluation.</p>
        <div className="confirmation-id">Order: {confirmation.orderId}<br />Redemption: {redemption.redemptionId}</div>

        <div className="checkout-section">
          <h2>Savings</h2>
          <Totals
            subtotal={priceBreakdown.originalMerchandiseSubtotal}
            discount={priceBreakdown.totalDiscount}
            delivery={deliveryFeeMinor}
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
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('menu');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const menu = bootstrap?.menu ?? MENU;
  const customers = bootstrap?.customers ?? Object.values(DEMO_CUSTOMERS).map(customer => ({
    mode: customer.mode,
    label: customer.label,
    description: customer.description,
  }));

  const lines = useMemo(() => cartLines(cart), [cart]);
  const cartKey = useMemo(() => JSON.stringify({ lines, customerMode, appliedCode }), [lines, customerMode, appliedCode]);
  const totalItems = itemCount(cart);
  const subtotal = evaluation?.priceBreakdown.originalMerchandiseSubtotal ?? cartSubtotal(cart, menu);
  const discount = evaluation?.priceBreakdown.totalDiscount ?? 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);

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
        coreMode: false,
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
    const selected = evaluation.codeResults.some(
      result => result.normalizedCode === appliedCode && result.outcome === 'selected',
    );
    if (!selected) setAppliedCode(null);
  }, [appliedCode, evaluation]);

  function add(itemId: string) {
    setCart(current => ({ ...current, [itemId]: (current[itemId] ?? 0) + 1 }));
  }

  function remove(itemId: string) {
    setCart(current => {
      const quantity = (current[itemId] ?? 0) - 1;
      const next = { ...current, [itemId]: Math.max(0, quantity) };
      if (next[itemId] === 0) delete next[itemId];
      return next;
    });
  }

  async function applyCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setCodeError(null);
    try {
      const result = await evaluateCart(cartLines(cart), customerMode, [code]);
      const codeResult = result.evaluation.codeResults?.find(candidate => candidate.normalizedCode === code);
      if (codeResult?.outcome === 'selected') {
        setAppliedCode(code);
        setCodeInput('');
      } else if (codeResult?.outcome === 'not_qualified') {
        setCodeError('This code is valid but your customer profile is not eligible.');
      } else {
        setCodeError(`Code ${code} is invalid or does not apply to this cart.`);
      }
    } catch (cause) {
      setCodeError(cause instanceof Error ? cause.message : 'Could not validate that code.');
    }
  }

  async function placeOrder() {
    if (cartLines(cart).length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await checkoutCart(cartLines(cart), customerMode, appliedCode ? [appliedCode] : []);
      setConfirmation(result);
      setView('confirmation');
      setCartOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not place the demo order.');
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    await resetDemo().catch(() => undefined);
    setCart({});
    setAppliedCode(null);
    setCodeInput('');
    setCodeError(null);
    setEvaluation(null);
    setConfirmation(null);
    setView('menu');
    setError(null);
  }

  function changeCustomer(mode: DemoCustomerMode) {
    setCustomerMode(mode);
    setAppliedCode(null);
    setCodeError(null);
  }

  if (view === 'checkout') {
    return (
      <CheckoutView
        cart={cart}
        menu={menu}
        evaluation={evaluation}
        deliveryFee={deliveryFee}
        loading={loading}
        error={error}
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
        onBack={() => {
          setView('menu');
          setConfirmation(null);
          setCart({});
          setAppliedCode(null);
        }}
      />
    );
  }

  const categories = [...new Set(menu.map(item => item.category))];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">🫓</div>
          <div>
            <div className="brand-name">Chole Bhature Co.</div>
            <p className="brand-sub">Incentives demo · no real payment</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="demo-badge">Demo store</span>
          <select
            className="customer-select"
            aria-label="Demo customer"
            value={customerMode}
            onChange={event => changeCustomer(event.target.value as DemoCustomerMode)}
          >
            {customers.map(customer => (
              <option key={customer.mode} value={customer.mode}>{customer.label} — {customer.description}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="page">
        <section className="hero">
          <div>
            <span className="hero-chip">🪔 Today’s feast</span>
            <h1>Big plates.<br />Bigger savings.</h1>
            <p>Add your favourites, watch the offers unlock in the cart, and try a code. The platform evaluates every cart against live promo rules, budgets, and customer targeting.</p>
          </div>
          <div className="hero-offer">
            <strong>20% off</strong>
            <span>on orders above ₹499.<br />Free delivery above ₹199.</span>
          </div>
        </section>

        <div className="layout">
          <main className="menu">
            {categories.map(category => (
              <section className="menu-section" key={category}>
                <div className="section-title">
                  <h2>{category}</h2>
                  <span>{menu.filter(item => item.category === category).length} items</span>
                </div>
                <div className="menu-grid">
                  {menu.filter(item => item.category === category).map(item => (
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
            ))}
          </main>

          <CartPanel
            cart={cart}
            menu={menu}
            evaluation={evaluation}
            deliveryFee={deliveryFee}
            loading={loading}
            error={error}
            codeInput={codeInput}
            codeError={codeError}
            appliedCode={appliedCode}
            onCodeInput={setCodeInput}
            onApplyCode={() => void applyCode()}
            onClearCode={() => setAppliedCode(null)}
            onAdd={add}
            onRemove={remove}
            onCheckout={() => setView('checkout')}
            onReset={() => void reset()}
          />
        </div>
      </div>

      {totalItems > 0 && (
        <div className="mobile-cart-bar">
          <div>
            <strong>{totalItems} {totalItems === 1 ? 'item' : 'items'} · {formatINR(total)}</strong>
            <span>{discount > 0 ? `You saved ${formatINR(discount)}` : 'Offers update in cart'}</span>
          </div>
          <button type="button" onClick={() => setCartOpen(true)}>View cart</button>
        </div>
      )}

      {cartOpen && (
        <>
          <div className="mobile-backdrop open" onClick={() => setCartOpen(false)} aria-hidden="true" />
          <CartPanel
            open
            cart={cart}
            menu={menu}
            evaluation={evaluation}
            deliveryFee={deliveryFee}
            loading={loading}
            error={error}
            codeInput={codeInput}
            codeError={codeError}
            appliedCode={appliedCode}
            onCodeInput={setCodeInput}
            onApplyCode={() => void applyCode()}
            onClearCode={() => setAppliedCode(null)}
            onAdd={add}
            onRemove={remove}
            onCheckout={() => { setCartOpen(false); setView('checkout'); }}
            onReset={() => void reset()}
          />
        </>
      )}
    </div>
  );
}
