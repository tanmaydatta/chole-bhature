import { describe, expect, test } from 'vitest';

import { runConnectorConformanceSuite } from './index.js';
import { createDocumentationConnectorHarness } from '../test-fixtures/documentation-example.js';

describe('connector conformance documentation example', () => {
  test('passes the public conformance runner and records the canonical recipe', async () => {
    const { connector, fixture } = createDocumentationConnectorHarness();

    await expect(runConnectorConformanceSuite(connector, fixture)).resolves.toEqual({
      passed: true,
    });
    expect(fixture.trace).toEqual(['evaluate', 'map', 'apply', 'commit', 'capture']);
  });
});
