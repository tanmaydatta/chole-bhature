import { generateCodes, toCSV, buildCodeRows } from './codes';

test('toCSV is codes-only (code header + one per line)', () => {
  expect(toCSV(['ACME-AAAAA', 'ACME-BBBBB'])).toBe('code\nACME-AAAAA\nACME-BBBBB\n');
});

test('generates the requested count of unique codes with prefix', () => {
  const codes = generateCodes({ prefix: 'ACME-', length: 5, count: 500 });
  expect(codes).toHaveLength(500);
  expect(new Set(codes).size).toBe(500);
  expect(codes.every(c => c.startsWith('ACME-') && c.length === 10)).toBe(true);
});

test('buildCodeRows: count, valid statuses, consistent usesUsed (capped)', () => {
  const rows = buildCodeRows({ prefix: 'ACME-', length: 5, count: 200, usesPerCode: 5 });
  expect(rows).toHaveLength(200);
  expect(rows.every(r => ['unused','redeemed','expired'].includes(r.status))).toBe(true);
  expect(rows.every(r => r.usesTotal === 5)).toBe(true);
  expect(rows.every(r => r.usesUsed >= 0 && r.usesUsed <= 5)).toBe(true);
  expect(rows.filter(r => r.status === 'unused').every(r => r.usesUsed === 0)).toBe(true);
  expect(rows.filter(r => r.status === 'redeemed').every(r => r.usesUsed >= 1)).toBe(true);
});

test('buildCodeRows: single-use redeemed → exactly 1 use', () => {
  const rows = buildCodeRows({ prefix: 'X-', length: 4, count: 100, usesPerCode: 1 });
  expect(rows.filter(r => r.status === 'redeemed').every(r => r.usesUsed === 1)).toBe(true);
  expect(rows.every(r => r.usesUsed <= 1)).toBe(true);
});

test('buildCodeRows: unlimited usesTotal passes through', () => {
  const rows = buildCodeRows({ prefix: 'U-', length: 4, count: 50, usesPerCode: 'unlimited' });
  expect(rows.every(r => r.usesTotal === 'unlimited')).toBe(true);
  expect(rows.filter(r => r.status === 'unused').every(r => r.usesUsed === 0)).toBe(true);
});
