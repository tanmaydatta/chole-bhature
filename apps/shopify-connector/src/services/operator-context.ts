import type { OperatorCallContext, PermissionKey } from '@incentives/contracts';

export function createOperatorContext(
  merchantId: string,
  permission: PermissionKey,
  correlationId: string = crypto.randomUUID(),
  actorUserId = 'system:shopify-connector',
): OperatorCallContext {
  return {
    correlationId,
    actorUserId,
    actorKind: 'root',
    merchantId,
    permission,
  };
}
