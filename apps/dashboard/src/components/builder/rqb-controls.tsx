import { useState } from 'react';
import type {
  ActionProps,
  CombinatorSelectorProps,
  ControlElementsProp,
  RuleGroupProps,
  RuleProps,
  ValueEditorProps,
  ValueSelectorProps,
} from 'react-querybuilder';
import type { Condition, ConditionOperator, Variable, Origin } from '../../lib/types';
import { OPERATORS_BY_TYPE, operatorLabel, resolveMessage } from '../../lib/conditions';
import { MessageEditor } from './MessageEditor';
import { VariablePicker } from './VariablePicker';
import { conditionIssue } from './condition-validation';

import 'react-querybuilder/dist/query-builder.css';

const ORIGIN_CHIP_CLASS: Record<Origin, string> = {
  user: 'text-[var(--user)] bg-[var(--user-bg)]',
  dynamic: 'text-[var(--dyn)] bg-[var(--dyn-bg)]',
  system: 'text-[var(--sys)] bg-[var(--sys-bg)]',
};

const ORIGIN_ICON: Record<Origin, string> = {
  user: '◔',
  dynamic: '◇',
  system: '⚙',
};

export function CustomCombinatorSelector(props: CombinatorSelectorProps) {
  const isRoot = props.level === 0;
  const label = isRoot
    ? 'Condition group match root'
    : `Condition group match group ${props.level}`;

  return (
    <div className="flex items-center gap-[8px] text-[13.5px] text-[var(--muted)] flex-wrap">
      {isRoot ? (
        <>
          <span>Customer must match </span>
          <select
            aria-label={label}
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
            value={props.value}
            onChange={(e) => props.handleOnChange(e.target.value)}
          >
            <option value="and">ALL</option>
            <option value="or">ANY</option>
          </select>
          <span> of these conditions:</span>
        </>
      ) : (
        <>
          <span>Nested group </span>
          <strong>{props.level}</strong>
          <span> must match </span>
          <select
            aria-label={label}
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
            value={props.value}
            onChange={(e) => props.handleOnChange(e.target.value)}
          >
            <option value="and">ALL</option>
            <option value="or">ANY</option>
          </select>
          <span>:</span>
        </>
      )}
    </div>
  );
}

export function CustomFieldSelector(
  props: ValueSelectorProps & { variables?: readonly Variable[] }
) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const variable = props.variables?.find((v) => v.name === props.value);
  const origin: Origin = variable?.origin ?? 'dynamic';
  const chipClass = ORIGIN_CHIP_CLASS[origin] ?? ORIGIN_CHIP_CLASS.dynamic;
  const icon = ORIGIN_ICON[origin] ?? '◇';

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        className={`inline-flex items-center gap-[6px] font-semibold text-[12.5px] px-[9px] py-[4px] rounded-[7px] cursor-pointer border border-transparent hover:border-[var(--border)] ${chipClass}`}
        aria-label="field selector"
      >
        <span>{icon}</span>
        <code>{props.value || 'Select variable'}</code>
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {pickerOpen && props.variables && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72">
          <VariablePicker
            variables={props.variables as Variable[]}
            onPick={(v) => {
              props.handleOnChange(v.name);
              setPickerOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CustomOperatorSelector(props: ValueSelectorProps) {
  const options = props.options ?? [];
  return (
    <select
      aria-label="operator"
      className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium cursor-pointer text-[12.5px]"
      value={props.value}
      onChange={(e) => props.handleOnChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.name} value={opt.name}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function CustomValueEditor(
  props: ValueEditorProps & { variables?: readonly Variable[] }
) {
  const variable = props.variables?.find((v) => v.name === props.field);
  const operator = props.operator;
  const val = props.value;

  if (operator === 'between') {
    const arrayValue = Array.isArray(val)
      ? val
      : typeof val === 'string'
      ? val.split(',').map((s) => s.trim())
      : [val, val];
    const inputType =
      variable?.type === 'number'
        ? 'number'
        : variable?.type === 'date'
        ? 'date'
        : 'text';
    const typed = (raw: string) =>
      variable?.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;

    return (
      <div className="flex items-center gap-2">
        <input
          aria-label="minimum value"
          type={inputType}
          className="border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[9px] py-[4px] min-w-[70px] text-[12.5px] text-[var(--ink)]"
          value={arrayValue[0] ?? ''}
          onChange={(e) =>
            props.handleOnChange([
              typed(e.target.value),
              arrayValue[1] ?? typed(e.target.value),
            ])
          }
        />
        <span className="text-[11px] text-[var(--muted)]">to</span>
        <input
          aria-label="maximum value"
          type={inputType}
          className="border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[9px] py-[4px] min-w-[70px] text-[12.5px] text-[var(--ink)]"
          value={arrayValue[1] ?? ''}
          onChange={(e) =>
            props.handleOnChange([
              arrayValue[0] ?? typed(e.target.value),
              typed(e.target.value),
            ])
          }
        />
      </div>
    );
  }

  if (operator === 'in') {
    const arrayValue: string[] = Array.isArray(val)
      ? val.map(String)
      : typeof val === 'string'
      ? val.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (variable?.type === 'enum' && variable.enumValues?.length) {
      return (
        <select
          multiple
          aria-label="values"
          className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium text-[12.5px]"
          value={arrayValue}
          onChange={(e) =>
            props.handleOnChange(
              Array.from(e.target.selectedOptions, (option) => option.value)
            )
          }
        >
          {variable.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        aria-label="values"
        className="border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[9px] py-[4px] min-w-[120px] text-[12.5px] text-[var(--ink)]"
        placeholder="value1, value2"
        value={Array.isArray(val) ? val.join(', ') : String(val ?? '')}
        onChange={(e) =>
          props.handleOnChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((item) => (variable?.type === 'number' ? Number(item) : item))
          )
        }
      />
    );
  }

  if (variable?.type === 'boolean' || operator === 'is') {
    const boolStr = String(val === true || val === 'true');
    return (
      <select
        aria-label="value"
        className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium text-[12.5px]"
        value={boolStr}
        onChange={(e) => props.handleOnChange(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (variable?.type === 'enum' && variable.enumValues?.length) {
    return (
      <select
        aria-label="value"
        className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium text-[12.5px]"
        value={String(val ?? variable.enumValues[0])}
        onChange={(e) => props.handleOnChange(e.target.value)}
      >
        {variable.enumValues.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  const inputType =
    variable?.type === 'number'
      ? 'number'
      : variable?.type === 'date'
      ? 'date'
      : 'text';

  return (
    <input
      aria-label="value"
      type={inputType}
      className="border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[9px] py-[4px] min-w-[70px] text-[12.5px] text-[var(--ink)]"
      value={val ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        const nextVal = variable?.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
        props.handleOnChange(nextVal);
      }}
    />
  );
}

export function CustomRule(
  props: RuleProps & { variables?: readonly Variable[] }
) {
  const [showMsg, setShowMsg] = useState(() =>
    Boolean((props.rule as any).message && String((props.rule as any).message).trim() !== '')
  );
  const [replacing, setReplacing] = useState(false);

  const variables = props.variables ?? [];
  const variable = variables.find((v) => v.name === props.rule.field);

  if (!variable) {
    return (
      <div
        role="group"
        aria-label={`Unresolved condition ${props.rule.field}`}
        className="mb-2 rounded-[9px] border border-amber-500 bg-amber-50 p-3 text-[12.5px] text-slate-900 w-full"
      >
        <div className="flex flex-wrap items-center gap-2">
          <code>{props.rule.field}</code>
          <code>{props.rule.operator}</code>
          <code>{String(props.rule.value)}</code>
          <button
            type="button"
            className="text-[var(--accent)] font-semibold cursor-pointer underline text-[12px]"
            onClick={() => setReplacing((r) => !r)}
          >
            Replace {props.rule.field}
          </button>
          <button
            type="button"
            className="text-rose-600 font-semibold cursor-pointer underline text-[12px]"
            onClick={() => props.actions.removeRule(props.path)}
          >
            Remove {props.rule.field}
          </button>
        </div>
        <p role="alert" className="mt-1 text-amber-900 font-medium text-[12px]">
          Missing variable definition for {props.rule.field}.
        </p>
        {replacing && (
          <div className="mt-2 w-72">
            <VariablePicker
              variables={variables as Variable[]}
              onPick={(v) => {
                props.actions.onRuleChange({
                  ...props.rule,
                  field: v.name,
                });
                setReplacing(false);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  const currentCondition: Condition = {
    id: props.rule.id || '',
    variable: props.rule.field,
    operator: props.rule.operator as ConditionOperator,
    value: props.rule.value,
    message: (props.rule as any).message,
  };

  const issue = conditionIssue(currentCondition, variables);
  const inherited = resolveMessage({ ...currentCondition, message: undefined }, variable);
  const hasCustomMsg = Boolean(currentCondition.message && currentCondition.message.trim() !== '');

  const {
    controls: { fieldSelector: FieldSelector, operatorSelector: OperatorSelector, valueEditor: ValueEditor },
  } = props.schema;

  const operators = variable
    ? (OPERATORS_BY_TYPE[variable.type] ?? []).map((op) => ({
        name: op,
        label: operatorLabel(op),
      }))
    : [];
  const fieldData = Array.isArray(props.schema.fields)
    ? props.schema.fields.find((f: any) => f.name === props.rule.field)
    : undefined;

  return (
    <div className="mb-[8px] w-full">
      <div className="flex items-center gap-[8px] flex-wrap p-[9px] border border-[var(--border)] rounded-[9px] bg-[var(--panel)]">
        <FieldSelector
          {...props}
          options={props.schema.fields as any}
          value={props.rule.field}
          handleOnChange={(val) => props.actions.onRuleChange({ ...props.rule, field: val })}
        />

        <OperatorSelector
          {...props}
          options={operators}
          value={props.rule.operator}
          handleOnChange={(val) => props.actions.onRuleChange({ ...props.rule, operator: val })}
        />

        <ValueEditor
          {...props}
          field={props.rule.field}
          fieldData={fieldData}
          operator={props.rule.operator}
          value={props.rule.value}
          handleOnChange={(val) => props.actions.onRuleChange({ ...props.rule, value: val })}
        />

        <div className="flex items-center gap-2 ml-auto">
          {/* Duplicate / Clone rule */}
          <button
            type="button"
            onClick={() => props.actions.cloneRule?.(props.path)}
            aria-label="clone rule"
            title="Duplicate condition"
            className="text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 text-[13px] px-1"
          >
            ⧉
          </button>

          {/* Remove rule */}
          <button
            type="button"
            onClick={() => props.actions.removeRule(props.path)}
            aria-label="remove condition"
            title="Remove condition"
            className="text-[var(--faint)] hover:text-rose-600 cursor-pointer text-[16px] px-[4px] bg-transparent border-0"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Failure message bar */}
      {showMsg ? (
        <div className="mt-1">
          <MessageEditor
            condition={currentCondition}
            variable={variable}
            onChange={(next) =>
              props.actions.onRuleChange({
                ...props.rule,
                message: next.message,
              })
            }
          />
        </div>
      ) : (
        <div className="flex items-center gap-[7px] text-[12px] mt-[2px] ml-[2px]">
          <span>💬</span>
          <button
            type="button"
            className="text-[var(--accent)] cursor-pointer font-semibold bg-transparent border-0 p-0 text-[12px]"
            onClick={() => setShowMsg(true)}
          >
            {hasCustomMsg ? 'Customize message' : 'Add custom message'}
          </button>
          <span className="text-[var(--faint)] italic">
            · {hasCustomMsg ? 'custom message set' : `using default: "${inherited}"`}
          </span>
        </div>
      )}

      {issue && <p role="alert" className="mt-1 text-[12px] text-amber-700">{issue}</p>}
    </div>
  );
}

export function createCustomControlElements(
  variables: readonly Variable[]
): ControlElementsProp {
  return {
    combinatorSelector: CustomCombinatorSelector,
    fieldSelector: (props: ValueSelectorProps) => (
      <CustomFieldSelector {...props} variables={variables} />
    ),
    operatorSelector: CustomOperatorSelector,
    valueEditor: (props: ValueEditorProps) => (
      <CustomValueEditor {...props} variables={variables} />
    ),
    rule: (props: RuleProps) => <CustomRule {...props} variables={variables} />,
    actionElement: (props: ActionProps) => (
      <button
        type="button"
        className={props.className}
        onClick={props.handleOnClick}
        title={props.title}
        disabled={props.disabled}
      >
        {props.label}
      </button>
    ),
  };
}
