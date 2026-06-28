export type Origin = 'user' | 'dynamic' | 'system';
export type VarType = 'string' | 'number' | 'boolean' | 'enum' | 'date';
export interface Variable { name: string; type: VarType; origin: Origin; enumValues?: string[]; defaultMessage?: string; readOnly?: boolean; }
export type Operator = 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'between'|'is';
export interface Condition { id: string; variable: string; operator: Operator; value: string | string[]; message?: string; }
export interface ConditionGroup { match: 'ALL' | 'ANY'; conditions: Condition[]; groups?: ConditionGroup[]; }
export type ProgramType = 'promo' | 'affiliate' | 'referral' | 'loyalty';
export type Status = 'draft' | 'scheduled' | 'active' | 'paused' | 'ended';
export interface Reward { kind: 'percent'|'fixed'|'free_shipping'|'points'|'credit'; value?: number; }
export interface EventField { name: string; type: VarType; required: boolean; }
export interface EventDef { name: string; description: string; live: boolean; usedIn: number; fields: EventField[]; sample: Record<string, string>; }
export interface Program {
  id: string; name: string; type: ProgramType; status: Status;
  rewardSummary: string; redemptions: number;
  [k: string]: unknown;
}
export const TYPE_META: Record<ProgramType, { label: string; color: string; bg: string; icon: string }> = {
  promo:     { label: 'Promo',     color: '#2563eb', bg: '#e8f0fe', icon: '◷' },
  affiliate: { label: 'Affiliate', color: '#7c3aed', bg: '#f1ebfe', icon: '⊞' },
  referral:  { label: 'Referral',  color: '#0891b2', bg: '#e2f5fa', icon: '⇄' },
  loyalty:   { label: 'Loyalty',   color: '#d97706', bg: '#fdf0dc', icon: '★' },
};
