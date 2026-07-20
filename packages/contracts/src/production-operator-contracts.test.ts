import { describe, expect, test } from 'vitest';

import {
  ApiCredentialViewSchema,
  AuditEntrySchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
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
