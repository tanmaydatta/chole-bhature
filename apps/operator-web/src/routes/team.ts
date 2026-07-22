import {
  ApiErrorSchema,
  IdentityInvitationsResponseSchema,
  IdentityMembersResponseSchema,
  InvitationViewSchema,
  MembershipViewSchema,
  OperatorInvitationCreateRequestSchema,
  OperatorMemberRoleRequestSchema,
  OperatorTeamResponseSchema,
} from '@incentives/contracts';

import { EmptyBodySchema, requiredParam, type ProtectedRoute } from './types.js';

function identityRequest(context: Parameters<ProtectedRoute['invoke']>[0]) {
  return {
    sessionId: context.principal.sessionId,
    selectedMerchantId: context.operator.merchantId,
    correlationId: context.correlationId,
  };
}

function organizationId(context: Parameters<ProtectedRoute['invoke']>[0]): string {
  if (!context.principal.organizationId) throw new Error('Organization is unavailable');
  return context.principal.organizationId;
}

function validateOrganization(
  context: Parameters<ProtectedRoute['invoke']>[0],
  organizationIds: readonly string[],
): void {
  const expected = organizationId(context);
  if (organizationIds.some(value => value !== expected)) {
    throw new Error('Team response crossed the organization boundary');
  }
}

export const teamRoutes: readonly ProtectedRoute[] = [
  {
    method: 'GET', pattern: /^\/operator\/v1\/team$/u,
    permission: 'members:read', responseSchema: OperatorTeamResponseSchema,
    downstream: 'identity',
    async invoke(context) {
      const request = identityRequest(context);
      const [members, invitations] = await Promise.all([
        context.env.IDENTITY.listMembers(request),
        context.env.IDENTITY.listInvitations(request),
      ]);
      if (ApiErrorSchema.safeParse(members).success) return members;
      if (ApiErrorSchema.safeParse(invitations).success) return invitations;
      return {
        members: IdentityMembersResponseSchema.parse(members).members,
        invitations: IdentityInvitationsResponseSchema.parse(invitations).invitations,
      };
    },
    validateOutput(value, context) {
      const team = OperatorTeamResponseSchema.parse(value);
      validateOrganization(context, [
        ...team.members.map(item => item.organizationId),
        ...team.invitations.map(item => item.organizationId),
      ]);
    },
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/team\/invitations$/u,
    permission: 'members:manage', bodySchema: OperatorInvitationCreateRequestSchema,
    downstream: 'identity',
    responseSchema: InvitationViewSchema, status: 201,
    invoke(context) {
      const body = OperatorInvitationCreateRequestSchema.parse(context.body);
      return context.env.IDENTITY.createInvitation({
        sessionId: context.principal.sessionId,
        selectedMerchantId: context.operator.merchantId,
        input: {
          organizationId: organizationId(context),
          ...body,
          correlationId: context.correlationId,
        },
      });
    },
    validateOutput(value, context) {
      const invitation = InvitationViewSchema.parse(value);
      validateOrganization(context, [invitation.organizationId]);
    },
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/team\/invitations\/([^/]+)\/retry$/u,
    parameterNames: ['invitationId'], permission: 'members:manage',
    downstream: 'identity',
    bodySchema: EmptyBodySchema, responseSchema: InvitationViewSchema,
    invoke(context) {
      return context.env.IDENTITY.retryInvitation({
        ...identityRequest(context), invitationId: requiredParam(context, 'invitationId'),
      });
    },
    validateOutput(value, context) {
      const invitation = InvitationViewSchema.parse(value);
      validateOrganization(context, [invitation.organizationId]);
      if (invitation.id !== requiredParam(context, 'invitationId')) {
        throw new Error('Invitation response did not match its request');
      }
    },
  },
  {
    method: 'PATCH', pattern: /^\/operator\/v1\/team\/members\/([^/]+)$/u,
    parameterNames: ['membershipId'], permission: 'members:manage',
    downstream: 'identity',
    bodySchema: OperatorMemberRoleRequestSchema, responseSchema: MembershipViewSchema,
    invoke(context) {
      const body = OperatorMemberRoleRequestSchema.parse(context.body);
      return context.env.IDENTITY.changeMemberRole({
        ...identityRequest(context), membershipId: requiredParam(context, 'membershipId'),
        role: body.role,
      });
    },
    validateOutput(value, context) {
      const member = MembershipViewSchema.parse(value);
      validateOrganization(context, [member.organizationId]);
      if (member.id !== requiredParam(context, 'membershipId')) {
        throw new Error('Membership response did not match its request');
      }
    },
  },
  {
    method: 'DELETE', pattern: /^\/operator\/v1\/team\/members\/([^/]+)$/u,
    parameterNames: ['membershipId'], permission: 'members:manage',
    downstream: 'identity',
    responseSchema: MembershipViewSchema,
    invoke(context) {
      return context.env.IDENTITY.removeMember({
        ...identityRequest(context), membershipId: requiredParam(context, 'membershipId'),
      });
    },
    validateOutput(value, context) {
      const member = MembershipViewSchema.parse(value);
      validateOrganization(context, [member.organizationId]);
      if (member.id !== requiredParam(context, 'membershipId')) {
        throw new Error('Membership response did not match its request');
      }
    },
  },
];
