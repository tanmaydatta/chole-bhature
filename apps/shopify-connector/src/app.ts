import { Hono } from 'hono';
import type { Env } from './env.js';
import { oauthRoutes } from './routes/oauth.js';
import { webhookRoutes } from './routes/webhooks.js';

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  // Mount OAuth routes under /auth
  app.route('/auth', oauthRoutes);

  // Mount Webhook routes under /webhooks
  app.route('/webhooks', webhookRoutes);

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
