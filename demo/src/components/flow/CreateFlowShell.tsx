import type { ReactNode } from 'react';
import { StepsRail } from './StepsRail';

interface TypeMeta {
  label: string;
  color: string;
  bg: string;
  icon: string;
}

interface Step {
  key: string;
  label: string;
}

interface CreateFlowShellProps {
  typeMeta: TypeMeta;
  steps: Step[];
  activeStep: string;
  onStep: (key: string) => void;
  onCancel: () => void;
  onSaveDraft: () => void;
  onContinue?: () => void;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function CreateFlowShell({
  typeMeta,
  steps,
  activeStep,
  onStep,
  onCancel,
  onSaveDraft,
  onContinue,
  onBack,
  children,
  footer,
}: CreateFlowShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-[22px] py-[12px] bg-[var(--panel)] border-b border-[var(--border)] sticky top-0 z-[5]">
        <div className="flex items-center gap-[12px]">
          <button
            className="w-[30px] h-[30px] rounded-[8px] border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center cursor-pointer"
            onClick={() => (onBack ?? onCancel)()}
            aria-label="Go back"
          >
            ←
          </button>
          <div className="font-[650]">
            New program{' '}
            <span
              className="inline-flex items-center gap-[5px] text-[11px] font-[600] px-[8px] py-[2px] rounded-full ml-[8px]"
              style={{ color: typeMeta.color, background: typeMeta.bg }}
            >
              <span>{typeMeta.icon}</span>
              <span>{typeMeta.label}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          <button
            className="border-none px-[15px] py-[8px] rounded-[8px] font-[600] text-[13px] cursor-pointer bg-transparent text-[var(--muted)] border border-[var(--border)]"
            style={{ border: '1px solid var(--border)' }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="border-none px-[15px] py-[8px] rounded-[8px] font-[600] text-[13px] cursor-pointer bg-transparent text-[var(--muted)]"
            style={{ border: '1px solid var(--border)' }}
            onClick={onSaveDraft}
          >
            Save draft
          </button>
          <button
            className="border-none px-[15px] py-[8px] rounded-[8px] font-[600] text-[13px] cursor-pointer text-white"
            style={{ background: 'var(--accent)' }}
            onClick={() => onContinue?.()}
          >
            Continue →
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex max-w-[1080px] mx-auto mt-[24px] gap-[24px] px-[22px]">
        <StepsRail
          steps={steps}
          activeStep={activeStep}
          onStep={onStep}
          accentColor={typeMeta.color}
          accentBg={typeMeta.bg}
        />

        <section className="flex-1 min-w-0">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[14px] shadow-[var(--shadow)] p-[22px]">
            {children}
          </div>
          {footer && <div className="mt-[16px]">{footer}</div>}
        </section>
      </div>
    </div>
  );
}
