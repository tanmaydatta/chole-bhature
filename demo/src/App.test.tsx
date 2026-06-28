import { render, screen } from '@testing-library/react';
import App from './App';
test('renders app placeholder', () => {
  render(<App />);
  expect(screen.getByText(/Incentives/i)).toBeInTheDocument();
});
