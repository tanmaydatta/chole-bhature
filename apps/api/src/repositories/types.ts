import type {
  ApiCredentialKind,
  ApiCredentialScope,
  ApiCredentialView,
  AuditEntry,
  CustomerSnapshot,
  DeploymentEnvironment,
  EvaluationRequest,
  IncentiveDecision,
  PromoProgram,
  ProgramRevision,
  RedemptionResponse,
  VariableDefinition,
} from '@incentives/contracts';

export type SchemaState = 'draft' | 'published';
export type DefinitionState = SchemaState | 'deprecated';

export interface VariableDefinitionCreate {
  id: string;
  merchantId: string;
  schemaVersion: number;
  state: SchemaState;
  definition: VariableDefinition;
  createdAt?: string;
}

type VariableDefinitionRecordBase = Omit<Required<VariableDefinitionCreate>, 'state'>;

export type VariableDefinitionRecord = VariableDefinitionRecordBase & (
  | { state: SchemaState; deprecatedAt?: never; deprecatedBy?: never }
  | { state: 'deprecated'; deprecatedAt: string; deprecatedBy: string }
);

export interface SchemaDefinitionImpact {
  publishedVersions: number[];
  referencedProgramRefs: string[];
  storedCustomerCount: number;
}

export interface SchemaDefinitionDeprecation {
  merchantId: string;
  id: string;
  schemaVersion: number;
  deprecatedAt: string;
  deprecatedBy: string;
}

export interface SchemaVersionRecord {
  merchantId: string;
  version: number;
  state: SchemaState;
  publishedAt?: string;
  definitions: VariableDefinition[];
}

export interface SchemaRepository {
  listDefinitions(merchantId: string, schemaVersion: number): Promise<VariableDefinitionRecord[]>;
  getDefinition(merchantId: string, id: string): Promise<VariableDefinitionRecord | null>;
  createNextDraft(merchantId: string): Promise<SchemaVersionRecord>;
  createDraftDefinition(
    input: VariableDefinitionCreate,
    expectedDefinitions: VariableDefinition[],
    nextDefinitions: VariableDefinition[],
  ): Promise<VariableDefinitionRecord>;
  updateDraftDefinition(
    merchantId: string,
    id: string,
    schemaVersion: number,
    definition: VariableDefinition,
    expectedDefinitions: VariableDefinition[],
  ): Promise<VariableDefinitionRecord>;
  deleteDraftDefinition(
    merchantId: string,
    id: string,
    schemaVersion: number,
    expectedDefinitions: VariableDefinition[],
  ): Promise<void>;
  getVersion(merchantId: string, version: number): Promise<SchemaVersionRecord | null>;
  getLatestVersion(merchantId: string, state: SchemaState): Promise<SchemaVersionRecord | null>;
  publishDraft(
    merchantId: string,
    version: number,
    definitions: VariableDefinition[],
    publishedAt: string,
  ): Promise<SchemaVersionRecord>;
  getDefinitionImpact(merchantId: string, key: string): Promise<SchemaDefinitionImpact>;
  deprecateDefinition(input: SchemaDefinitionDeprecation): Promise<void>;
}

export type MerchantStatus = 'provisioning' | 'active';

export interface MerchantProvision {
  id: string;
  name: string;
  provisioningId: string;
  createdAt?: string;
}

export interface MerchantRecord {
  id: string;
  name: string;
  status: MerchantStatus;
  provisioningId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantRepository {
  provision(input: MerchantProvision): Promise<MerchantRecord>;
  get(id: string): Promise<MerchantRecord | null>;
  activate(id: string, updatedAt: string): Promise<MerchantRecord | null>;
}

export interface CredentialCreate {
  id: string;
  merchantId: string;
  name: string;
  environment: DeploymentEnvironment;
  kind: ApiCredentialKind;
  scopes: ApiCredentialScope[];
  allowedOrigins?: string[];
  digest: string;
  suffix: string;
  expiresAt?: string;
  createdAt?: string;
  createdBy: string;
}

export interface CredentialAuthenticationRecord {
  credential: ApiCredentialView;
  allowedOrigins: string[];
}

export interface CredentialRepository {
  createWithAudit(input: CredentialCreate, audit: AuditEntry): Promise<ApiCredentialView>;
  findByDigest(digest: string): Promise<ApiCredentialView | null>;
  authenticateByDigest(digest: string): Promise<CredentialAuthenticationRecord | null>;
  hasAllowedPublishableOrigin(
    origin: string,
    scope: ApiCredentialScope,
    checkedAt: string,
  ): Promise<boolean>;
  list(merchantId: string): Promise<ApiCredentialView[]>;
  revokeWithAudit(
    merchantId: string,
    id: string,
    revokedAt: string,
    revokedBy: string,
    audit: AuditEntry,
  ): Promise<ApiCredentialView | null>;
  markUsed(id: string, usedAt: string): Promise<void>;
}

export interface CustomerRecord {
  externalRef: string;
  attributes: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface CustomerUpsert {
  merchantId: string;
  externalRef: string;
  attributes: Record<string, unknown>;
  expectedVersion?: number;
  updatedAt?: string;
}

export interface CustomerRepository {
  create(merchantId: string, customer: CustomerSnapshot): Promise<CustomerRecord>;
  get(merchantId: string, externalRef: string): Promise<CustomerRecord | null>;
  upsert(input: CustomerUpsert): Promise<CustomerRecord>;
}

export interface ProgramCreate {
  merchantId: string;
  program: PromoProgram;
  schema: SchemaVersionRecord | null;
  createdAt?: string;
}

export interface ProgramUpdate {
  merchantId: string;
  externalRef: string;
  program: PromoProgram;
  expectedProgram: PromoProgram;
  expectedUpdatedAt: string;
  schema: SchemaVersionRecord | null;
  updatedAt?: string;
}

export interface ProgramRecord {
  id: string;
  merchantId: string;
  externalRef: string;
  program: PromoProgram;
  usageCount: number;
  budgetRemaining?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramRevisionRecord extends ProgramRevision {
  merchantId: string;
  programId: string;
}

export interface ProgramCounterRecord {
  programId: string;
  merchantId: string;
  maxUses?: number;
  usageCount: number;
  budgetRemaining?: number;
}

export interface ProgramRepository {
  create(input: ProgramCreate): Promise<ProgramRecord>;
  get(merchantId: string, externalRef: string): Promise<ProgramRecord | null>;
  list(merchantId: string): Promise<ProgramRecord[]>;
  updateDraft(input: ProgramUpdate): Promise<ProgramRecord>;
  listReferencedVariableKeys(merchantId: string): Promise<Set<string>>;
  getRevision(
    merchantId: string,
    externalRef: string,
    revision: number,
  ): Promise<ProgramRevisionRecord | null>;
  getCounters(merchantId: string, externalRef: string): Promise<ProgramCounterRecord | null>;
}

export interface EvaluationDecisionRecord {
  evaluationId: string;
  merchantId: string;
  customerRef?: string;
  customerVersion?: number;
  schemaVersion: number;
  request: EvaluationRequest;
  facts: EvaluationFactsSnapshot;
  decisions: IncentiveDecision[];
  integrityHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface EvaluationFactsSnapshot {
  scalar: Record<string, unknown>;
  lineItems: Array<Record<string, unknown>>;
  programs: Array<{
    programRef: string;
    system: Record<string, unknown>;
    config: PromoProgram;
  }>;
}

export interface DecisionRepository {
  create(input: EvaluationDecisionRecord): Promise<void>;
  get(merchantId: string, evaluationId: string): Promise<EvaluationDecisionRecord | null>;
}

export interface RedemptionCreate {
  redemptionId: string;
  merchantId: string;
  externalOrderRef?: string;
  idempotencyKey?: string;
  evaluationId: string;
  result: RedemptionResponse;
  discountMinorUnits: number;
  currency: string;
  createdAt: string;
  receiptIntegrityHash: string;
}

export interface AtomicRedemptionCommit extends RedemptionCreate {
  programId: string;
  programRef: string;
  expectedProgram: PromoProgram;
  customerRef?: string;
  perCustomerCap?: number;
}

export type DecisionIntegrityVerifier = (
  record: EvaluationDecisionRecord,
) => Promise<boolean>;

export type RedemptionReceiptIntegrityVerifier = (
  record: RedemptionCreate,
) => Promise<boolean>;

export interface RedemptionIntegrityVerifiers {
  verifyDecision: DecisionIntegrityVerifier;
  verifyReceipt: RedemptionReceiptIntegrityVerifier;
}

export interface RedemptionRepository {
  create(input: RedemptionCreate): Promise<void>;
  commitAtomically(input: AtomicRedemptionCommit): Promise<boolean>;
  getByExternalOrderRef(
    merchantId: string,
    externalOrderRef: string,
    verifyIntegrity: RedemptionReceiptIntegrityVerifier,
  ): Promise<RedemptionCreate | null>;
  getByIdempotencyKey(
    merchantId: string,
    idempotencyKey: string,
    verifyIntegrity: RedemptionReceiptIntegrityVerifier,
  ): Promise<RedemptionCreate | null>;
  countCommittedForCustomerProgram(
    merchantId: string,
    customerRef: string,
    programRef: string,
    verifyIntegrity: RedemptionIntegrityVerifiers,
  ): Promise<number>;
}

export interface Repositories {
  merchants: MerchantRepository;
  credentials: CredentialRepository;
  schemas: SchemaRepository;
  customers: CustomerRepository;
  programs: ProgramRepository;
  decisions: DecisionRepository;
  redemptions: RedemptionRepository;
  audit: ProductAuditRepository;
}

export interface ProductAuditRepository {
  append(entry: AuditEntry): Promise<void>;
  list(merchantId: string): Promise<AuditEntry[]>;
}

export class OptimisticVersionConflictError extends Error {
  override readonly name = 'OptimisticVersionConflictError';

  constructor() {
    super('The customer version no longer matches');
  }
}

export class SchemaRevisionConflictError extends Error {
  override readonly name = 'SchemaRevisionConflictError';

  constructor() {
    super('The schema draft changed before the operation completed');
  }
}

export class ProgramConflictError extends Error {
  override readonly name = 'ProgramConflictError';

  constructor(message: string) {
    super(message);
  }
}
