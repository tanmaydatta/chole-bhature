import { createContext } from 'react';
import type { Variable } from '../../lib/types';
import type { BuilderCallbacks } from './rqb-controls';

export interface ConditionBuilderContextValue {
  variables: readonly Variable[];
  callbacks?: BuilderCallbacks;
}

export const ConditionBuilderContext = createContext<ConditionBuilderContextValue>({
  variables: [],
});
