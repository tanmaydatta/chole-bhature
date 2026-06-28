interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  bar?: number;
}

export function StatCard({ label, value, delta, bar }: StatCardProps) {
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[12px] px-[16px] py-[15px] shadow-[var(--shadow)]">
      <div className="text-[var(--muted)] text-[12px] font-medium">{label}</div>
      <div className="text-[24px] font-bold mt-[7px] tracking-[-0.02em]">{value}</div>
      {delta !== undefined && (
        <div className="text-[12px] mt-[5px] text-[var(--green)] font-semibold">{delta}</div>
      )}
      {bar !== undefined && (
        <div className="h-[6px] rounded-full bg-[var(--hover)] mt-[9px] overflow-hidden">
          <i
            className="block h-full bg-[var(--accent)] not-italic"
            style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
          />
        </div>
      )}
    </div>
  );
}
