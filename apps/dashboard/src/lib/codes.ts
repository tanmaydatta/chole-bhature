const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCodes(opts: { prefix: string; length: number; count: number }): string[] {
  const { prefix, length, count } = opts;
  const set = new Set<string>();
  while (set.size < count) {
    let suffix = '';
    for (let i = 0; i < length; i++) {
      suffix += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    set.add(prefix + suffix);
  }
  return Array.from(set);
}

export function previewExample(prefix: string, length: number): string {
  let suffix = '';
  for (let i = 0; i < length; i++) {
    suffix += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return prefix + suffix;
}

export type CodeStatus = 'unused' | 'redeemed' | 'expired';
export interface CodeRow { code: string; status: CodeStatus; usesUsed: number; usesTotal: number | 'unlimited'; }

const STATUSES: CodeStatus[] = ['unused', 'redeemed', 'expired'];

function randInt(maxInclusive: number): number { return Math.floor(Math.random() * (maxInclusive + 1)); }

function usesUsedFor(status: CodeStatus, usesTotal: number | 'unlimited'): number {
  if (status === 'unused') return 0;
  const cap = usesTotal === 'unlimited' ? 20 : usesTotal;
  if (status === 'redeemed') return cap <= 1 ? 1 : 1 + randInt(cap - 1); // 1..cap
  return randInt(cap); // expired: 0..cap
}

export function buildCodeRows(opts: { prefix: string; length: number; count: number; usesPerCode: number | 'unlimited'; }): CodeRow[] {
  const codes = generateCodes({ prefix: opts.prefix, length: opts.length, count: opts.count });
  return codes.map((code) => {
    const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
    return { code, status, usesTotal: opts.usesPerCode, usesUsed: usesUsedFor(status, opts.usesPerCode) };
  });
}

export function toCSV(codes: string[]): string {
  return 'code\n' + codes.join('\n') + '\n';
}

export function downloadCSV(filename: string, csv: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
