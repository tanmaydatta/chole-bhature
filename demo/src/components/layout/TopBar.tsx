import { ThemeToggle } from './ThemeToggle';
import { ClientSwitcher } from './ClientSwitcher';

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="flex items-center justify-between px-[26px] py-[14px] border-b border-[var(--border)] bg-[var(--panel)] sticky top-0 z-[5]">
      <h1 className="text-[17px] m-0 font-[650]">{title}</h1>
      <div className="flex items-center gap-[14px]">
        <ThemeToggle />
        <ClientSwitcher />
      </div>
    </header>
  );
}
