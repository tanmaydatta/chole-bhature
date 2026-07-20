import {
  OperatorCallContextSchema,
  type OperatorCallContext,
  type PermissionKey,
} from '@incentives/contracts';

import { ForbiddenError } from '../errors.js';

export function requireOperatorContext(
  input: OperatorCallContext,
  permission: PermissionKey,
): OperatorCallContext {
  const context = OperatorCallContextSchema.parse(input);
  if (context.permission !== permission) throw new ForbiddenError();
  return context;
}
