import type { VariableDefinition } from '@incentives/contracts';

import type { SchemaRepository } from './types.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type UpdateArguments = [
  merchantId: string,
  id: string,
  schemaVersion: number,
  definition: VariableDefinition,
  expectedDefinitions: VariableDefinition[],
];

type DeleteArguments = [
  merchantId: string,
  id: string,
  schemaVersion: number,
  expectedDefinitions: VariableDefinition[],
];

type UpdateHasNoCallerControlledNextSnapshot = Expect<Equal<
  Parameters<SchemaRepository['updateDraftDefinition']>,
  UpdateArguments
>>;

type DeleteHasNoCallerControlledNextSnapshot = Expect<Equal<
  Parameters<SchemaRepository['deleteDraftDefinition']>,
  DeleteArguments
>>;

export type SchemaRepositoryMutationContract = [
  UpdateHasNoCallerControlledNextSnapshot,
  DeleteHasNoCallerControlledNextSnapshot,
];
