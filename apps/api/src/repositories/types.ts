import type {
  CustomerSnapshot,
  EvaluationRequest,
  IncentiveDecision,
  PromoProgram,
  RedemptionResponse,
  VariableDefinition,
} from '@incentives/contracts';

export type SchemaState = 'draft' | 'published';

export interface VariableDefinitionCreate {
  id: string;
  merchantId: string;
  schemaVersion: number;
  state: SchemaState;
  definition: VariableDefinition;
  createdAt?: string;
}

export interface VariableDefinitionRecord extends Required<VariableDefinitionCreate> {}

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
    nextDefinitions: VariableDefinition[],
  ): Promise<VariableDefinitionRecord>;
  deleteDraftDefinition(
    merchantId: string,
    id: string,
    schemaVersion: number,
    expectedDefinitions: VariableDefinition[],
    nextDefinitions: VariableDefinition[],
  ): Promise<void>;
  getVersion(merchantId: string, version: number): Promise<SchemaVersionRecord | null>;
  getLatestVersion(merchantId: string, state: SchemaState): Promise<SchemaVersionRecord | null>;
  publishDraft(
    merchantId: string,
    version: number,
    definitions: VariableDefinition[],
    publishedAt: string,
  ): Promise<SchemaVersionRecord>;
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
  createdAt?: string;
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

export interface ProgramRepository {
  create(input: ProgramCreate): Promise<ProgramRecord>;
  get(merchantId: string, externalRef: string): Promise<ProgramRecord | null>;
  listReferencedVariableKeys(merchantId: string): Promise<Set<string>>;
}

export interface EvaluationDecisionRecord {
  evaluationId: string;
  merchantId: string;
  customerRef?: string;
  customerVersion?: number;
  schemaVersion: number;
  request: EvaluationRequest;
  decisions: IncentiveDecision[];
  integrityHash: string;
  expiresAt: string;
  createdAt: string;
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
}

export interface RedemptionRepository {
  create(input: RedemptionCreate): Promise<void>;
  getByExternalOrderRef(
    merchantId: string,
    externalOrderRef: string,
  ): Promise<RedemptionCreate | null>;
  getByIdempotencyKey(
    merchantId: string,
    idempotencyKey: string,
  ): Promise<RedemptionCreate | null>;
}

export interface Repositories {
  schemas: SchemaRepository;
  customers: CustomerRepository;
  programs: ProgramRepository;
  decisions: DecisionRepository;
  redemptions: RedemptionRepository;
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
