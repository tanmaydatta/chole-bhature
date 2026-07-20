export const authTableNames = [
  'user',
  'session',
  'account',
  'verification',
  'passkey',
  'rateLimit',
  'auth_profile',
  'root_recovery_code',
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
}

export interface RootRecoveryCodeRow {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: number;
  usedAt: number | null;
}
