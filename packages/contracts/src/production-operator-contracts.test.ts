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
  ProgramRevisionSchema,
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
});
