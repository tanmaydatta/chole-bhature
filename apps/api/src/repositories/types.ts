import type {
  ApiCredentialKind,
  ApiCredentialScope,
  ApiCredentialView,
  AuditEntry,
  CodeEvaluationResult,
  CustomerSnapshot,
  DeploymentEnvironment,
  Effect,
  EvaluationRequest,
  IncentiveDecision,
  MerchantActivationRequest,
  MerchantActivationResult,
  MerchantProvisionRequest,
  MerchantProvisionResult,
  PromoProgram,
  ProgramLifecycle,
  ProgramStatus,
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
  countIncompatibleCustomers(
    merchantId: string,
    definition: VariableDefinition,
  ): Promise<number>;
  listDeprecatedKeys(merchantId: string): Promise<Set<string>>;
  deprecateDefinition(input: SchemaDefinitionDeprecation): Promise<void>;
}

export type MerchantProvision = MerchantProvisionRequest & { createdAt?: string };
export type MerchantStatus = 'provisioning' | 'active';
export interface MerchantRecord {
  id: string;
  name: string;
  status: MerchantStatus;
  provisioningId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantRepository {
  provision(input: MerchantProvision): Promise<MerchantProvisionResult>;
  get(id: string): Promise<MerchantRecord | null>;
  activate(
    input: MerchantActivationRequest,
    updatedAt: string,
  ): Promise<MerchantActivationResult>;
}

export interface CredentialCreate {
  id: string;
  merchantId: string;
  name: string;
  environment: DeploymentEnvironment;
  kind: ApiCredentialKind;
  scopes: ApiCredentialScope[];
  allowedOrigins?: string[];
  requestsPerMinute?: number;
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
  consumePublishableRateLimit(
    credentialId: string,
    requestsPerMinute: number,
    windowStartedAt: number,
  ): Promise<boolean>;
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
  upsertWithAudit(input: CustomerUpsert, audit: AuditEntry): Promise<CustomerRecord>;
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
  revision: number;
  activeRevision?: number;
  draftRevision?: number;
  usageCount: number;
  budgetRemaining?: number;
  committedSpend: number;
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
  committedSpend: number;
}

export interface ProgramRepository {
  create(input: ProgramCreate): Promise<ProgramRecord>;
  get(merchantId: string, externalRef: string): Promise<ProgramRecord | null>;
  getActive(merchantId: string, externalRef: string): Promise<ProgramRecord | null>;
  list(merchantId: string): Promise<ProgramRecord[]>;
  listActive(merchantId: string): Promise<ProgramRecord[]>;
  updateDraft(input: ProgramUpdate): Promise<ProgramRecord>;
  publishDraft(input: {
    merchantId: string;
    externalRef: string;
    expectedDraftRevision: number;
    status: Exclude<ProgramStatus, 'draft'>;
    publishedAt: string;
    publishedBy: string;
  }): Promise<ProgramRecord>;
  updateLifecycle(input: {
    merchantId: string;
    externalRef: string;
    expectedStatus: ProgramStatus;
    status: Exclude<ProgramStatus, 'draft'>;
    updatedAt: string;
  }): Promise<ProgramLifecycle>;
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
  mode: EvaluationMode;
  submittedCodes: string[];
  codeResults: CodeEvaluationResult[];
  requestDigest: string;
  correlationId: string;
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

export type EvaluationMode = 'automatic' | 'coded';

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

export interface RedemptionEntryRecord {
  position: number;
  programRef: string;
  programRevision: number;
  rewardRuleRef?: string;
  effects: Effect[];
  discountMinorUnits: number;
  currency: string;
}

export interface RedemptionBundleCreate {
  redemptionId: string;
  merchantId: string;
  evaluationId: string;
  externalOrderRef: string;
  idempotencyKey: string;
  requestDigest: string;
  result: RedemptionResponse;
  entries: RedemptionEntryRecord[];
  createdAt: string;
  receiptIntegrityHash: string;
}

export type RedemptionCreate = RedemptionBundleCreate;

export interface AtomicRedemptionCommit extends RedemptionBundleCreate {
  programId: string;
  programRef: string;
  expectedActiveRevision: number;
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
  create(input: RedemptionBundleCreate): Promise<void>;
  commitAtomically(input: AtomicRedemptionCommit): Promise<boolean>;
  getByExternalOrderRef(
    merchantId: string,
    externalOrderRef: string,
    verifyIntegrity: RedemptionReceiptIntegrityVerifier,
  ): Promise<RedemptionBundleCreate | null>;
  getByIdempotencyKey(
    merchantId: string,
    idempotencyKey: string,
    verifyIntegrity: RedemptionReceiptIntegrityVerifier,
  ): Promise<RedemptionBundleCreate | null>;
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
