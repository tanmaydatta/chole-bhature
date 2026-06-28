export function money(n: number): string {
  if (Number.isInteger(n)) {
    return `$${n}`;
  }
  return `$${n.toFixed(2)}`;
}
