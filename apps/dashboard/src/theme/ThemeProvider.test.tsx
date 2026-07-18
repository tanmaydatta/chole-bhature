import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';
function Probe(){ const { theme, toggle } = useTheme(); return <button onClick={toggle}>{theme}</button>; }
test('defaults to light and toggles + persists', () => {
  render(<ThemeProvider><Probe/></ThemeProvider>);
  expect(screen.getByRole('button')).toHaveTextContent('light');
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toHaveTextContent('dark');
  expect(localStorage.getItem('theme')).toBe('dark');
});
