import { useState, useContext } from 'react';
import type {
  CombinatorSelectorProps,
  ControlElementsProp,
  Path,
  RuleGroupProps,
  RuleProps,
  ValueEditorProps,
  ValueSelectorProps,
} from 'react-querybuilder';
import { useRule, useRuleGroup } from 'react-querybuilder';
import type { Condition, Operator, Variable, Origin } from '../../lib/types';
import { OPERATORS_BY_TYPE, operatorLabel, resolveMessage } from '../../lib/conditions';
import { MessageEditor } from './MessageEditor';
import { VariablePicker } from './VariablePicker';
import { conditionIssue } from './condition-validation';
import { ConditionBuilderContext } from './ConditionBuilderContext';

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

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `cond-${crypto.randomUUID()}`
    : `cond-${Math.random().toString(36).slice(2)}`;
}

export interface BuilderCallbacks {
  onGroupCondition?: (id: string) => void;
  onPromoteCondition?: (id: string) => void;
  onMoveCondition?: (id: string, direction: 'up' | 'down') => void;
  onMoveGroup?: (index: number, direction: 'up' | 'down') => void;
  canMoveConditionUp?: (id: string) => boolean;
  canMoveConditionDown?: (id: string) => boolean;
}

export function CustomCombinatorSelector(
  props: CombinatorSelectorProps | (Record<string, any> & { path: Path; value?: string; handleOnChange: (val: string) => void })
) {
  const isRoot = props.path.length === 0;
  const groupNumber = props.path.length > 0 ? (props.path[props.path.length - 1] ?? 0) + 1 : 1;
  const label = isRoot
    ? 'Condition group match root'
    : `Condition group match group ${groupNumber}`;

  return (
    <div className="flex items-center gap-[8px] text-[13.5px] text-[var(--muted)] flex-wrap">
      {isRoot ? (
        <>
          <span>Customer must match </span>
          <select
            aria-label={label}
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
            value={props.value === 'or' ? 'ANY' : 'ALL'}
            onChange={(e) => props.handleOnChange(e.target.value === 'ANY' ? 'or' : 'and')}
          >
            <option value="ALL">ALL</option>
            <option value="ANY">ANY</option>
          </select>
          <span> of these conditions:</span>
        </>
      ) : (
        <>
          <span>Nested group </span>
          <strong>{groupNumber}</strong>
          <span> must match </span>
          <select
            aria-label={label}
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
            value={props.value === 'or' ? 'ANY' : 'ALL'}
            onChange={(e) => props.handleOnChange(e.target.value === 'ANY' ? 'or' : 'and')}
          >
            <option value="ALL">ALL</option>
            <option value="ANY">ANY</option>
          </select>
          <span>:</span>
        </>
      )}
    </div>
  );
}

export function CustomFieldSelector(
  props: Partial<ValueSelectorProps> & {
    value?: string;
    variables?: readonly Variable[];
    handleOnChange: (val: string) => void;
    [key: string]: any;
  }
) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ctx = useContext(ConditionBuilderContext);
  const variables: readonly Variable[] =
    props.variables ?? (props.context as any)?.variables ?? ctx.variables ?? [];
  const variable = variables.find((v: Variable) => v.name === props.value);
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

      {pickerOpen && variables.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72">
          <VariablePicker
            variables={variables as Variable[]}
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

export function CustomOperatorSelector(
  props: {
    value?: string;
    options?: any;
    handleOnChange: (val: string) => void;
    [key: string]: any;
  }
) {
  const options = props.options ?? [];
  return (
    <select
      aria-label="operator"
      className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium cursor-pointer text-[12.5px]"
      value={props.value}
      onChange={(e) => props.handleOnChange(e.target.value)}
    >
      {options.map((opt: any) => (
        <option key={opt.name ?? opt.value} value={opt.name ?? opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function CustomValueEditor(
  props: Partial<ValueEditorProps> & {
    field?: string;
    operator?: string;
    value?: any;
    variables?: readonly Variable[];
    handleOnChange: (val: any) => void;
    [key: string]: any;
  }
) {
  const ctx = useContext(ConditionBuilderContext);
  const variables: readonly Variable[] =
    props.variables ?? (props.context as any)?.variables ?? ctx.variables ?? [];
  const variable = variables.find((v: Variable) => v.name === props.field);
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
  props: RuleProps & { variables?: readonly Variable[]; callbacks?: BuilderCallbacks }
) {
  const rState = useRule(props);
  const ctx = useContext(ConditionBuilderContext);
  const [showMsg, setShowMsg] = useState(() =>
    Boolean((props.rule as any).message && String((props.rule as any).message).trim() !== '')
  );
  const [replacing, setReplacing] = useState(false);

  const variables: readonly Variable[] =
    props.variables ?? (props.context as any)?.variables ?? ctx.variables ?? [];
  const callbacks = props.callbacks ?? (props.context as any)?.callbacks ?? ctx.callbacks;
  const variable = variables.find((v: Variable) => v.name === props.rule.field);

  // Unresolved condition handling
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
            onClick={rState.removeRule}
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
                const op = OPERATORS_BY_TYPE[v.type]?.[0] ?? 'eq';
                let defVal: any = '';
                if (v.type === 'boolean') defVal = true;
                else if (v.type === 'enum' && v.enumValues?.length) defVal = v.enumValues[0];
                else if (v.type === 'number') defVal = 0;

                props.actions.onPropChange('field', v.name, props.path);
                props.actions.onPropChange('operator', op, props.path);
                props.actions.onPropChange('value', defVal, props.path);
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
    operator: props.rule.operator as Operator,
    value: props.rule.value,
    message: (props.rule as any).message,
  };

  const issue = conditionIssue(currentCondition, variables as Variable[]);
  const inherited = resolveMessage({ ...currentCondition, message: undefined }, variable);
  const hasCustomMsg = Boolean(currentCondition.message && currentCondition.message.trim() !== '');

  const operators = ((OPERATORS_BY_TYPE[variable.type] ?? []) as Operator[]).map((op) => ({
    name: op,
    value: op,
    label: operatorLabel(op),
  }));

  const isNested = props.path.length > 1;

  const canMoveUp = callbacks?.canMoveConditionUp
    ? callbacks.canMoveConditionUp(props.rule.id || '')
    : !props.shiftUpDisabled;
  const canMoveDown = callbacks?.canMoveConditionDown
    ? callbacks.canMoveConditionDown(props.rule.id || '')
    : !props.shiftDownDisabled;
  const showMoveArrows = canMoveUp || canMoveDown;

  return (
    <div className="flex items-start gap-2 mb-[8px] w-full">
      {/* Move controls */}
      {showMoveArrows && (
        <div className="flex flex-col gap-0.5 pt-1.5">
          {canMoveUp && (
            <button
              type="button"
              onClick={() =>
                callbacks?.onMoveCondition
                  ? callbacks.onMoveCondition(props.rule.id || '', 'up')
                  : rState.shiftRuleUp()
              }
              data-testid={`move-condition-up-${props.rule.id}`}
              aria-label="Move condition up"
              title="Move condition up"
              className="text-[10px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
            >
              ↑
            </button>
          )}
          {canMoveDown && (
            <button
              type="button"
              onClick={() =>
                callbacks?.onMoveCondition
                  ? callbacks.onMoveCondition(props.rule.id || '', 'down')
                  : rState.shiftRuleDown()
              }
              data-testid={`move-condition-down-${props.rule.id}`}
              aria-label="Move condition down"
              title="Move condition down"
              className="text-[10px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
            >
              ↓
            </button>
          )}
        </div>
      )}

      <div className="flex-1">
        <div className="flex items-center gap-[8px] flex-wrap p-[9px] border border-[var(--border)] rounded-[9px] bg-[var(--panel)]">
          <CustomFieldSelector
            {...props}
            value={props.rule.field}
            variables={variables}
            handleOnChange={(val) => {
              const nextVar = variables.find((v: Variable) => v.name === val);
              const op = nextVar ? (OPERATORS_BY_TYPE[nextVar.type]?.[0] ?? 'eq') : 'eq';
              let defVal: any = '';
              if (nextVar?.type === 'boolean') defVal = true;
              else if (nextVar?.type === 'enum' && nextVar.enumValues?.length) defVal = nextVar.enumValues[0];
              else if (nextVar?.type === 'number') defVal = 0;

              props.actions.onPropChange('field', val, props.path);
              props.actions.onPropChange('operator', op, props.path);
              props.actions.onPropChange('value', defVal, props.path);
            }}
          />

          <CustomOperatorSelector
            {...props}
            options={operators}
            value={props.rule.operator}
            handleOnChange={(op) => {
              // Normalize value on operator change
              let nextVal = props.rule.value;
              if (op === 'between') {
                const first = Array.isArray(nextVal)
                  ? nextVal[0]
                  : nextVal !== undefined && nextVal !== ''
                  ? nextVal
                  : variable.type === 'number'
                  ? 0
                  : '';
                nextVal = [first, Array.isArray(nextVal) ? nextVal[1] ?? first : first];
              } else if (op === 'in') {
                nextVal = Array.isArray(nextVal) ? nextVal : nextVal !== undefined && nextVal !== '' ? [nextVal] : [];
              } else if (Array.isArray(nextVal)) {
                nextVal = nextVal[0] ?? (variable.type === 'number' ? 0 : '');
              }
              props.actions.onPropChange('operator', op, props.path);
              props.actions.onPropChange('value', nextVal, props.path);
            }}
          />

          <CustomValueEditor
            {...props}
            field={props.rule.field}
            operator={props.rule.operator}
            value={props.rule.value}
            variables={variables}
            handleOnChange={(val) => props.actions.onPropChange('value', val, props.path)}
          />

          <span
            className="ml-auto text-[var(--faint)] cursor-pointer text-[16px] px-[4px]"
            onClick={rState.removeRule}
            role="button"
            aria-label="remove condition"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && rState.removeRule()}
          >
            ✕
          </span>
        </div>

        {/* Group / Promote actions */}
        <div className="flex gap-2 mt-1">
          {!isNested && (
            <button
              type="button"
              onClick={() => callbacks?.onGroupCondition?.(props.rule.id || '')}
              data-testid={`group-condition-${props.rule.id}`}
              className="text-[var(--accent)] cursor-pointer text-[11px] border-0 bg-transparent font-bold"
              aria-label="Group this condition into a new nested group"
              title="Move this condition into a new nested group (AND branch)"
            >
              [ group ]
            </button>
          )}
          {isNested && (
            <button
              type="button"
              onClick={() => callbacks?.onPromoteCondition?.(props.rule.id || '')}
              data-testid={`promote-condition-${props.rule.id}`}
              className="text-[var(--accent)] cursor-pointer text-[11px] border-0 bg-transparent font-bold"
              aria-label="Promote this condition to the parent group"
              title="Move this condition to the parent group"
            >
              [ promote ]
            </button>
          )}
        </div>

        {/* Failure message bar */}
        {showMsg ? (
          <div className="mt-1">
            <MessageEditor
              condition={currentCondition}
              variable={variable}
              onChange={(next) =>
                (props.actions.onPropChange as any)('message', next.message, props.path)
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
              {hasCustomMsg ? 'Customize' : 'Add custom message'}
            </button>
            <span className="text-[var(--faint)] italic">
              · {hasCustomMsg ? 'custom message set' : `using default: "${inherited}"`}
            </span>
          </div>
        )}

        {issue && <p role="alert" className="mt-1 text-[12px] text-amber-700">{issue}</p>}
      </div>
    </div>
  );
}

function renderRuleOrGroup(
  r: any,
  idx: number,
  rgState: ReturnType<typeof useRuleGroup>
) {
  const thisPathMemo = rgState.pathsMemo[idx];
  const thisPath = thisPathMemo?.path ?? [...rgState.path, idx];
  const thisPathDisabled =
    thisPathMemo?.disabled || (typeof r !== 'string' && r.disabled);
  const ruleArrayLength = rgState.ruleGroup.rules.length;
  const shiftUpDisabled = rgState.path.length === 0 && idx === 0;
  const shiftDownDisabled =
    rgState.path.length === 0 && idx === ruleArrayLength - 1;
  const key = typeof r === 'string' ? [...thisPath, r].join('-') : r.id;

  if (typeof r !== 'string' && 'rules' in r) {
    const RuleGroupControl = rgState.schema.controls.ruleGroup;
    return (
      <RuleGroupControl
        key={r.id || `rg-${key}`}
        id={r.id}
        schema={rgState.schema}
        actions={rgState.actions}
        path={thisPath}
        translations={rgState.translations}
        ruleGroup={r}
        rules={r.rules}
        combinator={'combinator' in r ? r.combinator : undefined}
        not={!!r.not}
        disabled={thisPathDisabled}
        parentDisabled={rgState.parentDisabled || rgState.disabled}
        parentMuted={rgState.parentMuted || rgState.muted}
        shiftUpDisabled={shiftUpDisabled}
        shiftDownDisabled={shiftDownDisabled}
        context={rgState.context}
      />
    );
  }

  const RuleControl = rgState.schema.controls.rule;
  return (
    <RuleControl
      key={r.id || `r-${key}`}
      id={r.id}
      rule={r}
      field={r.field}
      operator={r.operator}
      value={r.value}
      valueSource={r.valueSource}
      schema={rgState.schema}
      actions={rgState.actions}
      path={thisPath}
      disabled={thisPathDisabled}
      parentDisabled={rgState.parentDisabled || rgState.disabled}
      parentMuted={rgState.parentMuted || rgState.muted}
      translations={rgState.translations}
      shiftUpDisabled={shiftUpDisabled}
      shiftDownDisabled={shiftDownDisabled}
      context={rgState.context}
    />
  );
}

export function CustomRuleGroup(
  props: RuleGroupProps & { variables?: readonly Variable[]; callbacks?: BuilderCallbacks }
) {
  const rgState = useRuleGroup(props);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isRoot = props.path.length === 0;
  const ctx = useContext(ConditionBuilderContext);
  const variables: readonly Variable[] =
    props.variables ?? (props.context as any)?.variables ?? ctx.variables ?? [];
  const callbacks = props.callbacks ?? (props.context as any)?.callbacks ?? ctx.callbacks;

  const groupNumber = props.path.length > 0 ? (props.path[props.path.length - 1] ?? 0) + 1 : 1;
  const rules = props.ruleGroup.rules ?? [];
  const hasRules = rules.length > 0;
  const nestedSubgroups = rules.filter((r) => typeof r !== 'string' && 'rules' in r);

  const leafRules: { r: any; idx: number }[] = [];
  const subGroupRules: { r: any; idx: number }[] = [];

  rules.forEach((r, idx) => {
    if (typeof r !== 'string' && 'rules' in r) {
      subGroupRules.push({ r, idx });
    } else {
      leafRules.push({ r, idx });
    }
  });

  const handlePick = (variable: Variable) => {
    const operator = OPERATORS_BY_TYPE[variable.type]?.[0] ?? 'eq';
    let defaultValue: Condition['value'] = '';
    if (variable.type === 'boolean') defaultValue = true;
    else if (variable.type === 'enum' && variable.enumValues?.length)
      defaultValue = variable.enumValues[0];
    else if (variable.type === 'number') defaultValue = 0;

    const newRule = {
      id: newId(),
      field: variable.name,
      operator,
      value: defaultValue,
    };
    props.actions.onRuleAdd(newRule, props.path);
    setPickerOpen(false);
  };

  const handleAddNestedGroup = () => {
    props.actions.onGroupAdd(
      {
        combinator: 'and',
        rules: [],
      },
      props.path
    );
  };

  return (
    <div
      className={`relative rounded-[10px] p-[12px] bg-[var(--bg)] mb-3 ${
        isRoot
          ? 'border border-[var(--border)] border-l-[3px] border-l-[var(--accent)]'
          : 'border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] ml-4 mt-2'
      }`}
    >
      <div className="flex items-center gap-[8px] text-[13.5px] text-[var(--muted)] mb-[12px] flex-wrap">
        <CustomCombinatorSelector
          {...props}
          value={props.ruleGroup.combinator}
          handleOnChange={rgState.onCombinatorChange}
        />

        {/* Reorder controls for nested groups at root level */}
        {isRoot && nestedSubgroups.length > 1 && (
          <div className="flex gap-1 ml-2">
            {nestedSubgroups.map((_, gi) => (
              <span key={gi} className="flex items-center gap-0.5">
                {gi > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      callbacks?.onMoveGroup
                        ? callbacks.onMoveGroup(gi, 'up')
                        : props.actions.moveRule([gi], [gi - 1])
                    }
                    data-testid={`move-group-up-${gi + 1}`}
                    aria-label="Move group up"
                    title="Move group up"
                    className="text-[11px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
                  >
                    ↑
                  </button>
                )}
                {gi < nestedSubgroups.length - 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      callbacks?.onMoveGroup
                        ? callbacks.onMoveGroup(gi, 'down')
                        : props.actions.moveRule([gi], [gi + 1])
                    }
                    data-testid={`move-group-down-${gi + 1}`}
                    aria-label="Move group down"
                    title="Move group down"
                    className="text-[11px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
                  >
                    ↓
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {!isRoot && (
          <button
            type="button"
            aria-label={`Remove group ${groupNumber}`}
            className="text-[var(--muted)] hover:text-rose-600 cursor-pointer text-[13px] border-0 bg-transparent ml-auto"
            onClick={() => props.actions.onGroupRemove(props.path)}
          >
            Remove group {groupNumber}
          </button>
        )}
      </div>

      {!hasRules && (
        <div className="mb-3 text-[12px] text-[var(--muted)] italic px-2">
          Empty — use the <strong>Add</strong> link below to start building this{' '}
          {props.ruleGroup.combinator === 'and' ? 'AND' : 'OR'} branch.
        </div>
      )}

      {/* Render leaf rules first */}
      {leafRules.map(({ r, idx }) => renderRuleOrGroup(r, idx, rgState))}

      <div className="flex gap-[14px] mt-[6px]">
        <span
          className="text-[var(--accent)] font-bold cursor-pointer text-[13px]"
          onClick={() => setPickerOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setPickerOpen((o) => !o)}
        >
          ＋ Add condition
        </span>
        <button
          type="button"
          onClick={handleAddNestedGroup}
          className="text-[var(--muted)] font-bold cursor-pointer text-[13px] border-0 bg-transparent"
        >
          ＋ Add nested group (AND / OR)
        </button>
      </div>

      {pickerOpen && (
        <div className="mt-2">
          <VariablePicker variables={variables as Variable[]} onPick={handlePick} />
        </div>
      )}

      {/* Render child rule groups after the add buttons */}
      {subGroupRules.map(({ r, idx }) => renderRuleOrGroup(r, idx, rgState))}
    </div>
  );
}

export const customControlElements: ControlElementsProp<any, any> = {
  combinatorSelector: CustomCombinatorSelector,
  fieldSelector: CustomFieldSelector,
  operatorSelector: CustomOperatorSelector,
  valueEditor: CustomValueEditor,
  rule: CustomRule,
  ruleGroup: CustomRuleGroup,
};

export function createCustomControlElements(
  variables: readonly Variable[],
  callbacks?: BuilderCallbacks
): ControlElementsProp<any, any> {
  return {
    combinatorSelector: CustomCombinatorSelector,
    fieldSelector: (props: ValueSelectorProps) => (
      <CustomFieldSelector {...props} variables={variables} />
    ),
    operatorSelector: CustomOperatorSelector,
    valueEditor: (props: ValueEditorProps) => (
      <CustomValueEditor {...props} variables={variables} />
    ),
    rule: (props: RuleProps) => (
      <CustomRule {...props} variables={variables} callbacks={callbacks} />
    ),
    ruleGroup: (props: RuleGroupProps) => (
      <CustomRuleGroup {...props} variables={variables} callbacks={callbacks} />
    ),
  };
}
