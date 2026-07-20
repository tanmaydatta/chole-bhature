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
] as const;

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
