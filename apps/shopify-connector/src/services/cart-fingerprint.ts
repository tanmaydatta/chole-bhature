import type { Cart } from '@incentives/contracts';

const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Canonical fingerprint of the cart data the evaluation was based on.
 *
 * The Discount Function recomputes the same fingerprint from its authoritative
 * `cart.lines` input. Any quantity, product, variant, line-price, subtotal, or
 * currency change makes the signature invalid.
 */
export async function computeCartFingerprint(cart: Cart): Promise<string> {
  const lines = [...cart.items]
    .map(line => ({
      lineRef: line.lineRef,
      productRef: line.productRef,
      variantRef: line.variantRef ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }))
    .sort((left, right) => left.lineRef.localeCompare(right.lineRef));

  const canonical = JSON.stringify({
    currency: cart.currency,
    subtotal: cart.subtotal,
    lines,
  });
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)));
}
