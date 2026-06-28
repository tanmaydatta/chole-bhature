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

export function toCSV(codes: string[], usesLeft: number | '∞'): string {
  const header = 'code,status,uses_left';
  const rows = codes.map(code => `${code},unused,${usesLeft}`);
  return [header, ...rows].join('\n');
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
