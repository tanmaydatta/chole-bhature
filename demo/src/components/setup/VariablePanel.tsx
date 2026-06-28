import { useState } from 'react';
import type { Variable, VarType, Origin } from '../../lib/types';
import { useVariablesStore } from '../../data/variablesStore';

interface VariablePanelProps {
  variable: Variable | null;
  mode: 'view' | 'edit' | 'create';
  onClose: () => void;
}

const VAR_TYPES: VarType[] = ['string', 'number', 'boolean', 'enum', 'date'];
const ALL_ORIGINS: Origin[] = ['user', 'dynamic', 'system'];
const CREATE_ORIGINS: Origin[] = ['user', 'dynamic'];

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[4px]">
      <span className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold">
        {label}
      </span>
      <span className="text-[13.5px] text-[var(--ink)]">{value || '—'}</span>
    </div>
  );
}

export function VariablePanel({ variable, mode, onClose }: VariablePanelProps) {
  const addVariable = useVariablesStore(s => s.addVariable);
  const updateVariable = useVariablesStore(s => s.updateVariable);

  // Form state (edit/create)
  const [name, setName] = useState(variable?.name ?? '');
  const [type, setType] = useState<VarType>(variable?.type ?? 'string');
  const [origin, setOrigin] = useState<Origin>(
    variable?.origin ?? 'user'
  );
  const [enumValuesStr, setEnumValuesStr] = useState(
    variable?.enumValues?.join(', ') ?? ''
  );
  const [defaultMessage, setDefaultMessage] = useState(
    variable?.defaultMessage ?? ''
  );

  function handleSave() {
    const enumValues = type === 'enum'
      ? enumValuesStr.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    if (mode === 'create') {
      addVariable({
        name,
        type,
        origin,
        ...(enumValues ? { enumValues } : {}),
        ...(defaultMessage ? { defaultMessage } : {}),
      });
    } else if (mode === 'edit' && variable) {
      updateVariable(variable.name, {
        type,
        origin,
        ...(enumValues !== undefined ? { enumValues } : {}),
        defaultMessage: defaultMessage || undefined,
      });
    }
    onClose();
  }

  const title =
    mode === 'create'
      ? 'New Variable'
      : mode === 'view'
      ? variable?.name ?? 'Variable'
      : `Edit · ${variable?.name ?? ''}`;

  const availableOrigins = mode === 'create' ? CREATE_ORIGINS : ALL_ORIGINS;

  return (
    <>
      {/* Dim overlay */}
      <div
        data-testid="panel-overlay"
        className="fixed inset-0 bg-black/30 z-[40]"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-0 right-0 h-full w-[420px] max-w-full bg-[var(--panel)] border-l border-[var(--border)] shadow-[var(--shadow)] z-[50] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[20px] py-[16px] border-b border-[var(--border)]">
          <div className="flex items-center gap-[8px]">
            <span className="font-[650] text-[15px] text-[var(--ink)]">{title}</span>
            {mode === 'view' && variable?.readOnly && (
              <span className="text-[16px]" title="Read-only">🔒</span>
            )}
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="w-[28px] h-[28px] rounded-[6px] border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center cursor-pointer text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[20px] py-[20px] flex flex-col gap-[18px]">
          {mode === 'view' ? (
            // Read-only display
            <>
              <ReadonlyField label="Name" value={variable?.name ?? ''} />
              <ReadonlyField label="Type" value={variable?.type ?? ''} />
              <ReadonlyField label="Origin" value={variable?.origin ?? ''} />
              {variable?.type === 'enum' && variable.enumValues && (
                <ReadonlyField
                  label="Enum values"
                  value={variable.enumValues.join(', ')}
                />
              )}
              <ReadonlyField
                label="Default error message"
                value={variable?.defaultMessage ?? ''}
              />
            </>
          ) : (
            // Editable form
            <>
              {/* Name — only editable in create mode */}
              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="var-name"
                  className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold"
                >
                  Name
                </label>
                {mode === 'create' ? (
                  <input
                    id="var-name"
                    type="text"
                    placeholder="variable name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="border border-[var(--border)] rounded-[8px] px-[10px] py-[7px] text-[13.5px] bg-[var(--bg)] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                  />
                ) : (
                  <span className="text-[13.5px] text-[var(--ink)] font-[650]">
                    {variable?.name}
                  </span>
                )}
              </div>

              {/* Type */}
              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="var-type"
                  className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold"
                >
                  Type
                </label>
                <select
                  id="var-type"
                  value={type}
                  onChange={e => setType(e.target.value as VarType)}
                  className="border border-[var(--border)] rounded-[8px] px-[10px] py-[7px] text-[13.5px] bg-[var(--bg)] text-[var(--ink)] outline-none focus:border-[var(--accent)] cursor-pointer"
                >
                  {VAR_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Enum values — only shown when type=enum */}
              {type === 'enum' && (
                <div className="flex flex-col gap-[6px]">
                  <label
                    htmlFor="var-enum"
                    className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold"
                  >
                    Enum values
                  </label>
                  <input
                    id="var-enum"
                    type="text"
                    placeholder="gold, silver, bronze"
                    value={enumValuesStr}
                    onChange={e => setEnumValuesStr(e.target.value)}
                    className="border border-[var(--border)] rounded-[8px] px-[10px] py-[7px] text-[13.5px] bg-[var(--bg)] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                  />
                  <span className="text-[11.5px] text-[var(--muted)]">
                    Comma-separated list of allowed values
                  </span>
                </div>
              )}

              {/* Origin */}
              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="var-origin"
                  className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold"
                >
                  Origin
                </label>
                <select
                  id="var-origin"
                  value={origin}
                  onChange={e => setOrigin(e.target.value as Origin)}
                  className="border border-[var(--border)] rounded-[8px] px-[10px] py-[7px] text-[13.5px] bg-[var(--bg)] text-[var(--ink)] outline-none focus:border-[var(--accent)] cursor-pointer"
                >
                  {availableOrigins.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>

              {/* Default error message */}
              <div className="flex flex-col gap-[6px]">
                <label
                  htmlFor="var-msg"
                  className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold"
                >
                  Default error message
                </label>
                <input
                  id="var-msg"
                  type="text"
                  placeholder="Shown when this condition fails"
                  value={defaultMessage}
                  onChange={e => setDefaultMessage(e.target.value)}
                  className="border border-[var(--border)] rounded-[8px] px-[10px] py-[7px] text-[13.5px] bg-[var(--bg)] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer — only in edit/create */}
        {mode !== 'view' && (
          <div className="px-[20px] py-[16px] border-t border-[var(--border)] flex justify-end gap-[10px]">
            <button
              onClick={onClose}
              className="px-[14px] py-[8px] rounded-[8px] border border-[var(--border)] bg-transparent text-[var(--muted)] font-[600] text-[13px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-[14px] py-[8px] rounded-[8px] bg-[var(--accent)] text-white font-[600] text-[13px] border-none cursor-pointer"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </>
  );
}
