import { expect, test } from 'vitest';

import * as paths from './paths.js';

test('builds the production invitation acceptance URL with only the opaque token', () => {
  const builder = (paths as { invitationAcceptanceUrl?: unknown }).invitationAcceptanceUrl;
  expect(builder).toBeTypeOf('function');
  if (typeof builder !== 'function') return;

  const link = new URL(builder('http://localhost:5173', 'a'.repeat(43)) as string);
  expect(link.origin).toBe('http://localhost:5173');
  expect(link.pathname).toBe(paths.INVITATION_ACCEPT_PATH);
  expect([...link.searchParams.keys()]).toEqual(['token']);
  expect(link.searchParams.get('token')).toBe('a'.repeat(43));
});
