import { ThemeToggle } from './ThemeToggle';

interface TopBarProps {
  title: string;
  onSignOut?: () => void;
}

export function TopBar({ title, onSignOut }: TopBarProps) {
  return (
    <header className="flex items-center justify-between px-[26px] py-[14px] border-b border-[var(--border)] bg-[var(--panel)] sticky top-0 z-[5]">
      <h1 className="text-[17px] m-0 font-[650]">{title}</h1>
      <div className="flex items-center gap-[14px]">
        <ThemeToggle />
        {onSignOut && <button type="button" className="rounded-[7px] border border-[var(--border)] px-3 py-1.5 text-[12px] font-semibold" onClick={onSignOut}>Sign out</button>}
      </div>
    </header>
  );
}
