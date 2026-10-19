export const authTableNames = [
  'user',
  'session',
  'account',
  'verification',
  'passkey',
  'rateLimit',
  'auth_profile',
  'root_recovery_code',
  'recovery_flow',
  'recovery_rate_limit',
  'identity_audit',
  'local_email_capture',
  'client_provisionings',
  'organizations',
  'memberships',
  'invitations',
  'e2e_control_runs',
  'e2e_control_requests',
  'e2e_control_cleanup',
  'e2e_control_write_guards',
  'e2e_control_accounts',
] as const;

export type FixedRole = 'admin' | 'operator' | 'viewer';

export interface OrganizationRow {
  id: string;
  merchantId: string;
  provisioningId: string;
  name: string;
  status: 'provisioning' | 'active';
  e2eControlRunId?: string | null;
}

export interface MembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  role: FixedRole;
  status: 'active' | 'removed';
}

export type AuthTableName = typeof authTableNames[number];

export interface AuthProfileRow {
  userId: string;
  subjectKind: 'employee' | 'root';
  status: 'pending' | 'active' | 'disabled';
  emailLoginEnabled: boolean;
}

export interface IdentitySessionPrimitive {
  id: string;
  userId: string;
  token: string;
  expiresAt: number;
  authenticationMethod: AuthenticationMethod;
  authenticatedAt: number;
  recoveryOnly: boolean;
}

/** Control identities remain in the ledger after the business rows are disposed. */
export interface E2eControlAccountRow {
  runId: string;
  slug: string;
  userId: string;
  membershipId: string;
  sessionId: string | null;
  generation: string;
  role: FixedRole;
  state: 'reserved' | 'issuing' | 'issued' | 'revoked';
}

export type AuthenticationMethod = 'magic-link' | 'passkey' | 'recovery';

export interface RootRecoveryCodeRow {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: number;
  usedAt: number | null;
  recoveryFlowId: string | null;
}

export interface RecoveryFlowRow {
  id: string;
  userId: string;
  grantHash: string;
  initiatingCodeHash: string;
  createdAt: number;
  expiresAt: number;
  exchangedAt: number | null;
  sessionId: string | null;
  passkeyRegisteredAt: number | null;
  replacementPasskeyId: string | null;
  completedAt: number | null;
  rotationId: string | null;
  cancelledAt: number | null;
  cancelReason: string | null;
}

export interface RecoveryRateLimitRow {
  keyHash: string;
  windowStartedAt: number;
  attemptCount: number;
}
