export interface StackKeyV1 {
  readonly repository_id: number;
  readonly repository: string;
  readonly pr: number;
  readonly head_sha: string;
  readonly run_id: number;
  readonly attempt: number;
}
export function parseStackKey(value: unknown): StackKeyV1;
export function resourceNames(value: unknown): Record<
  'api' | 'identity' | 'operator' | 'product' | 'auth' | 'accessApi' | 'accessOperator' | 'token', string
>;
