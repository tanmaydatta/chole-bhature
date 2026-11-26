export interface SeedRequestResult {
  status: number;
  body: unknown;
}

export type SeedRequester = (
  method: string,
  path: string,
  body?: unknown,
  options?: { allowStatuses?: number[] },
) => Promise<SeedRequestResult>;

export interface SeedRunOptions {
  request: SeedRequester;
  fixture?: unknown;
  log?: (message: string) => void;
}

export function runSeed(options: SeedRunOptions): Promise<void>;

export function createRequester(input: {
  baseUrl: string;
  cookie: string;
  origin: string;
}): SeedRequester;
