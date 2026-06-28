import { generateCodes, toCSV } from './codes';
test('generates the requested count of unique codes with prefix', () => {
  const codes = generateCodes({ prefix:'ACME-', length:5, count:500 });
  expect(codes).toHaveLength(500);
  expect(new Set(codes).size).toBe(500);
  expect(codes.every(c => c.startsWith('ACME-') && c.length === 10)).toBe(true);
});
test('CSV has header + one row per code', () => {
  const csv = toCSV(['ACME-AAAAA'], 1);
  expect(csv.split('\n')[0]).toBe('code,status,uses_left');
  expect(csv).toContain('ACME-AAAAA,unused,1');
});
