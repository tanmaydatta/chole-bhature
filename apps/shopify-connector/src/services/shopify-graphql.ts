export interface ShopifyGraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphQL<T = unknown>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  apiVersion = '2026-07',
): Promise<ShopifyGraphQLResult<T>> {
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify GraphQL HTTP error ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as ShopifyGraphQLResult<T>;
  if (payload.errors && payload.errors.length > 0) {
    const messages = payload.errors.map(error => error.message).join('; ');
    throw new Error(`Shopify GraphQL execution error: ${messages}`);
  }
  return payload;
}

export function assertNoUserErrors(
  mutationName: string,
  result: { data?: Record<string, unknown> },
): void {
  const mutationResult = result.data?.[mutationName] as
    | { userErrors?: Array<{ field?: string[]; message: string; code?: string }> }
    | undefined;

  const userErrors = mutationResult?.userErrors;
  if (userErrors && Array.isArray(userErrors) && userErrors.length > 0) {
    const details = userErrors
      .map(error => `${error.field?.join('.') ?? 'general'}: ${error.message}`)
      .join(', ');
    throw new Error(`Shopify ${mutationName} userErrors: ${details}`);
  }
}

export function userErrorCodes(
  mutationName: string,
  result: { data?: Record<string, unknown> },
): string[] {
  const mutationResult = result.data?.[mutationName] as
    | { userErrors?: Array<{ code?: string; message: string }> }
    | undefined;
  return (mutationResult?.userErrors ?? []).map(error => error.code ?? error.message);
}
