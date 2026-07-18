import type {
  Effect,
  EvaluationRequest,
  IncentiveDecision,
  ProgramType,
  VariableDefinition,
} from '@incentives/contracts';
import type { FactSet } from '@incentives/engine';

export interface ModuleEvaluationContext {
  readonly merchantId: string;
  readonly evaluationId: string;
  readonly now: Date;
  readonly request: EvaluationRequest;
  readonly facts: FactSet;
  readonly definitions: readonly VariableDefinition[];
}

export interface ModuleDecision extends IncentiveDecision {
  priority: number;
  stackable: boolean;
  stackingGroup?: string;
}

export interface CommitContext {
  readonly merchantId: string;
  readonly evaluationId: string;
  readonly now: Date;
}

export type CommitEffect = Effect;

export interface CommerceEvent<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
}

export type FulfilmentEffect = Effect;

export interface IncentiveModule<TConfig> {
  readonly type: ProgramType;
  evaluate(
    context: ModuleEvaluationContext,
    config: TConfig,
  ): Promise<ModuleDecision[]>;
  commit?(
    context: CommitContext,
    decision: ModuleDecision,
  ): Promise<CommitEffect[]>;
  handleEvent?(
    event: CommerceEvent,
    config: TConfig,
  ): Promise<FulfilmentEffect[]>;
}
