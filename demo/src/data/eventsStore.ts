import { create } from 'zustand';
import type { EventDef } from '../lib/types';
import { EVENTS } from './events';

interface EventsState {
  events: EventDef[];
  addEvent: (e: EventDef) => void;
  updateEvent: (name: string, patch: Partial<EventDef>) => void;
}

export const useEventsStore = create<EventsState>((set) => ({
  events: EVENTS.map(e => ({ ...e })),
  addEvent: (e) => set((s) => ({ events: [...s.events, e] })),
  updateEvent: (name, patch) => set((s) => ({
    events: s.events.map(e => (e.name === name ? { ...e, ...patch } : e)),
  })),
}));
