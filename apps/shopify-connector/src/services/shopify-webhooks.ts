import {
  assertNoUserErrors,
  shopifyGraphQL,
} from './shopify-graphql.js';

interface WebhookSubscriptionNode {
  id: string;
  topic: string;
  uri?: string;
}

interface WebhookSubscriptionList {
  webhookSubscriptions: {
    nodes: WebhookSubscriptionNode[];
  };
}

interface WebhookSubscriptionCreate {
  webhookSubscriptionCreate: {
    webhookSubscription?: { id: string };
    userErrors: Array<{ field?: string[]; message: string; code?: string }>;
  };
}

const SHOPIFY_WEBHOOKS: ReadonlyArray<{
  topic: string;
  path: string;
  required: boolean;
}> = [
  { topic: 'ORDERS_PAID', path: '/webhooks/orders-paid', required: true },
  { topic: 'ORDERS_CANCELLED', path: '/webhooks/orders-cancelled', required: true },
  { topic: 'REFUNDS_CREATE', path: '/webhooks/refunds-create', required: true },
  { topic: 'CUSTOMERS_CREATE', path: '/webhooks/customers-update', required: false },
  { topic: 'CUSTOMERS_UPDATE', path: '/webhooks/customers-update', required: false },
  { topic: 'APP_UNINSTALLED', path: '/webhooks/app-uninstalled', required: true },
];

export interface WebhookRegistrationResult {
  registered: string[];
  skipped: string[];
  warnings: string[];
}

export async function ensureShopifyWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string,
  apiVersion = '2026-07',
): Promise<WebhookRegistrationResult> {
  const listed = await shopifyGraphQL<WebhookSubscriptionList>(
    shop,
    accessToken,
    `query WebhookSubscriptions {
      webhookSubscriptions(first: 100) {
        nodes {
          id
          topic
          uri
        }
      }
    }`,
    {},
    apiVersion,
  );

  const existing = new Map(
    (listed.data?.webhookSubscriptions.nodes ?? []).map(node => [
      `${node.topic}:${node.uri ?? ''}`,
      node,
    ]),
  );

  const registered: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const webhook of SHOPIFY_WEBHOOKS) {
    const callbackUrl = `${appUrl.replace(/\/$/u, '')}${webhook.path}`;
    if (existing.has(`${webhook.topic}:${callbackUrl}`)) {
      skipped.push(webhook.topic);
      continue;
    }

    try {
      const result = await shopifyGraphQL<WebhookSubscriptionCreate>(
        shop,
        accessToken,
        `mutation RegisterWebhook(
          $topic: WebhookSubscriptionTopic!
          $webhookSubscription: WebhookSubscriptionInput!
        ) {
          webhookSubscriptionCreate(
            topic: $topic
            webhookSubscription: $webhookSubscription
          ) {
            webhookSubscription { id }
            userErrors { field message code }
          }
        }`,
        {
          topic: webhook.topic,
          webhookSubscription: {
            uri: callbackUrl,
            format: 'JSON',
          },
        },
        apiVersion,
      );
      assertNoUserErrors(
        'webhookSubscriptionCreate',
        result as unknown as { data?: Record<string, unknown> },
      );
      registered.push(webhook.topic);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const alreadyExists = /already|taken/iu.test(message);
      if (alreadyExists) {
        skipped.push(webhook.topic);
        continue;
      }
      if (webhook.required) throw error;
      warnings.push(`${webhook.topic}: ${message}`);
    }
  }

  return { registered, skipped, warnings };
}
