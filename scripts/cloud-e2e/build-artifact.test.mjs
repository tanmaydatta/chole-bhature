import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import * as producer from './build-artifact.mjs';
import { verifyBundleV1 } from './artifact.mjs';

const run = promisify(execFile);
const key = { repository_id: 42, repository: 'acme/incentives', pr: 7, head_sha: 'a'.repeat(40), run_id: 99, attempt: 3 };
const moduleBytes = Buffer.from('export default {};\n// raw module: café\n');
const roles = [
  { role: 'api', filter: '@incentives/api', config: 'apps/api/wrangler.toml', output: 'workers/api.mjs' },
  { role: 'identity', filter: '@incentives/identity', config: 'apps/identity/wrangler.toml', output: 'workers/identity.mjs' },
  { role: 'operator', filter: '@incentives/operator-web', config: 'apps/operator-web/wrangler.toml', output: 'workers/operator.mjs' },
];

async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cloud-e2e-producer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

for (const { role, filter, config, output } of roles) {
  test(`collects ${role} raw module bytes using its fixed config, never upload FormData`, async t => {
    const root = await temporary(t);
    const checkout = path.join(root, 'checkout');
    const outdir = path.join(root, role);
    assert.equal(typeof producer.collectWorkerModule, 'function');
    const result = await producer.collectWorkerModule({ checkout, temporary: root, role, execute: async (command, args, options) => {
      assert.equal(command, 'pnpm');
      assert.deepEqual(args, ['--filter', filter, 'exec', 'wrangler', 'deploy', '--dry-run', '--config', path.join(checkout, config), '--outdir', outdir]);
      assert.deepEqual(options, { cwd: checkout, maxBuffer: 10 * 1024 * 1024 });
      await writeFile(path.join(outdir, 'worker.js'), moduleBytes);
      await writeFile(path.join(outdir, 'worker.js.map'), 'not runtime bytes');
      await writeFile(path.join(outdir, 'README.md'), 'Wrangler sidecar');
    } });
    assert.equal(result.path, output);
    assert.deepEqual(result.bytes, Buffer.from('export default {};\n// raw module: café\n'));
  });
}

const refusals = [
  ['absent worker.js', async () => {}],
  ['directory worker.js', async directory => mkdir(path.join(directory, 'worker.js'))],
  ['symlink worker.js', async directory => { await writeFile(path.join(directory, 'target.js'), moduleBytes); await symlink('target.js', path.join(directory, 'worker.js')); }],
  ['extra runtime module', async directory => { await writeFile(path.join(directory, 'worker.js'), moduleBytes); await writeFile(path.join(directory, 'chunk.js'), 'export {};'); }],
  ['extra runtime resource', async directory => { await writeFile(path.join(directory, 'worker.js'), moduleBytes); await writeFile(path.join(directory, 'module.wasm'), Buffer.from([0, 97, 115, 109])); }],
  ['directory sidecar', async directory => { await writeFile(path.join(directory, 'worker.js'), moduleBytes); await mkdir(path.join(directory, 'worker.js.map')); }],
  ['symlink sidecar', async directory => { await writeFile(path.join(directory, 'worker.js'), moduleBytes); await symlink('worker.js', path.join(directory, 'README.md')); }],
  ['unexpected map', async directory => { await writeFile(path.join(directory, 'worker.js'), moduleBytes); await writeFile(path.join(directory, 'chunk.js.map'), '{}'); }],
];
for (const [name, populate] of refusals) {
  test(`refuses ${name} rather than losing runtime inputs`, async t => {
    const root = await temporary(t);
    assert.equal(typeof producer.collectWorkerModule, 'function');
    await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async () => populate(path.join(root, 'api')) }), /worker\.js|regular|symbolic|unexpected/i);
  });
}

test('refuses unknown roles before executing a process or selecting paths', async t => {
  const root = await temporary(t);
  assert.equal(typeof producer.collectWorkerModule, 'function');
  for (const role of ['other', '../api', 'toString', undefined]) {
    await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role, execute: async () => assert.fail('invalid role reached execution') }), /role/i);
  }
});

test('refuses stale output before execution and propagates a failed dry run', async t => {
  const root = await temporary(t);
  assert.equal(typeof producer.collectWorkerModule, 'function');
  await mkdir(path.join(root, 'api'));
  await writeFile(path.join(root, 'api/worker.js'), moduleBytes);
  await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async () => assert.fail('stale directory reached execution') }), /exist/i);
  await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'identity', execute: async () => {
    await writeFile(path.join(root, 'identity/worker.js'), moduleBytes);
    throw new Error('dry run failed');
  } }), /dry run failed/);
});

// Exercise createBundleV1 unchanged: only the external pnpm process is replaced.
async function bundleFixture(t, mode) {
  const root = await temporary(t);
  const checkout = path.join(root, 'checkout');
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  for (const directory of ['apps/dashboard/dist', 'apps/api/migrations', 'apps/identity/migrations']) await mkdir(path.join(checkout, directory), { recursive: true });
  await writeFile(path.join(checkout, 'apps/dashboard/dist/index.html'), '<title>exact SPA</title>\n');
  await writeFile(path.join(checkout, 'apps/api/migrations/0001.sql'), 'select 1;\n');
  await writeFile(path.join(checkout, 'apps/identity/migrations/0001.sql'), 'select 2;\n');
  await writeFile(path.join(bin, 'pnpm'), `#!/usr/bin/env node
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const outdir = args[args.indexOf('--outdir') + 1];
const outfile = args[args.indexOf('--outfile') + 1];
if (args.includes('--outfile')) await writeFile(outfile, '------formdata-undici-012345678901\\r\\nContent-Disposition: form-data; name="metadata"\\r\\n\\r\\n{"main_module":"worker.js"}\\r\\n');
if (args.includes('--outdir')) {
  const mode = ${JSON.stringify(mode)};
  if (mode === 'failed') throw new Error('dry run failed');
  if (mode === 'directory') await mkdir(path.join(outdir, 'worker.js'));
  else if (mode === 'symlink') await symlink('../missing.js', path.join(outdir, 'worker.js'));
  else if (mode !== 'absent') await writeFile(path.join(outdir, 'worker.js'), 'export default {};\\n');
  if (mode === 'extra') await writeFile(path.join(outdir, 'chunk.js'), 'export {};\\n');
  if (mode === 'valid') { await writeFile(path.join(outdir, 'worker.js.map'), '{}'); await writeFile(path.join(outdir, 'README.md'), 'sidecar'); }
}
`, { mode: 0o700 });
  const outputDir = path.join(root, 'artifact');
  const source = `import { createBundleV1 } from ${JSON.stringify(new URL('./build-artifact.mjs', import.meta.url).href)}; await createBundleV1(${JSON.stringify({ key, checkout, outputDir })});`;
  return { root, outputDir, build: () => run(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } }) };
}

for (const mode of ['absent', 'directory', 'symlink', 'extra', 'failed']) {
  test(`createBundleV1 emits no archive after ${mode} module output`, async t => {
    const input = await bundleFixture(t, mode);
    await assert.rejects(input.build());
    await assert.rejects(lstat(path.join(input.outputDir, 'bundle.tar')), error => error?.code === 'ENOENT');
  });
}

test('createBundleV1 archives only selected modules and exact SPA/SQL bytes', async t => {
  const input = await bundleFixture(t, 'valid');
  await input.build();
  const verified = await verifyBundleV1({ archive: path.join(input.outputDir, 'bundle.tar'), expectedKey: key, expectedRun: { run_id: 99, attempt: 3 }, destination: path.join(input.root, 'verified') });
  assert.deepEqual(verified.files.map(file => path.relative(path.join(input.root, 'verified'), file.path)), ['assets/index.html', 'migrations/api/0001.sql', 'migrations/identity/0001.sql', 'workers/api.mjs', 'workers/identity.mjs', 'workers/operator.mjs']);
  for (const role of ['api', 'identity', 'operator']) assert.deepEqual(await readFile(path.join(input.root, 'verified/workers', `${role}.mjs`)), Buffer.from('export default {};\n'));
  assert.deepEqual(await readFile(path.join(input.root, 'verified/assets/index.html')), Buffer.from('<title>exact SPA</title>\n'));
  assert.deepEqual(await readFile(path.join(input.root, 'verified/migrations/api/0001.sql')), Buffer.from('select 1;\n'));
  assert.deepEqual(await readFile(path.join(input.root, 'verified/migrations/identity/0001.sql')), Buffer.from('select 2;\n'));
});
