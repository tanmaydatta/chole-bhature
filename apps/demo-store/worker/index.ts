import { Hono } from 'hono';
import { z } from 'zod';
import {
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  type EvaluationResponse,
  type OperatorCallContext,
  type RedemptionResponse,
} from '@incentives/contracts';
import {
  DEMO_CUSTOMERS,
  DEMO_CODE_HINTS,
  MENU,
  cartFromItems,
  deliveryFeeMinor,
  evaluateDemo,
  requestFor,
  type DemoCustomerMode,
} from '../src/shared/demo.js';

interface CoreBinding {
  evaluate(context: OperatorCallContext, input: unknown): Promise<EvaluationResponse | { error: unknown }>;
  commitRedemption(input: unknown): Promise<RedemptionResponse>;
}

interface Env {
  CORE?: CoreBinding;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  DEMO_TENANT_ID?: string;
  DEMO_USE_CORE?: string;
}

const checkoutSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.number().int().min(1).max(20),
  })).min(1),
  customerMode: z.enum(['new', 'regular', 'vip']),
  codes: z.array(z.string()).max(5).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const evaluateSchema = checkoutSchema.omit({ idempotencyKey: true });

type DemoEnv = { Bindings: Env };

function operatorContext(permission: 'evaluations:run' | 'redemptions:commit'): OperatorCallContext {
  return {
    correlationId: crypto.randomUUID(),
    actorUserId: 'system:demo-store',
    actorKind: 'root',
    merchantId: 'demo_chole_bhature',
    permission,
  };
}

function fallbackRedemption(
  evaluation: EvaluationResponse,
  externalOrderRef: string,
  idempotencyKey: string,
): RedemptionResponse {
  return RedemptionResponseSchema.parse({
    redemptionId: `demo_redemption_${crypto.randomUUID()}`,
    evaluationId: evaluation.evaluationId,
    externalOrderRef,
    status: 'committed',
    entries: evaluation.decisions
      .filter(decision => decision.outcome === 'qualified' && decision.commitRequired)
      .map(decision => ({
        programRef: decision.programRef,
        programRevision: decision.programRevision,
        rewardRuleRef: decision.rewardRuleRef,
        effects: decision.effects,
      })),
    priceBreakdown: evaluation.priceBreakdown,
    idempotencyKey,
  });
}

async function evaluate(
  env: Env,
  body: z.infer<typeof evaluateSchema>,
): Promise<{ evaluation: EvaluationResponse; deliveryFeeMinor: number }> {
  const customer = DEMO_CUSTOMERS[body.customerMode as DemoCustomerMode];
  if (!customer) throw new Error('Unknown demo customer');
  const cart = cartFromItems(body.items);
  const request = requestFor(cart, customer, body.codes ?? []);

  if (env.DEMO_USE_CORE === 'true' && env.CORE?.evaluate) {
    const result = await env.CORE.evaluate(
      { ...operatorContext('evaluations:run'), merchantId: env.DEMO_TENANT_ID ?? 'demo_chole_bhature' },
      request,
    );
    if ('error' in result) {
      throw new Error('Core evaluation failed');
    }
    const evaluation = EvaluationResponseSchema.parse(result);
    return { evaluation, deliveryFeeMinor: deliveryFeeMinor(cart, evaluation) };
  }

  const evaluation = EvaluationResponseSchema.parse(
    evaluateDemo({ cart, customer, codes: body.codes ?? [] }),
  );
  return { evaluation, deliveryFeeMinor: deliveryFeeMinor(cart, evaluation) };
}

export function createDemoApp() {
  const app = new Hono<DemoEnv>();

  app.get('/api/health', c => c.json({ status: 'ok', service: 'incentives-demo-store' }));

  app.get('/api/bootstrap', c => c.json({
    menu: MENU,
    customers: Object.values(DEMO_CUSTOMERS).map(customer => ({
      mode: customer.mode,
      label: customer.label,
      description: customer.description,
    })),
    codeHints: DEMO_CODE_HINTS,
    currency: 'INR',
    coreMode: c.env.DEMO_USE_CORE === 'true',
  }));

  app.post('/api/evaluate', async c => {
    const parsed = evaluateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'INVALID_REQUEST' }, 400);
    try {
      const result = await evaluate(c.env, parsed.data);
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: 'EVALUATION_FAILED', message: error instanceof Error ? error.message : 'Unknown error' },
        502,
      );
    }
  });

  app.post('/api/checkout', async c => {
    const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'INVALID_REQUEST' }, 400);
    try {
      const { evaluation, deliveryFeeMinor: fee } = await evaluate(c.env, parsed.data);
      const orderId = `demo_order_${crypto.randomUUID()}`;
      const idempotencyKey = parsed.data.idempotencyKey ?? `demo_key_${crypto.randomUUID()}`;

      if (c.env.DEMO_USE_CORE === 'true' && c.env.CORE?.commitRedemption) {
        const redemption = await c.env.CORE.commitRedemption({
          merchantId: c.env.DEMO_TENANT_ID ?? 'demo_chole_bhature',
          evaluationId: evaluation.evaluationId,
          externalOrderRef: orderId,
          idempotencyKey,
          postCaptureReconciliation: true,
        });
        return c.json({ orderId, deliveryFeeMinor: fee, redemption });
      }

      const redemption = fallbackRedemption(evaluation, orderId, idempotencyKey);
      return c.json({ orderId, deliveryFeeMinor: fee, redemption });
    } catch (error) {
      return c.json(
        { error: 'CHECKOUT_FAILED', message: error instanceof Error ? error.message : 'Unknown error' },
        502,
      );
    }
  });

  app.post('/api/demo/reset', c => c.json({
    reset: true,
    mode: c.env.DEMO_USE_CORE === 'true' ? 'core' : 'fallback',
    note: 'Fallback mode is stateless. Core mode reset is an operator action.',
  }));

  app.get('*', c => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text('Demo store UI is not built. Run `pnpm --filter @incentives/demo-store build`.', 404);
  });

  return app;
}

const app = createDemoApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
