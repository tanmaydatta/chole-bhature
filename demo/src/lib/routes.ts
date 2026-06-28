import type { ProgramType } from './types';

const TYPE_TO_SEGMENT: Record<ProgramType, string> = {
  promo: 'promo',
  affiliate: 'affiliates',
  referral: 'referrals',
  loyalty: 'loyalty',
};

export function typeToSegment(type: ProgramType): string {
  return TYPE_TO_SEGMENT[type];
}
