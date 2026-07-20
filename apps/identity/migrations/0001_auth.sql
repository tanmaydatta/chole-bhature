PRAGMA foreign_keys = ON;

-- Better Auth core schema. This database is Identity-owned and is never shared
-- with Product D1.
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER,
  "updatedAt" INTEGER
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE "passkey" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL UNIQUE,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" INTEGER,
  "aaguid" TEXT
);
CREATE INDEX "passkey_userId_idx" ON "passkey" ("userId");

CREATE TABLE "rateLimit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);

-- Server-owned login policy. Task 6 will add invitations, organizations,
-- memberships and roles without widening the public signup surface.
CREATE TABLE "auth_profile" (
  "user_id" TEXT PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "subject_kind" TEXT NOT NULL CHECK ("subject_kind" IN ('employee', 'root')),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('pending', 'active', 'disabled')),
  "email_login_enabled" INTEGER NOT NULL DEFAULT 1 CHECK ("email_login_enabled" IN (0, 1)),
  CHECK (("subject_kind" = 'root' AND "email_login_enabled" = 0) OR "subject_kind" = 'employee')
);

CREATE TABLE "root_recovery_code" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "code_hash" TEXT NOT NULL UNIQUE,
  "created_at" INTEGER NOT NULL,
  "used_at" INTEGER
);
CREATE INDEX "root_recovery_code_user_idx" ON "root_recovery_code" ("user_id");

CREATE TABLE "identity_audit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "occurred_at" INTEGER NOT NULL,
  "actor_kind" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('succeeded', 'failed', 'denied')),
  "correlation_id" TEXT NOT NULL,
  "metadata_json" TEXT
);
CREATE INDEX "identity_audit_correlation_idx" ON "identity_audit" ("correlation_id");

-- Used only by the local-capture adapter. Staging uses Resend and never writes
-- message secrets here.
CREATE TABLE "local_email_capture" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "text_body" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL
);
