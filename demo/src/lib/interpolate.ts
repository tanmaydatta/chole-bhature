import { money } from './format';

const UNICODE_MINUS = '−';
const TOKEN_RE = /\{\{([^}]+)\}\}/g;

function resolveOperand(operand: string, ctx: Record<string, number | string>): number {
  const trimmed = operand.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    const val = ctx[trimmed];
    if (val === undefined) return 0;
    return Number(val);
  }
  return Number(trimmed);
}

export function renderMessage(template: string, ctx: Record<string, number | string>): string {
  return template.replace(TOKEN_RE, (_match, inner: string) => {
    try {
      const parts = inner.split('|');
      const expr = parts[0];
      const filter = parts[1]?.trim() ?? '';

      let value: number | string;

      const hasUnicodeMinus = expr.includes(UNICODE_MINUS);
      const hasHyphen = /(?<![0-9])-(?![0-9])/.test(expr) || (expr.indexOf('-') > 0);

      if (hasUnicodeMinus || hasHyphen) {
        const sep = hasUnicodeMinus ? UNICODE_MINUS : '-';
        const sepIdx = expr.indexOf(sep);
        const left = resolveOperand(expr.slice(0, sepIdx), ctx);
        const right = resolveOperand(expr.slice(sepIdx + 1), ctx);
        value = left - right;
      } else {
        const trimmed = expr.trim();
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
          const val = ctx[trimmed];
          value = val !== undefined ? val : '';
        } else {
          value = Number(trimmed);
        }
      }

      if (filter === 'money') {
        return money(Number(value));
      }

      return String(value);
    } catch {
      return _match;
    }
  });
}
