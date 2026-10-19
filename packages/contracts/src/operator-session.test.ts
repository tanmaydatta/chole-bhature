import { describe, expect, test } from 'vitest';
import * as contracts from './operator.js';
import { OperatorSessionViewSchema } from './operator-bff.js';

const member = {
  userId: 'own-user', sessionId: 'private-session', authenticationMethods: ['magic-link'],
  authenticatedAt: '2026-10-19T12:00:00.000Z', organizationId: 'org-a',
  merchantId: 'merchant-a', membershipId: 'membership-a', permissions: [],
};
const display = {
  user: { name: 'Own Name', email: 'own@example.test' }, role: 'operator',
  client: { merchantId: 'merchant-a', organizationId: 'org-a', name: 'Client A' },
};

describe('private Identity browser session projection', () => {
  test('provides strict display and projection contracts without expanding operation principals', () => {
    expect(contracts.OperatorSessionDisplaySchema).toBeDefined();
    expect(contracts.IdentityBrowserSessionProjectionSchema).toBeDefined();
    expect(contracts.OperatorSessionDisplaySchema.parse(display)).toEqual({
      user: { name: 'Own Name', email: 'own@example.test' }, role: 'operator',
      client: { merchantId: 'merchant-a', organizationId: 'org-a', name: 'Client A' },
    });
    expect(contracts.IdentityBrowserSessionProjectionSchema.parse({ principal: member, display }))
      .toEqual({ principal: member, display });
    expect(contracts.OperatorPrincipalSchema.safeParse({ ...member, display }).success).toBe(false);
  });

  test('accepts all fixed persisted roles without inferring a role from permissions', () => {
    for (const role of ['admin', 'operator', 'viewer']) {
      expect(contracts.IdentityBrowserSessionProjectionSchema.safeParse({
        principal: member, display: { ...display, role, user: { name: null, email: 'own@example.test' } },
      }).success).toBe(true);
    }
    const principal = {
      userId: 'root-user', sessionId: 'root-private', authenticationMethods: ['passkey'],
      authenticatedAt: '2026-10-19T12:00:00.000Z', platformRole: 'root', permissions: [],
    };
    expect(contracts.IdentityBrowserSessionProjectionSchema.safeParse({ principal,
      display: { user: { name: 'ROOT', email: 'root@example.test' }, role: 'root', client: null },
    }).success).toBe(true);
    expect(contracts.IdentityBrowserSessionProjectionSchema.safeParse({
      principal: { ...principal, merchantId: 'merchant-a', organizationId: 'org-a' },
      display: { ...display, role: 'root' },
    }).success).toBe(true);
  });

  test.each([
    { principal: member, display: { ...display, role: 'root' } },
    { principal: { ...member, platformRole: 'root' }, display },
    { principal: member, display: { ...display, client: null } },
    { principal: { ...member, membershipId: undefined }, display },
    { principal: { ...member, organizationId: undefined }, display },
    { principal: { ...member, merchantId: undefined }, display },
    { principal: member, display: { ...display, client: { ...display.client, merchantId: 'foreign' } } },
    { principal: member, display: { ...display, client: { ...display.client, organizationId: 'foreign' } } },
    { principal: { ...member, platformRole: 'root', membershipId: undefined },
      display: { ...display, role: 'root', client: null } },
  ])('rejects a mismatched role or scope: %#', value => {
    expect(contracts.IdentityBrowserSessionProjectionSchema.safeParse(value).success).toBe(false);
  });

  test.each([
    { ...display, token: 'credential' },
    { ...display, user: { ...display.user, userId: 'foreign', sessionId: 'secret' } },
    { ...display, client: { ...display.client, secret: 'credential' } },
    { ...display, user: { ...display.user, email: 'invalid' } },
    { ...display, client: { ...display.client, name: '' } },
    { ...display, role: 'owner' },
  ])('rejects credentials, extra fields and malformed metadata: %#', value => {
    expect(contracts.OperatorSessionDisplaySchema.safeParse(value).success).toBe(false);
  });
});

describe('public operator account display boundary', () => {
  const { sessionId: _privateSession, ...publicMember } = member;
  const session = { ...publicMember, display, merchantSelectionRequired: false };

  test('requires owned display and accepts a strict public member projection', () => {
    expect(OperatorSessionViewSchema.safeParse(session).success).toBe(true);
    expect(OperatorSessionViewSchema.safeParse({ ...publicMember, merchantSelectionRequired: false }).success).toBe(false);
  });

  test.each([
    { ...session, sessionId: 'private-session' },
    { ...session, token: 'credential' },
    { ...session, display: { ...display, user: { ...display.user, token: 'credential' } } },
    { ...session, display: { ...display, role: 'root' } },
    { ...session, display: { ...display, client: { ...display.client, merchantId: 'foreign' } } },
    { ...session, merchantSelectionRequired: true },
    { ...session, display: { ...display, client: null } },
  ])('rejects private fields and inconsistent public scope: %#', value => {
    expect(OperatorSessionViewSchema.safeParse(value).success).toBe(false);
  });

  test('requires selection exactly for ROOT without a selected client', () => {
    const root = { userId: 'root-user', authenticationMethods: ['passkey'],
      authenticatedAt: '2026-10-19T12:00:00.000Z', platformRole: 'root', permissions: [],
      display: { user: { name: 'ROOT', email: 'root@example.test' }, role: 'root', client: null },
      merchantSelectionRequired: true };
    expect(OperatorSessionViewSchema.safeParse(root).success).toBe(true);
    expect(OperatorSessionViewSchema.safeParse({ ...root, merchantSelectionRequired: false }).success).toBe(false);
    const selected = { ...root, merchantId: 'merchant-a', organizationId: 'org-a',
      display: { ...root.display, client: { merchantId: 'merchant-a', organizationId: 'org-a', name: 'Client A' } },
      merchantSelectionRequired: false };
    expect(OperatorSessionViewSchema.safeParse(selected).success).toBe(true);
    expect(OperatorSessionViewSchema.safeParse({ ...selected, merchantSelectionRequired: true }).success).toBe(false);
  });
});
