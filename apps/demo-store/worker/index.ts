import { Hono } from 'hono';
import { z } from 'zod';
import {
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  type EvaluationResponse,
  type RedemptionResponse,
} from '@incentives/contracts';
import {
  DEMO_CUSTOMERS,
  DEMO_CODE_HINTS,
  MAX_LINE_QUANTITY,
  MENU,
  InvalidCartError,
  cartFromItems,
  deliveryFeeMinor,
  evaluateDemo,
  requestFor,
  type DemoCustomer,
  type DemoCustomerMode,
} from '../src/shared/demo.js';

export interface DemoEnv {
  DEMO_MODE?: string;
  DEMO_CORE_URL?: string;
  CORE_PUBLISHABLE_KEY?: string;
  CORE_SECRET_KEY?: string;
  DEMO_CHECKOUT_ENABLED?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

type FetchImpl = typeof fetch;

export interface DemoDeps {
  fetchImpl?: FetchImpl;
}

interface CoreConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

interface Settings {
  mode: 'core' | 'local';
  config?: CoreConfig;
  missing: string[];
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const itemsSchema = z.array(z.object({
  itemId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
}).strict()).min(1).max(MENU.length);

const cartRequestSchema = z.object({
  items: itemsSchema,
  customerMode: z.enum(['new', 'regular', 'vip']),
  codes: z.array(z.string().min(1).max(128)).max(5).optional(),
}).strict();

const evaluateSchema = cartRequestSchema;
const checkoutSchema = cartRequestSchema.extend({
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();

function settingsFor(env: DemoEnv): Settings {
  if (env.DEMO_MODE !== 'core') {
    return { mode: 'local', missing: [] };
  }
  const missing: string[] = [];
  const url = env.DEMO_CORE_URL?.trim().replace(/\/+$/u, '');
  if (!url) {
    missing.push('DEMO_CORE_URL');
  } else {
    try {
      new URL(url);
    } catch {
      missing.push('DEMO_CORE_URL (invalid URL)');
    }
  }
  if (!env.CORE_PUBLISHABLE_KEY) missing.push('CORE_PUBLISHABLE_KEY');
  if (!env.CORE_SECRET_KEY) missing.push('CORE_SECRET_KEY');
  if (missing.length > 0 || !url) return { mode: 'core', missing };
  return {
    mode: 'core',
    missing: [],
    config: {
      url,
      publishableKey: env.CORE_PUBLISHABLE_KEY ?? '',
      secretKey: env.CORE_SECRET_KEY ?? '',
    },
  };
}

async function corePost(
  config: CoreConfig,
  path: string,
  key: string,
  body: unknown,
  fetchImpl: FetchImpl,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    console.error('demo_store_core_unreachable', {
      path,
      message: cause instanceof Error ? cause.message : 'unknown',
    });
    throw new HttpError(502, 'CORE_UNAVAILABLE', 'The incentives API is unreachable');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('demo_store_core_error', {
      path,
      status: response.status,
      detail: detail.slice(0, 500),
    });
    throw new HttpError(502, 'CORE_REQUEST_FAILED', 'The incentives API rejected the request');
  }

  try {
    return await response.json() as unknown;
  } catch {
    throw new HttpError(502, 'CORE_INVALID_RESPONSE', 'The incentives API returned invalid JSON');
  }
}

function parseCoreResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error('demo_store_core_contract_mismatch', {
      code,
      issues: parsed.error.issues.slice(0, 5),
    });
    throw new HttpError(502, 'CORE_INVALID_RESPONSE', 'The incentives API response did not match the contract');
  }
  return parsed.data;
}

interface Evaluated {
  evaluation: EvaluationResponse;
  deliveryFeeMinor: number;
  mode: 'core' | 'local';
}

async function evaluateRequest(
  env: DemoEnv,
  body: z.infer<typeof evaluateSchema>,
  customer: DemoCustomer,
  fetchImpl: FetchImpl,
): Promise<Evaluated> {
  let cart;
  try {
    cart = cartFromItems(body.items);
  } catch (cause) {
    if (cause instanceof InvalidCartError) {
      throw new HttpError(400, 'INVALID_CART', cause.message);
    }
    throw cause;
  }

  const settings = settingsFor(env);
  if (settings.mode === 'local') {
    const evaluation = parseCoreResponse(
      EvaluationResponseSchema,
      evaluateDemo({ cart, customer, codes: body.codes ?? [] }),
      'local_evaluation',
    );
    return {
      evaluation,
      deliveryFeeMinor: deliveryFeeMinor(evaluation),
      mode: 'local',
    };
  }

  if (!settings.config) {
    throw new HttpError(
      503,
      'CORE_NOT_CONFIGURED',
      `Core mode is missing: ${settings.missing.join(', ')}`,
    );
  }

  const response = await corePost(
    settings.config,
    '/v1/evaluate',
    settings.config.publishableKey,
    requestFor(cart, customer, body.codes ?? []),
    fetchImpl,
  );
  const evaluation = parseCoreResponse(
    EvaluationResponseSchema,
    response,
    'core_evaluation',
  );
  return {
    evaluation,
    deliveryFeeMinor: deliveryFeeMinor(evaluation),
    mode: 'core',
  };
}

function localRedemption(
  evaluation: EvaluationResponse,
  externalOrderRef: string,
  idempotencyKey: string,
): RedemptionResponse {
  return parseCoreResponse(
    RedemptionResponseSchema,
    {
      redemptionId: `demo_redemption_${crypto.randomUUID()}`,
      evaluationId: evaluation.evaluationId,
      externalOrderRef,
      status: 'committed',
      entries: evaluation.decisions
        .filter(decision => decision.outcome === 'qualified' && decision.commitRequired)
        .map(decision => ({
          programRef: decision.programRef,
          programRevision: decision.programRevision,
          effects: decision.effects,
          ...(decision.rewardRuleRef === undefined
            ? {}
            : { rewardRuleRef: decision.rewardRuleRef }),
        })),
      priceBreakdown: evaluation.priceBreakdown,
      idempotencyKey,
    },
    'local_redemption',
  );
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be valid JSON');
  }
}

export function createDemoApp(deps: DemoDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const app = new Hono<{ Bindings: DemoEnv }>();

  app.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json({ error: error.code, message: error.message }, error.status);
    }
    console.error('demo_store_unhandled_error', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return context.json({ error: 'INTERNAL_ERROR' }, 500);
  });

  app.get('/api/health', context => {
    const settings = settingsFor(context.env);
    return context.json({
      status: 'ok',
      service: 'incentives-demo-store',
      mode: settings.mode,
      coreReady: settings.mode === 'local' || settings.config !== undefined,
    });
  });

  app.get('/api/bootstrap', context => {
    const settings = settingsFor(context.env);
    return context.json({
      menu: MENU,
      customers: Object.values(DEMO_CUSTOMERS).map(customer => ({
        mode: customer.mode,
        label: customer.label,
        description: customer.description,
      })),
      codeHints: DEMO_CODE_HINTS,
      currency: 'INR',
      mode: settings.mode,
      coreReady: settings.mode === 'local' || settings.config !== undefined,
      missingConfig: settings.missing,
      checkoutEnabled: context.env.DEMO_CHECKOUT_ENABLED !== 'false',
    });
  });

  app.post('/api/evaluate', async context => {
    const parsed = evaluateSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Request body did not match the demo contract');
    }
    const customer = DEMO_CUSTOMERS[parsed.data.customerMode as DemoCustomerMode];
    if (!customer) throw new HttpError(400, 'INVALID_REQUEST', 'Unknown customer mode');
    const result = await evaluateRequest(context.env, parsed.data, customer, fetchImpl);
    return context.json(result);
  });

  app.post('/api/checkout', async context => {
    if (context.env.DEMO_CHECKOUT_ENABLED === 'false') {
      throw new HttpError(403, 'CHECKOUT_DISABLED', 'Checkout is disabled for this deployment');
    }
    const parsed = checkoutSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Request body did not match the demo contract');
    }
    const customer = DEMO_CUSTOMERS[parsed.data.customerMode as DemoCustomerMode];
    if (!customer) throw new HttpError(400, 'INVALID_REQUEST', 'Unknown customer mode');

    const { evaluation, deliveryFeeMinor: fee, mode } = await evaluateRequest(
      context.env,
      parsed.data,
      customer,
      fetchImpl,
    );
    const orderId = `demo_order_${crypto.randomUUID()}`;
    const idempotencyKey = parsed.data.idempotencyKey ?? `demo_key_${crypto.randomUUID()}`;

    let redemption: RedemptionResponse;
    if (mode === 'core') {
      const settings = settingsFor(context.env);
      if (!settings.config) {
        throw new HttpError(503, 'CORE_NOT_CONFIGURED', 'Core mode is not configured');
      }
      const response = await corePost(
        settings.config,
        '/v1/redemptions',
        settings.config.secretKey,
        {
          evaluationId: evaluation.evaluationId,
          externalOrderRef: orderId,
          idempotencyKey,
        },
        fetchImpl,
      );
      redemption = parseCoreResponse(
        RedemptionResponseSchema,
        response,
        'core_redemption',
      );
    } else {
      redemption = localRedemption(evaluation, orderId, idempotencyKey);
    }

    return context.json({ orderId, deliveryFeeMinor: fee, mode, redemption });
  });

  app.get('*', context => {
    if (context.env.ASSETS) return context.env.ASSETS.fetch(context.req.raw);
    return context.text(
      'Demo store UI is not built. Run `pnpm --filter @incentives/demo-store build`.',
      404,
    );
  });

  return app;
}

const app = createDemoApp();

export default {
  fetch(request: Request, env: DemoEnv, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
