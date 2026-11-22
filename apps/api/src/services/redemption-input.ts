import { RedemptionRequestSchema, type RedemptionRequest } from '@incentives/contracts';
import { z } from 'zod';

export interface RedemptionCommitInput {
  merchantId: string;
  input: RedemptionRequest;
}

/**
 * Service-binding callers pass `{ merchantId, ...RedemptionRequest }`.
 * RedemptionRequestSchema is strict, so merchantId must be removed before parsing.
 */
export function parseRedemptionCommitInput(value: unknown): RedemptionCommitInput {
  const { merchantId, ...redemption } = value as RedemptionRequest & { merchantId?: unknown };
  return {
    merchantId: z.string().min(1).parse(merchantId),
    input: RedemptionRequestSchema.parse(redemption),
  };
}
