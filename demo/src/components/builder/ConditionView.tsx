import type { ConditionGroup, Variable } from '../../lib/types';
import { operatorLabel, resolveMessage } from '../../lib/conditions';

const ORIGIN_COLORS: Record<string, { color: string; bg: string }> = {
  user:    { color: 'var(--user)',    bg: 'var(--user-bg)' },
  dynamic: { color: 'var(--dyn)',     bg: 'var(--dyn-bg)' },
  system:  { color: 'var(--sys)',     bg: 'var(--sys-bg)' },
};

function formatValue(value: string | string[]): string {
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

interface ConditionViewProps {
  group: ConditionGroup;
  variables: Variable[];
}

export function ConditionView({ group, variables }: ConditionViewProps) {
  if (group.conditions.length === 0) {
    return (
      <p style={{ color: 'var(--muted, #888)', fontStyle: 'italic' }}>
        No conditions (applies to everyone)
      </p>
    );
  }

  return (
    <div>
      <p style={{ marginBottom: '0.5rem', fontWeight: 500 }}>
        Customer must match{' '}
        <strong>{group.match === 'ALL' ? 'ALL' : 'ANY'}</strong> of these:
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {group.conditions.map((condition) => {
          const variable = variables.find((v) => v.name === condition.variable);
          const origin = variable?.origin ?? 'system';
          const colors = ORIGIN_COLORS[origin] ?? ORIGIN_COLORS.system;
          const message = variable ? resolveMessage(condition, variable) : '';

          return (
            <li key={condition.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: colors.bg,
                    color: colors.color,
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '0.85em',
                    fontFamily: 'monospace',
                  }}
                >
                  {condition.variable}
                </span>
                <span>{operatorLabel(condition.operator)}</span>
                <span>{formatValue(condition.value)}</span>
              </div>
              {message && (
                <span style={{ color: 'var(--muted, #888)', fontSize: '0.8em', paddingLeft: '0.25rem' }}>
                  {message}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
