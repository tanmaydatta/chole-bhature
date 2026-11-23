import { Hono } from 'hono';
import type { Env } from './env.js';
import { adminRoutes } from './routes/admin.js';
import { oauthRoutes } from './routes/oauth.js';
import { webhookRoutes } from './routes/webhooks.js';
import { evaluateRoutes } from './routes/evaluate.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function onboardingPage(env: Env, shop: string, message?: string): Promise<string> {
  const record = await env.DB.prepare(
    `SELECT status, provisioning_error FROM shopify_installed_shops WHERE shop_domain = ? LIMIT 1`,
  )
    .bind(shop)
    .first<{ status: string; provisioning_error?: string | null }>();

  const status = record?.status ?? 'not_installed';
  const error = record?.provisioning_error ?? message;
  const badge = status === 'active' ? '#008060' : status === 'error' ? '#d72c0d' : '#b98900';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Incentives for Shopify</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 48px 20px; background: #f6f6f7; color: #202223; }
    main { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #e1e3e5; border-radius: 12px; padding: 32px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { line-height: 1.5; color: #5c5f62; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; color: #fff; background: ${badge}; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    code { background: #f1f2f3; padding: 2px 6px; border-radius: 4px; }
    .error { background: #fff4f4; border: 1px solid #f5c6c2; color: #8e1f0b; padding: 12px; border-radius: 8px; margin-top: 20px; white-space: pre-wrap; }
    a { color: #005bd3; }
  </style>
</head>
<body>
  <main>
    <span class="badge">${escapeHtml(status)}</span>
    <h1>Incentives for Shopify</h1>
    <p>Store: <code>${escapeHtml(shop || 'unknown')}</code></p>
    <p>${
      status === 'active'
        ? 'The app is installed and provisioned. Add the checkout extension in the Shopify checkout editor, then manage campaigns from your dashboard.'
        : status === 'error'
          ? 'Provisioning failed. Fix the error below and reinstall the app.'
          : 'Provisioning is in progress. Refresh this page in a few seconds.'
    }</p>
    ${
      error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : ''
    }
    <p><a href="https://${escapeHtml(shop)}/admin/apps/${escapeHtml(env.SHOPIFY_CLIENT_ID)}">Open in Shopify Admin</a></p>
    ${env.OPERATOR_DASHBOARD_URL ? `<p><a href="${escapeHtml(env.OPERATOR_DASHBOARD_URL)}">Open the campaign dashboard</a></p>` : ''}
  </main>
</body>
</html>`;
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/', async c => {
    const shop = c.req.query('shop');
    if (shop && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/u.test(shop)) {
      const record = await c.env.DB.prepare(
        `SELECT status FROM shopify_installed_shops WHERE shop_domain = ? LIMIT 1`,
      )
        .bind(shop)
        .first<{ status: string }>();
      if (record?.status === 'active') {
        return c.redirect(`/onboarding?shop=${encodeURIComponent(shop)}`, 302);
      }
      return c.redirect(`/auth/shopify?shop=${encodeURIComponent(shop)}`, 302);
    }
    return c.html(
      '<!doctype html><title>Incentives</title><p>Incentives Shopify app is running. Install from your Shopify Admin.</p>',
    );
  });

  app.get('/onboarding', async c => {
    const shop = c.req.query('shop') ?? '';
    const message = c.req.query('message');
    if (!shop || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/u.test(shop)) {
      return c.html('<!doctype html><title>Incentives</title><p>Missing or invalid shop parameter.</p>', 400);
    }
    return c.html(await onboardingPage(c.env, shop, message));
  });

  app.get('/dashboard', c => c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Incentives</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 40px 20px; background: #f6f6f7; color: #202223; }
    main { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e1e3e5; border-radius: 12px; padding: 32px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    dl { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; }
    dt { color: #5c5f62; }
    dd { margin: 0; font-weight: 600; }
    .error { background: #fff4f4; border: 1px solid #f5c6c2; color: #8e1f0b; padding: 12px; border-radius: 8px; }
    a { color: #005bd3; }
  </style>
</head>
<body>
  <main>
    <h1>Incentives</h1>
    <p id="status">Connecting to Shopify…</p>
    <div id="content" hidden>
      <dl>
        <dt>Shop</dt><dd id="shop"></dd>
        <dt>Tenant</dt><dd id="tenant"></dd>
        <dt>Status</dt><dd id="install-status"></dd>
      </dl>
      ${c.env.OPERATOR_DASHBOARD_URL ? `<p><a href="${escapeHtml(c.env.OPERATOR_DASHBOARD_URL)}">Open the campaign dashboard</a></p>` : ''}
      <p>Campaign management is available in the operator dashboard. This embedded shell verifies Shopify App Bridge session tokens without cookies.</p>
    </div>
    <p id="error" class="error" hidden></p>
  </main>
  <script>
    (async () => {
      try {
        const token = await shopify.idToken();
        const res = await fetch('/admin/session', {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!res.ok) throw new Error('Session verification failed: HTTP ' + res.status);
        const data = await res.json();
        document.getElementById('shop').textContent = data.shop;
        document.getElementById('tenant').textContent = data.tenantId;
        document.getElementById('install-status').textContent = data.status;
        document.getElementById('status').hidden = true;
        document.getElementById('content').hidden = false;
      } catch (error) {
        document.getElementById('status').hidden = true;
        const errorElement = document.getElementById('error');
        errorElement.textContent = error instanceof Error ? error.message : 'Unable to load the app.';
        errorElement.hidden = false;
      }
    })();
  </script>
</body>
</html>`));

  // Mount Admin Bridge routes under /admin
  app.route('/admin', adminRoutes);

  // Mount OAuth routes under /auth
  app.route('/auth', oauthRoutes);

  // Mount Webhook routes under /webhooks
  app.route('/webhooks', webhookRoutes);

  // Mount storefront evaluation routes under /v1/evaluate and /evaluate
  app.route('/v1/evaluate', evaluateRoutes);
  app.route('/evaluate', evaluateRoutes);

  // Health check
  app.get('/health', c => c.json({ status: 'ok', service: 'shopify-connector' }));

  return app;
}

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
