import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const realRepositoryRoot = path.resolve(import.meta.dirname, '../../..');
const runnerUrl = pathToFileURL(
  path.join(realRepositoryRoot, 'scripts/staging-wrangler-runner.mjs'),
).href;
const temporaryDirectories: string[] = [];

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STAGING_ENVIRONMENT: 'staging',
    STAGING_PRODUCT_D1_ID: 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1',
    STAGING_AUTH_D1_ID: '6a65017f-df57-474e-bebb-e676e09377e5',
    STAGING_OPERATOR_ORIGIN: 'https://operator.staging.example.com',
    STAGING_API_ORIGIN: 'https://api.staging.example.com',
    STAGING_PASSKEY_RP_ID: 'operator.staging.example.com',
    STAGING_ALLOWED_RECIPIENTS: '["operator@example.com"]',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('staging Wrangler executable resolution', () => {
  test('uses the selected app package-local Wrangler even with a hostile PATH', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'staging-runner-repository-'));
    temporaryDirectories.push(repositoryRoot);
    const wranglerPackage = path.join(repositoryRoot, 'apps/api/node_modules/wrangler');
    const wranglerBin = path.join(wranglerPackage, 'bin');
    const hostileBin = path.join(repositoryRoot, 'hostile-bin');
    const localCapture = path.join(repositoryRoot, 'local-capture.txt');
    const hostileCapture = path.join(repositoryRoot, 'hostile-capture.txt');
    await mkdir(wranglerBin, { recursive: true });
    await mkdir(hostileBin, { recursive: true });
    await writeFile(path.join(wranglerPackage, 'package.json'), '{"type":"module"}\n');
    await writeFile(
      path.join(wranglerBin, 'wrangler.js'),
      `import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(process.env.LOCAL_CAPTURE, 'local');
if (args[0] === 'd1' && args[1] === 'info') {
  process.stdout.write(JSON.stringify({ uuid: process.env.FAKE_PRODUCT_D1_ID }));
}
`,
    );
    for (const executable of ['wrangler', 'node', 'sh', 'sed', 'dirname', 'uname']) {
      const hostileExecutable = path.join(hostileBin, executable);
      await writeFile(
        hostileExecutable,
        `#!/bin/sh\nprintf hostile > "$HOSTILE_CAPTURE"\nexit 91\n`,
        { mode: 0o700 },
      );
      await chmod(hostileExecutable, 0o700);
    }
    const invocation = `
      import { runStagingWrangler } from ${JSON.stringify(runnerUrl)};
      process.exitCode = await runStagingWrangler({
        app: 'api',
        action: 'deploy',
        repositoryRoot: process.env.TEST_REPOSITORY_ROOT,
        environment: process.env,
      });
    `;

    await execFileAsync(process.execPath, ['--input-type=module', '--eval', invocation], {
      env: validEnvironment({
        TEST_REPOSITORY_ROOT: repositoryRoot,
        FAKE_PRODUCT_D1_ID: 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1',
        LOCAL_CAPTURE: localCapture,
        HOSTILE_CAPTURE: hostileCapture,
        PATH: `${hostileBin}${path.delimiter}${process.env.PATH ?? ''}`,
      }),
    });

    await expect(readFile(localCapture, 'utf8')).resolves.toBe('local');
    await expect(readFile(hostileCapture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('resolves app-local JavaScript entrypoints with the absolute Node executable', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'staging-resolver-repository-'));
    temporaryDirectories.push(repositoryRoot);
    for (const app of ['api', 'identity', 'operator-web']) {
      const bin = path.join(repositoryRoot, 'apps', app, 'node_modules/wrangler/bin');
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, 'wrangler.js'), '// fake Wrangler entrypoint\n');
    }
    const invocation = `
      import { resolveAppWranglerInvocation } from ${JSON.stringify(runnerUrl)};
      console.log(JSON.stringify({
        api: resolveAppWranglerInvocation(process.env.TEST_REPOSITORY_ROOT, 'api'),
        identity: resolveAppWranglerInvocation(process.env.TEST_REPOSITORY_ROOT, 'identity'),
        operator: resolveAppWranglerInvocation(process.env.TEST_REPOSITORY_ROOT, 'operator-web'),
      }));
    `;

    const result = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', invocation],
      { env: { ...process.env, TEST_REPOSITORY_ROOT: repositoryRoot } },
    );
    const resolved = JSON.parse(result.stdout) as {
      api: { command: string; argumentsPrefix: string[] };
      identity: { command: string; argumentsPrefix: string[] };
      operator: { command: string; argumentsPrefix: string[] };
    };

    expect(resolved.api).toEqual({
      command: process.execPath,
      argumentsPrefix: [
        path.join(repositoryRoot, 'apps/api/node_modules/wrangler/bin/wrangler.js'),
      ],
    });
    expect(resolved.identity).toEqual({
      command: process.execPath,
      argumentsPrefix: [
        path.join(repositoryRoot, 'apps/identity/node_modules/wrangler/bin/wrangler.js'),
      ],
    });
    expect(resolved.operator).toEqual({
      command: process.execPath,
      argumentsPrefix: [
        path.join(repositoryRoot, 'apps/operator-web/node_modules/wrangler/bin/wrangler.js'),
      ],
    });
  });

  test('rejects a selected-app Wrangler entrypoint that is not a regular readable file', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'staging-invalid-wrangler-'));
    temporaryDirectories.push(repositoryRoot);
    await mkdir(
      path.join(repositoryRoot, 'apps/api/node_modules/wrangler/bin/wrangler.js'),
      { recursive: true },
    );
    const invocation = `
      import { runStagingWrangler } from ${JSON.stringify(runnerUrl)};
      process.exitCode = await runStagingWrangler({
        app: 'api',
        action: 'deploy',
        repositoryRoot: process.env.TEST_REPOSITORY_ROOT,
        environment: process.env,
      });
    `;

    await expect(execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', invocation],
      {
        env: validEnvironment({ TEST_REPOSITORY_ROOT: repositoryRoot }),
      },
    )).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(
        /^Staging configuration invalid: Selected app Wrangler entrypoint must be a readable regular file\./,
      ),
    });
  });
});
