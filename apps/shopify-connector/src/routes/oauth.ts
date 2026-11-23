import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { timingSafeEqual } from '@incentives/shopify-connector';
import type { Env } from '../env.js';
import { provisionStore } from '../services/store-provisioning.js';

const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
const SHOPIFY_DEFAULT_SCOPES = 'read_orders,write_discounts,read_customers,write_customers';

export async function computeShopifyHmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyShopifyOAuthHmac(
  queryParams: Record<string, string>,
  secret: string,
): Promise<boolean> {
  const hmac = queryParams['hmac'];
  if (!hmac) return false;

  const sortedKeys = Object.keys(queryParams)
    .filter(k => k !== 'hmac' && k !== 'signature')
    .sort();
  const message = sortedKeys.map(k => `${k}=${queryParams[k]}`).join('&');
  const expectedHmac = await computeShopifyHmacHex(secret, message);
  return timingSafeEqual(hmac.toLowerCase(), expectedHmac.toLowerCase());
}

export function generateOAuthNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const oauthRoutes = new Hono<{ Bindings: Env }>();

oauthRoutes.get('/shopify', async c => {
  const shop = c.req.query('shop');
  if (!shop || !SHOPIFY_DOMAIN_REGEX.test(shop)) {
    return c.text('Missing or invalid shop parameter', 400);
  }

  const clientId = c.env.SHOPIFY_CLIENT_ID;
  const appUrl = c.env.SHOPIFY_APP_URL || new URL(c.req.url).origin;
  const redirectUri = `${appUrl}/auth/callback`;
  const state = generateOAuthNonce();

  setCookie(c, 'shopify_oauth_state', state, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 600,
  });

  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', SHOPIFY_DEFAULT_SCOPES);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  return c.redirect(authorizeUrl.toString(), 302);
});

oauthRoutes.get('/callback', async c => {
  const query = c.req.query();
  const shop = query['shop'];
  const code = query['code'];
  const state = query['state'];
  const hmac = query['hmac'];

  if (!shop || !code || !hmac || !state) {
    return c.text('Missing required query parameters', 400);
  }

  if (!SHOPIFY_DOMAIN_REGEX.test(shop)) {
    return c.text('Missing or invalid shop parameter', 400);
  }

  // Verify Shopify HMAC
  const hmacValid = await verifyShopifyOAuthHmac(query, c.env.SHOPIFY_CLIENT_SECRET);
  if (!hmacValid) {
    return c.text('Invalid HMAC signature', 401);
  }

  // Verify OAuth state cookie (CSRF protection)
  const cookieState = getCookie(c, 'shopify_oauth_state');
  if (!cookieState || !timingSafeEqual(cookieState, state)) {
    return c.text('Invalid state parameter', 403);
  }

  // Exchange authorization code for permanent access token
  const tokenUrl = `https://${shop}/admin/oauth/access_token`;
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.SHOPIFY_CLIENT_ID,
      client_secret: c.env.SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    return c.text(`Shopify token exchange failed: ${errorText}`, 502);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return c.text('Shopify token exchange returned no access token', 502);
  }

  // Execute automated store provisioning workflow
  try {
    await provisionStore(c.env, {
      shop,
      accessToken,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed';
    const appUrl = c.env.SHOPIFY_APP_URL || new URL(c.req.url).origin;
    return c.redirect(
      `${appUrl.replace(/\/$/u, '')}/onboarding?shop=${encodeURIComponent(shop)}&status=error&message=${encodeURIComponent(message)}`,
      302,
    );
  }

  // Clear state cookie and redirect to the connector's onboarding page.
  setCookie(c, 'shopify_oauth_state', '', {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 0,
  });

  const appUrl = c.env.SHOPIFY_APP_URL || new URL(c.req.url).origin;
  return c.redirect(
    `${appUrl.replace(/\/$/u, '')}/onboarding?shop=${encodeURIComponent(shop)}`,
    302,
  );
});
