import { ApiCredentialCreateInputSchema } from './credentials.js';
import { CustomerPatchRequestSchema } from './runtime-api.js';
import {
  ClientProvisioningViewSchema,
  FixedOperatorRoleSchema,
  InvitationViewSchema,
  OperatorMemberViewSchema,
  OperatorPrincipalSchema,
} from './operator.js';
import { ProgramLifecycleSchema, PromoProgramSchema } from './programs.js';
import { VariableDefinitionSchema } from './variables.js';
import { z } from './zod.js';

export const OperatorSessionViewSchema = OperatorPrincipalSchema.omit({
  sessionId: true,
}).extend({
  merchantSelectionRequired: z.boolean(),
}).strict();

export const OperatorMerchantSelectionRequestSchema = z.object({
  merchantId: z.string().min(1).max(200),
}).strict();

export const OperatorClientProvisionRequestSchema = z.object({
  name: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u),
}).strict();

export const OperatorInvitationCreateRequestSchema = z.object({
  email: z.email(),
  role: FixedOperatorRoleSchema,
  expiresInSeconds: z.number().int().positive().max(604_800).default(86_400),
}).strict();

export const OperatorInvitationAcceptRequestSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  email: z.email(),
}).strict();

export const OperatorMemberRoleRequestSchema = z.object({
  role: FixedOperatorRoleSchema,
}).strict();

export const OperatorCredentialCreateRequestSchema = ApiCredentialCreateInputSchema;
export const OperatorSchemaDefinitionRequestSchema = VariableDefinitionSchema;
export const OperatorCustomerPatchRequestSchema = CustomerPatchRequestSchema;
export const OperatorProgramDraftRequestSchema = PromoProgramSchema;

export const OperatorProgramViewSchema = z.object({
  configuration: PromoProgramSchema,
  lifecycle: ProgramLifecycleSchema,
}).strict().superRefine((view, context) => {
  if (view.configuration.id !== view.lifecycle.programRef) {
    context.addIssue({
      code: 'custom',
      path: ['lifecycle', 'programRef'],
      message: 'configuration id must match lifecycle programRef',
    });
  }
  if (
    view.lifecycle.draftRevision !== undefined
    && view.configuration.status !== 'draft'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['configuration', 'status'],
      message: 'the working configuration must be draft while draftRevision is present',
    });
  }
  if (
    view.lifecycle.draftRevision === undefined
    && view.configuration.status !== view.lifecycle.status
  ) {
    context.addIssue({
      code: 'custom',
      path: ['configuration', 'status'],
      message: 'configuration status must match lifecycle without a draft revision',
    });
  }
  if (
    view.lifecycle.activeRevision !== undefined
    && view.lifecycle.draftRevision !== undefined
    && view.lifecycle.draftRevision !== view.lifecycle.activeRevision + 1
  ) {
    context.addIssue({
      code: 'custom',
      path: ['lifecycle', 'draftRevision'],
      message: 'draft revision must immediately follow active revision',
    });
  }
  if (view.lifecycle.status === 'draft') {
    if (view.lifecycle.activeRevision !== undefined) context.addIssue({
      code: 'custom',
      path: ['lifecycle', 'activeRevision'],
      message: 'draft lifecycle cannot have an active revision',
    });
    if (view.lifecycle.draftRevision === undefined) context.addIssue({
      code: 'custom',
      path: ['lifecycle', 'draftRevision'],
      message: 'draft lifecycle requires a draft revision',
    });
    if (view.lifecycle.draftRevision !== undefined && view.lifecycle.draftRevision !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['lifecycle', 'draftRevision'],
        message: 'draft-only lifecycle must begin at revision 1',
      });
    }
  } else if (view.lifecycle.activeRevision === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['lifecycle', 'activeRevision'],
      message: 'published lifecycle requires an active revision',
    });
  }
});

export const OperatorProgramListResponseSchema = z.object({
  programs: z.array(OperatorProgramViewSchema),
}).strict();

export const IdentityMembersResponseSchema = z.object({
  members: z.array(OperatorMemberViewSchema),
}).strict();

export const IdentityInvitationsResponseSchema = z.object({
  invitations: z.array(InvitationViewSchema),
}).strict();

export const IdentityClientsResponseSchema = z.object({
  clients: z.array(ClientProvisioningViewSchema),
}).strict();

export const OperatorTeamResponseSchema = z.object({
  members: z.array(OperatorMemberViewSchema),
  invitations: z.array(InvitationViewSchema),
}).strict();

export type OperatorSessionView = z.infer<typeof OperatorSessionViewSchema>;
export type OperatorMerchantSelectionRequest = z.infer<
  typeof OperatorMerchantSelectionRequestSchema
>;
export type OperatorClientProvisionRequest = z.infer<typeof OperatorClientProvisionRequestSchema>;
export type OperatorInvitationCreateRequest = z.infer<
  typeof OperatorInvitationCreateRequestSchema
>;
export type OperatorInvitationAcceptRequest = z.infer<
  typeof OperatorInvitationAcceptRequestSchema
>;
export type OperatorMemberRoleRequest = z.infer<typeof OperatorMemberRoleRequestSchema>;
export type OperatorCredentialCreateRequest = z.infer<
  typeof OperatorCredentialCreateRequestSchema
>;
export type OperatorSchemaDefinitionRequest = z.infer<
  typeof OperatorSchemaDefinitionRequestSchema
>;
export type OperatorCustomerPatchRequest = z.infer<typeof OperatorCustomerPatchRequestSchema>;
export type OperatorProgramDraftRequest = z.infer<typeof OperatorProgramDraftRequestSchema>;
export type OperatorProgramView = z.infer<typeof OperatorProgramViewSchema>;
export type OperatorProgramListResponse = z.infer<typeof OperatorProgramListResponseSchema>;
export type IdentityMembersResponse = z.infer<typeof IdentityMembersResponseSchema>;
export type IdentityInvitationsResponse = z.infer<typeof IdentityInvitationsResponseSchema>;
export type IdentityClientsResponse = z.infer<typeof IdentityClientsResponseSchema>;
export type OperatorTeamResponse = z.infer<typeof OperatorTeamResponseSchema>;
