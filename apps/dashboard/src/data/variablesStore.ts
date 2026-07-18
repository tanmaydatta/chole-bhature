import { create } from 'zustand';
import type { Variable } from '../lib/types';
import { VARIABLES } from './variables';

interface VariablesState {
  variables: Variable[];
  addVariable: (v: Variable) => void;
  updateVariable: (name: string, patch: Partial<Variable>) => void;
}

export const useVariablesStore = create<VariablesState>((set) => ({
  variables: VARIABLES.map(v => ({ ...v })),
  addVariable: (v) => set((s) => ({ variables: [...s.variables, v] })),
  updateVariable: (name, patch) => set((s) => ({
    variables: s.variables.map(v => (v.name === name ? { ...v, ...patch } : v)),
  })),
}));
