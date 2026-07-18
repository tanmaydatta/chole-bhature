import { money } from './format';

const TOKEN_RE = /\{\{([^}]+)\}\}/g;
const SUBTRACTION_RE = /^\s*([\w.]+)\s*-\s*([\w.]+)\s*$/;

function resolveOperand(operand: string, ctx: Record<string, number | string>): number | null {
  const trimmed = operand.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    const val = ctx[trimmed];
    if (val === undefined) return null;
    return Number(val);
  }
  return Number(trimmed);
}

export function renderMessage(template: string, ctx: Record<string, number | string>): string {
  return template.replace(TOKEN_RE, (_match, inner: string) => {
    try {
      const parts = inner.split('|');
      const rawExpr = parts[0];
      const filter = parts[1]?.trim() ?? '';

      // Normalize Unicode minus (U+2212) to ASCII hyphen
      const expr = rawExpr.replace(/−/g, '-');

      let value: number | string;

      const subMatch = SUBTRACTION_RE.exec(expr);
      if (subMatch) {
        const left = resolveOperand(subMatch[1], ctx);
        const right = resolveOperand(subMatch[2], ctx);
        if (left === null || right === null) return '';
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
