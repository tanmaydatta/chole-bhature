import type { ConditionGroup, ConditionValue, Variable } from '../../lib/types';
import { operatorLabel, resolveMessage } from '../../lib/conditions';

const ORIGIN_META: Record<string, { icon: string; color: string; bg: string }> = {
  user:    { icon: '◔', color: 'var(--user)',    bg: 'var(--user-bg)' },
  dynamic: { icon: '◇', color: 'var(--dyn)',     bg: 'var(--dyn-bg)' },
  system:  { icon: '⚙', color: 'var(--sys)',     bg: 'var(--sys-bg)' },
};

function formatValue(value: ConditionValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
}

interface ConditionViewProps {
  group?: ConditionGroup | null;
  variables: Variable[];
  depth?: number;
  groupIndex?: number;
}

export function ConditionView({
  group,
  variables,
  depth = 0,
  groupIndex,
}: ConditionViewProps) {
  if (!group) {
    return (
      <p className="text-[13px] text-[var(--muted)] italic m-0">
        No conditions (applies to everyone)
      </p>
    );
  }

  const hasConditions = group.conditions && group.conditions.length > 0;
  const hasSubGroups = group.groups && group.groups.length > 0;

  if (!hasConditions && !hasSubGroups) {
    return (
      <p className="text-[13px] text-[var(--muted)] italic m-0">
        No conditions (applies to everyone)
      </p>
    );
  }

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex items-center gap-1.5 text-[13px] text-[var(--muted)] flex-wrap">
        {depth === 0 ? (
          <>
            <span>Customer must match</span>
            <span className="font-bold text-[var(--ink)] bg-[var(--panel)] border border-[var(--border)] px-2 py-0.5 rounded-[5px] text-[12px]">
              {group.match}
            </span>
            <span>of these conditions:</span>
          </>
        ) : (
          <>
            <span>Nested group <strong>{groupIndex ?? depth}</strong> must match</span>
            <span className="font-bold text-[var(--ink)] bg-[var(--panel)] border border-[var(--border)] px-2 py-0.5 rounded-[5px] text-[12px]">
              {group.match}
            </span>
            <span>:</span>
          </>
        )}
      </div>

      {hasConditions && (
        <ul className="list-none p-0 m-0 space-y-2">
          {group.conditions.map((condition) => {
            const variable = variables.find((v) => v.name === condition.variable);
            const origin = variable?.origin ?? 'system';
            const meta = ORIGIN_META[origin] ?? ORIGIN_META.system;
            const message = variable ? resolveMessage(condition, variable) : '';
            const isCustom = Boolean(condition.message && condition.message.trim());

            return (
              <li
                key={condition.id}
                className="flex flex-col gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--panel)] p-2.5 shadow-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 text-[12px] font-mono font-semibold"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    <span>{meta.icon}</span>
                    <span>{condition.variable}</span>
                  </span>
                  <span className="font-semibold text-[var(--muted)]">
                    {operatorLabel(condition.operator)}
                  </span>
                  <span className="font-semibold text-[var(--ink)] bg-[var(--bg)] border border-[var(--border)] px-2 py-0.5 rounded-[5px] font-mono text-[12px]">
                    {formatValue(condition.value)}
                  </span>
                </div>
                {message && (
                  <div className="text-[11.5px] text-[var(--muted)] pl-1 flex items-center gap-1">
                    <span>💬</span>
                    {isCustom ? (
                      <span className="text-[var(--ink)] font-medium">"{message}"</span>
                    ) : (
                      <span className="italic">using default: "{message}"</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasSubGroups && (
        <div className="space-y-3 mt-3">
          {group.groups!.map((subGroup, index) => (
            <div
              key={index}
              className="ml-2.5 pl-3 border-l-2 border-[var(--accent)] rounded-r-[8px] border-y border-r border-[var(--border)] bg-[var(--bg)] p-3 space-y-2.5"
            >
              <ConditionView
                group={subGroup}
                variables={variables}
                depth={depth + 1}
                groupIndex={index + 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
