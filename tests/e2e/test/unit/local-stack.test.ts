import { describe, expect, test } from 'vitest';

import { localStackConfiguration } from '../../src/local-stack.js';

const ports = { core: 20101, identity: 20102, operator: 20103,
  coreInspector: 20104, identityInspector: 20105, operatorInspector: 20106 };

describe('isolated local Worker stack', () => {
  test('namespaces names, origins, D1 persistence and secrets per suite', () => {
    const first = localStackConfiguration('/repo', '/private/tmp/first',
      'e2e_aaaaaaaaaaaaaaaaaaaaaaaa', ports);
    const second = localStackConfiguration('/repo', '/private/tmp/second',
      'e2e_bbbbbbbbbbbbbbbbbbbbbbbb', { ...ports, core: 20201,
        identity: 20202, operator: 20203 });
    expect(first.operatorOrigin).toBe('http://localhost:20103');
    expect(first.coreConfig.name).not.toBe(second.coreConfig.name);
    expect(first.identityConfig.services[0].service).toBe(first.coreConfig.name);
    expect(first.operatorConfig.services[0].service).toBe(first.identityConfig.name);
    expect(first.operatorConfig.services[2].service).toBe(first.coreConfig.name);
    expect(first.identityConfig.vars.PUBLIC_APP_ORIGIN).toBe(first.operatorOrigin);
    expect(first.persistTo).not.toBe(second.persistTo);
    expect(first.identityConfig.d1_databases[0].migrations_dir).toBe('/repo/apps/identity/migrations');
    expect(first.operatorConfig.assets.directory).toBe('/repo/apps/dashboard/dist');
  });

  test('rejects a non-local or non-loopback target and malformed run ID', () => {
    expect(() => localStackConfiguration('/repo', '/private/tmp/first',
      'e2e_aaaaaaaaaaaaaaaaaaaaaaaa', ports, 'staging')).toThrow(/local/u);
    expect(() => localStackConfiguration('/repo', '/private/tmp/first',
      'foreign', ports)).toThrow();
  });
});
