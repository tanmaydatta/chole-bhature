import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import App from './App';
test('bootstraps the operator shell into the signed-out state', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    error: {
      code: 'UNAUTHORIZED', message: 'Authentication is required',
      correlationId: 'corr-app-test', retryable: false,
    },
  }, { status: 401 }));
  render(
    <ThemeProvider>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </ThemeProvider>
  );
  expect(await screen.findByRole('heading', { name: 'Sign in to Incentives' })).toBeInTheDocument();
});
