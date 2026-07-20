import { describe, expect, test } from 'vitest';

import {
  ApiCredentialCreateInputSchema,
  ApiCredentialCreateResultSchema,
  ApiCredentialViewSchema,
  AuditEntrySchema,
  AuditActorKindSchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
  MerchantActivationRequestSchema,
  MerchantActivationResultSchema,
  MerchantProvisionRequestSchema,
  MerchantProvisionResultSchema,
  OperatorCallContextSchema,
  OperatorEvaluationRequestSchema,
  OperatorPrincipalSchema,
  PermissionKeySchema,
  ProgramLifecycleSchema,
  ProgramPublicationResultSchema,
  ProgramRevisionSchema,
  SchemaDefinitionImpactPreviewSchema,
  SchemaPublicationResultSchema,
} from './index.js';
import {
  canonicalApiCredentialView,
  canonicalAuditEntry,
  canonicalEvaluationRequest,
  canonicalOperatorCallContext,
  canonicalOperatorPrincipal,
  canonicalProgramLifecycle,
  canonicalProgramRevision,
} from '../test-fixtures/documentation-examples.js';
import * as contracts from './index.js';

describe('production operator contracts', () => {
  test('accepts registered permission keys and rejects unregistered keys', () => {
    expect(PermissionKeySchema.safeParse('programs:publish').success).toBe(true);
    expect(PermissionKeySchema.safeParse('programs:delete').success).toBe(false);
    expect(PermissionKeySchema.safeParse('*').success).toBe(false);
  });

  test('parses strict operator principals and trusted call context', () => {
    expect(OperatorPrincipalSchema.parse(canonicalOperatorPrincipal))
      .toEqual(canonicalOperatorPrincipal);
    expect(OperatorCallContextSchema.parse(canonicalOperatorCallContext))
      .toEqual(canonicalOperatorCallContext);
  });

  test('rejects plaintext or unrecognised fields in credential views', () => {
    expect(ApiCredentialViewSchema.parse(canonicalApiCredentialView))
      .toEqual(canonicalApiCredentialView);
    expect(ApiCredentialViewSchema.safeParse({
      ...canonicalApiCredentialView,
      token: 'sk_plaintext-must-never-appear-in-a-view',
    }).success).toBe(false);
    expect(ApiCredentialViewSchema.safeParse({
      ...canonicalApiCredentialView,
      digest: 'sha256-secret-material',
    }).success).toBe(false);
  });

  test('defines strict canonical merchant provisioning and activation RPC contracts', () => {
    const provision = {
      id: 'merchant-123',
      name: 'Example merchant',
      provisioningId: 'provisioning-123',
    } as const;
    const provisioningResult = {
      ...provision,
      status: 'provisioning',
      createdAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    } as const;
    const activation = {
      id: provision.id,
      provisioningId: provision.provisioningId,
    } as const;
    const activationResult = {
      ...provisioningResult,
      status: 'active',
      updatedAt: '2026-07-20T12:01:00.000Z',
    } as const;

    expect(MerchantProvisionRequestSchema.parse(provision)).toEqual(provision);
    expect(MerchantProvisionResultSchema.parse(provisioningResult))
      .toEqual(provisioningResult);
    expect(MerchantActivationRequestSchema.parse(activation)).toEqual(activation);
    expect(MerchantActivationResultSchema.parse(activationResult)).toEqual(activationResult);
    expect(MerchantProvisionRequestSchema.safeParse({
      ...provision,
      status: 'active',
    }).success).toBe(false);
    expect(MerchantActivationRequestSchema.safeParse({
      ...activation,
      differentProvisioningId: 'forged',
    }).success).toBe(false);
    expect(MerchantActivationResultSchema.safeParse({
      ...activationResult,
      status: 'provisioning',
    }).success).toBe(false);
  });

  test('defines strict session-authenticated Identity operator RPC contracts', () => {
    const task6 = contracts as unknown as Record<string, {
      safeParse(value: unknown): { success: boolean };
      parse(value: unknown): unknown;
    }>;
    const provisionRequest = {
      sessionId: 'session-root',
      selectedMerchantId: 'merchant-123',
      input: {
        provisioningId: 'provisioning-123',
        merchantId: 'merchant-123',
        name: 'Example merchant',
        correlationId: 'corr-provision',
      },
    };
    const invitationRequest = {
      sessionId: 'session-admin',
      selectedMerchantId: 'merchant-123',
      input: {
        organizationId: 'org-123',
        email: 'new-admin@example.test',
        role: 'admin',
        expiresInSeconds: 3_600,
        correlationId: 'corr-invite',
      },
    };
    const safeFailure = {
      error: {
        code: 'FORBIDDEN',
        message: 'Operation is not permitted',
        correlationId: 'corr-invite',
        retryable: false,
      },
    };

    expect(task6.IdentityProvisionClientRequestSchema.parse(provisionRequest))
      .toEqual(provisionRequest);
    expect(task6.IdentityCreateInvitationRequestSchema.parse(invitationRequest))
      .toEqual(invitationRequest);
    expect(task6.IdentityCreateInvitationRequestSchema.safeParse({
      ...invitationRequest,
      principal: canonicalOperatorPrincipal,
    }).success).toBe(false);
    expect(task6.IdentityProvisionClientRequestSchema.safeParse({
      ...provisionRequest,
      selectedMerchantId: undefined,
    }).success).toBe(false);
    expect(task6.IdentityRpcErrorSchema.parse(safeFailure)).toEqual(safeFailure);
    expect(task6.IdentityRpcErrorSchema.safeParse({
      ...safeFailure,
      organizationId: 'org-secret',
    }).success).toBe(false);
    const preOrganizationFailure = {
      provisioningId: 'provisioning-123',
      merchantId: 'merchant-123',
      organizationId: null,
      name: 'Example merchant',
      status: 'failed',
      failedStep: 'core_provision',
      retryable: true,
    };
    expect(task6.ClientProvisioningViewSchema.parse(preOrganizationFailure))
      .toEqual(preOrganizationFailure);
    expect(task6.ClientProvisioningViewSchema.safeParse({
      ...preOrganizationFailure,
      organizationId: '',
    }).success).toBe(false);
  });

  test('defines typed Core provisioning result envelopes with stable retryability', () => {
    const task6 = contracts as unknown as Record<string, {
      safeParse(value: unknown): { success: boolean };
      parse(value: unknown): unknown;
    }>;
    const success = {
      ok: true,
      value: {
        id: 'merchant-123',
        name: 'Example merchant',
        provisioningId: 'provisioning-123',
        status: 'provisioning',
        createdAt: '2026-07-20T12:00:00.000Z',
        updatedAt: '2026-07-20T12:00:00.000Z',
      },
    };
    const conflict = {
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Merchant provisioning identity conflicts',
        retryable: false,
      },
    };

    expect(task6.CoreMerchantProvisionResultSchema.parse(success)).toEqual(success);
    expect(task6.CoreMerchantActivationResultSchema.parse({
      ...success,
      value: { ...success.value, status: 'active' },
    })).toMatchObject({ ok: true, value: { status: 'active' } });
    expect(task6.CoreMerchantProvisionResultSchema.parse(conflict)).toEqual(conflict);
    expect(task6.CoreMerchantActivationResultSchema.parse(conflict)).toEqual(conflict);
    expect(task6.CoreMerchantProvisionResultSchema.safeParse({
      ...conflict,
      error: { ...conflict.error, merchantId: 'tenant-secret' },
    }).success).toBe(false);
  });

  test('includes anonymous authentication attempts in the canonical audit actor kinds', () => {
    expect(AuditActorKindSchema.safeParse('anonymous').success).toBe(true);
  });

  test('defines strict canonical credential create/show-once RPC contracts and quotas', () => {
    const publishableInput = {
      name: 'Browser checkout',
      environment: 'production',
      kind: 'publishable',
      scopes: ['schema:read', 'evaluations:write'],
      allowedOrigins: ['https://shop.example'],
      requestsPerMinute: 120,
    } as const;
    const parsedInput = ApiCredentialCreateInputSchema.parse(publishableInput);
    expect(parsedInput).toEqual(publishableInput);
    expect(ApiCredentialCreateInputSchema.parse({
      ...publishableInput,
      requestsPerMinute: undefined,
    })).toMatchObject({ requestsPerMinute: 60 });
    expect(ApiCredentialCreateInputSchema.safeParse({
      ...publishableInput,
      requestsPerMinute: 0,
    }).success).toBe(false);
    expect(ApiCredentialCreateInputSchema.safeParse({
      ...publishableInput,
      requestsPerMinute: 10_001,
    }).success).toBe(false);
    expect(ApiCredentialCreateInputSchema.safeParse({
      name: 'Server key',
      environment: 'production',
      kind: 'secret',
      scopes: ['customers:write'],
      requestsPerMinute: 60,
    }).success).toBe(false);

    const showOnce = {
      credential: {
        ...canonicalApiCredentialView,
        kind: 'publishable',
        scopes: ['schema:read'],
        allowedOrigins: ['https://shop.example'],
        requestsPerMinute: 120,
      },
      token: 'pk_abcdefghijklmnopqrstuvwxyzABCDEFGH12345678',
    } as const;
    expect(ApiCredentialCreateResultSchema.parse(showOnce)).toEqual(showOnce);
    expect(ApiCredentialCreateResultSchema.safeParse({
      ...showOnce,
      token: showOnce.token.replace(/^pk_/u, 'sk_'),
    }).success).toBe(false);
    expect(ApiCredentialCreateResultSchema.safeParse({
      ...showOnce,
      digest: 'forbidden-private-state',
    }).success).toBe(false);
  });

  test('requires a positive program revision on every decision', () => {
    const decision = {
      programRef: 'welcome-10',
      programRevision: 1,
      programType: 'promo',
      outcome: 'qualified',
      effects: [],
      reasonCodes: [],
      commitRequired: true,
    } as const;

    expect(IncentiveDecisionSchema.safeParse(decision).success).toBe(true);
    const { programRevision: _revision, ...missingRevision } = decision;
    expect(IncentiveDecisionSchema.safeParse(missingRevision).success).toBe(false);
    expect(IncentiveDecisionSchema.safeParse({
      ...decision,
      programRevision: 0,
    }).success).toBe(false);
  });

  test('keeps public input distinct from private operator envelopes', () => {
    expect(EvaluationRequestSchema.safeParse({
      ...canonicalEvaluationRequest,
      operatorContext: canonicalOperatorCallContext,
    }).success).toBe(false);
    expect(OperatorEvaluationRequestSchema.parse({
      operatorContext: canonicalOperatorCallContext,
      request: canonicalEvaluationRequest,
    })).toEqual({
      operatorContext: canonicalOperatorCallContext,
      request: canonicalEvaluationRequest,
    });
  });

  test('parses revision, lifecycle, and safe audit views', () => {
    expect(ProgramRevisionSchema.parse(canonicalProgramRevision))
      .toEqual(canonicalProgramRevision);
    expect(ProgramLifecycleSchema.parse(canonicalProgramLifecycle))
      .toEqual(canonicalProgramLifecycle);
    expect(AuditEntrySchema.parse(canonicalAuditEntry)).toEqual(canonicalAuditEntry);
    expect(AuditEntrySchema.safeParse({
      ...canonicalAuditEntry,
      metadata: { request: { cart: canonicalEvaluationRequest.cart } },
    }).success).toBe(false);
  });

  test('rejects a revision whose configuration belongs to another program', () => {
    expect(ProgramRevisionSchema.safeParse({
      ...canonicalProgramRevision,
      programRef: 'another-program',
    }).success).toBe(false);
  });

  test('defines strict private schema and program lifecycle response contracts', () => {
    const impact = {
      publishedVersions: [1],
      referencedProgramRefs: ['welcome-10'],
      storedCustomerCount: 4,
      incompatibleCustomerCount: 1,
      warnings: [{
        code: 'REQUIRED_LIVE_FIELD',
        message: 'Required live field context.channel may break existing integrations',
      }],
    } as const;
    expect(SchemaDefinitionImpactPreviewSchema.parse(impact)).toEqual(impact);
    expect(SchemaDefinitionImpactPreviewSchema.safeParse({
      ...impact,
      browserAuthority: true,
    }).success).toBe(false);

    const schemaPublication = {
      version: 2,
      publishedAt: '2026-07-20T12:00:00.000Z',
      definitions: [],
      jsonSchema: {},
      sample: {},
      warnings: [{
        code: 'ENUM_VALUE_ADDED',
        message: 'Enum field context.channel added values: store',
      }],
    } as const;
    expect(SchemaPublicationResultSchema.parse(schemaPublication)).toEqual(schemaPublication);
    expect(SchemaPublicationResultSchema.safeParse({
      ...schemaPublication,
      unsafeDraft: {},
    }).success).toBe(false);

    const programPublication = {
      ...canonicalProgramLifecycle,
      warnings: [{
        code: 'OVERLAPPING_REWARD_RULES',
        message: 'Reward rule fallback overlaps an earlier rule',
      }],
    } as const;
    expect(ProgramPublicationResultSchema.parse(programPublication)).toEqual(programPublication);
    expect(ProgramPublicationResultSchema.safeParse({
      ...programPublication,
      credential: 'sk_forbidden',
    }).success).toBe(false);
  });
});
