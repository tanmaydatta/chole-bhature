import { create } from 'zustand';
import { PROGRAMS } from './programs';
import type { Program, ProgramType } from '../lib/types';

interface ProgramState {
  programs: Program[];
  addProgram(p: Program): void;
  updateProgram(id: string, patch: Partial<Program>): void;
  setReferralPriority(orderedIds: string[]): void;
  byType(type: ProgramType): Program[];
}

export const useProgramStore = create<ProgramState>()((set, get) => ({
  programs: PROGRAMS.map(p => ({ ...p })),
  addProgram(p) {
    set(state => ({ programs: [...state.programs, p] }));
  },
  updateProgram(id, patch) {
    set(state => ({
      programs: state.programs.map(prog =>
        prog.id === id ? { ...prog, ...patch } : prog
      ),
    }));
  },
  setReferralPriority(orderedIds) {
    set(state => ({
      programs: state.programs.map(prog => {
        const idx = orderedIds.indexOf(prog.id);
        return idx !== -1 ? { ...prog, priority: idx + 1 } : prog;
      }),
    }));
  },
  byType(type) {
    return get().programs.filter(p => p.type === type);
  },
}));
