interface Step {
  key: string;
  label: string;
}

interface StepsRailProps {
  steps: Step[];
  activeStep: string;
  onStep: (key: string) => void;
  accentColor: string;
  accentBg: string;
}

export function StepsRail({ steps, activeStep, onStep, accentColor, accentBg }: StepsRailProps) {
  const activeIndex = steps.findIndex((s) => s.key === activeStep);

  return (
    <nav className="w-[196px] flex-shrink-0 flex flex-col gap-[2px]">
      {steps.map((step, idx) => {
        const isDone = idx < activeIndex;
        const isActive = step.key === activeStep;

        const stepStyle = isActive
          ? { color: accentColor, background: accentBg }
          : isDone
          ? {}
          : {};

        const numberStyle = isActive
          ? { background: accentColor, borderColor: accentColor, color: '#fff' }
          : isDone
          ? { background: '#0f9d58', borderColor: '#0f9d58', color: '#fff' }
          : {};

        return (
          <div
            key={step.key}
            data-testid={`step-${step.key}`}
            className={[
              'flex gap-[10px] items-center px-[10px] py-[9px] rounded-[9px] cursor-pointer font-[500]',
              isActive ? 'font-[650]' : '',
              !isActive && !isDone ? 'text-[var(--muted)]' : '',
              isDone && !isActive ? 'text-[var(--ink)]' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={stepStyle}
            onClick={() => onStep(step.key)}
          >
            <span
              className="w-[20px] h-[20px] rounded-full border-[1.5px] border-current flex items-center justify-center text-[11px] flex-shrink-0"
              style={numberStyle}
            >
              {isDone ? '✓' : idx + 1}
            </span>
            <span>{step.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
