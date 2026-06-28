import { useTheme } from '../../theme/ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title="Toggle light / dark"
      className="w-[34px] h-[34px] rounded-[8px] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] cursor-pointer text-[15px] flex items-center justify-center"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
