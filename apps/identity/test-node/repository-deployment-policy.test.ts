import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

describe('repository deployment policy', () => {
  test('runs repository verification without granting or invoking Cloudflare writes', async () => {
    const workflow = await readFile(
      path.join(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('branches: [dev]');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).toContain('pnpm build');
    expect(workflow).toContain('pnpm lint');
    expect(workflow).toContain('pnpm test');
    expect(workflow).not.toMatch(/wrangler|deploy:staging|CLOUDFLARE_/iu);
  });
});
