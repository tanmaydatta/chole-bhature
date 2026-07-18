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

export interface SchemaVersionCreate {
  merchantId: string;
  version: number;
  state: SchemaState;
  publishedAt?: string;
  definitions: VariableDefinition[];
}

export interface SchemaVersionRecord extends SchemaVersionCreate {}

export interface SchemaRepository {
  createDefinition(input: VariableDefinitionCreate): Promise<VariableDefinitionRecord>;
  listDefinitions(merchantId: string, schemaVersion: number): Promise<VariableDefinitionRecord[]>;
  createVersion(input: SchemaVersionCreate): Promise<SchemaVersionRecord>;
  getVersion(merchantId: string, version: number): Promise<SchemaVersionRecord | null>;
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
