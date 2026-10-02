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

function buildMetadata(checkout, output, bytes = moduleBytes.length, imports = []) {
  const projectRoot = path.join(checkout, 'apps/api');
  return { inputs: { 'src/worker.ts': { bytes: 42, imports: [], format: 'esm' } }, outputs: {
    [path.relative(projectRoot, path.join(output, 'worker.js'))]: { imports, exports: ['default'], entryPoint: 'src/worker.ts', inputs: { 'src/worker.ts': { bytesInOutput: bytes } }, bytes },
  } };
}

async function writeMetadata(args, metadata) {
  await writeFile(args[args.indexOf('--metafile') + 1], JSON.stringify(metadata));
}

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
      assert.deepEqual(args, ['--filter', filter, 'exec', 'wrangler', 'deploy', '--dry-run', '--config', path.join(checkout, config), '--outdir', outdir, '--metafile', path.join(root, `${role}-metadata/build.json`)]);
      assert.deepEqual(options, { cwd: checkout, maxBuffer: 10 * 1024 * 1024 });
      await writeFile(path.join(outdir, 'worker.js'), moduleBytes);
      await writeFile(path.join(outdir, 'worker.js.map'), 'not runtime bytes');
      await writeFile(path.join(outdir, 'README.md'), 'Wrangler sidecar');
      const metadata = buildMetadata(checkout, outdir);
      const main = Object.values(metadata.outputs)[0];
      metadata.outputs = {
        [path.relative(path.dirname(path.join(checkout, config)), path.join(outdir, 'worker.js'))]: main,
        [path.relative(path.dirname(path.join(checkout, config)), path.join(outdir, 'worker.js.map'))]: { imports: [], exports: [], inputs: {}, bytes: 17 },
      };
      await writeMetadata(args, metadata);
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

for (const resource of ['README.md', 'worker.js.map']) {
  test(`refuses observed external runtime ${resource} even though its filename resembles a generated sidecar`, async t => {
    const root = await temporary(t);
    const output = path.join(root, 'api');
    const bytes = Buffer.from(`import message from "./${resource}";\nexport default { fetch() { return new Response(message); } };\n`);
    await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async (_command, args) => {
      await writeFile(path.join(output, 'worker.js'), bytes);
      await writeFile(path.join(output, resource), 'runtime text');
      if (args.includes('--metafile')) await writeMetadata(args, buildMetadata(root, output, bytes.length, [{ path: `./${resource}`, kind: 'import-statement', external: true }]));
    } }), /runtime|import|dependency/i);
  });
}

test('retains exact module bytes with observed platform imports instead of treating them as files', async t => {
  const root = await temporary(t);
  const output = path.join(root, 'api');
  const bytes = Buffer.from('import { WorkerEntrypoint } from "cloudflare:workers";\nimport { createHash } from "node:crypto";\nexport default WorkerEntrypoint;\n');
  const result = await producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async (_command, args) => {
    await writeFile(path.join(output, 'worker.js'), bytes);
    if (args.includes('--metafile')) await writeMetadata(args, buildMetadata(root, output, bytes.length, [{ path: 'cloudflare:workers', kind: 'import-statement', external: true }, { path: 'node:crypto', kind: 'import-statement', external: true }]));
  } });
  assert.equal(result.path, 'workers/api.mjs');
  assert.deepEqual(result.bytes, Buffer.from('import { WorkerEntrypoint } from "cloudflare:workers";\nimport { createHash } from "node:crypto";\nexport default WorkerEntrypoint;\n'));
});

test('preserves the observed dynamic node:async_hooks platform dependency', async t => {
  const root = await temporary(t);
  const output = path.join(root, 'identity');
  const bytes = Buffer.from('await import("node:async_hooks");\nexport default {};\n');
  const result = await producer.collectWorkerModule({ checkout: root, temporary: root, role: 'identity', execute: async (_command, args) => {
    await writeFile(path.join(output, 'worker.js'), bytes);
    const metadata = buildMetadata(root, output, bytes.length, [{ path: 'node:async_hooks', kind: 'dynamic-import', external: true }]);
    metadata.outputs = { [path.relative(path.join(root, 'apps/identity'), path.join(output, 'worker.js'))]: Object.values(metadata.outputs)[0] };
    await writeMetadata(args, metadata);
  } });
  assert.equal(result.path, 'workers/identity.mjs');
  assert.deepEqual(result.bytes, Buffer.from('await import("node:async_hooks");\nexport default {};\n'));
});

const invalidMetadata = [
  ['missing metadata', async () => {}],
  ['directory metadata', async file => mkdir(file)],
  ['symlink metadata', async file => symlink('../api/worker.js', file)],
  ['malformed JSON', async file => writeFile(file, '{')],
  ['missing outputs', async file => writeFile(file, '{"inputs":{}}')],
  ['missing inputs', async file => writeFile(file, '{"outputs":{}}')],
  ['missing main association', (_file, meta) => { meta.outputs = {}; }],
  ['wrong main association', (_file, meta) => { const main = Object.values(meta.outputs)[0]; meta.outputs = { 'other.js': main }; }],
  ['missing entry point', (_file, meta) => { delete Object.values(meta.outputs)[0].entryPoint; }],
  ['missing imports', (_file, meta) => { delete Object.values(meta.outputs)[0].imports; }],
  ['wrong byte count', (_file, meta) => { Object.values(meta.outputs)[0].bytes = 1; }],
  ['incomplete input association', (_file, meta) => { meta.inputs = {}; }],
  ['incomplete source input bytes', (_file, meta) => { delete meta.inputs['src/worker.ts'].bytes; }],
  ['incomplete source input imports', (_file, meta) => { delete meta.inputs['src/worker.ts'].imports; }],
  ['missing main inputs', (_file, meta) => { delete Object.values(meta.outputs)[0].inputs; }],
  ['malformed output object', (_file, meta) => { meta.outputs[Object.keys(meta.outputs)[0]] = null; }],
  ['missing output exports', (_file, meta) => { delete Object.values(meta.outputs)[0].exports; }],
  ['malformed import', (_file, meta) => { Object.values(meta.outputs)[0].imports = [{ path: 'node:crypto', external: true }]; }],
  ['nonexternal platform import', (_file, meta) => { Object.values(meta.outputs)[0].imports = [{ path: 'node:crypto', kind: 'import-statement', external: false }]; }],
  ['unknown node-like import', (_file, meta) => { Object.values(meta.outputs)[0].imports = [{ path: 'node:README.md', kind: 'import-statement', external: true }]; }],
  ['unknown cloudflare-like import', (_file, meta) => { Object.values(meta.outputs)[0].imports = [{ path: 'cloudflare:README.md', kind: 'import-statement', external: true }]; }],
  ['unexpected metadata output', (_file, meta) => { meta.outputs['chunk.js'] = { imports: [], exports: [], inputs: {}, bytes: 0 }; }],
  ['map absent on disk', (_file, meta, root) => { meta.outputs[path.relative(path.join(root, 'apps/api'), path.join(root, 'api/worker.js.map'))] = { imports: [], exports: [], inputs: {}, bytes: 0 }; }],
];
for (const [name, change] of invalidMetadata) {
  test(`refuses ${name} rather than trusting incomplete build metadata`, async t => {
    const root = await temporary(t);
    const output = path.join(root, 'api');
    await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async (_command, args) => {
      await writeFile(path.join(output, 'worker.js'), moduleBytes);
      if (!args.includes('--metafile')) return;
      const file = args[args.indexOf('--metafile') + 1];
      const metadata = buildMetadata(root, output);
      await change(file, metadata, root);
      if (!['missing metadata', 'directory metadata', 'symlink metadata', 'malformed JSON', 'missing outputs', 'missing inputs'].includes(name)) await writeMetadata(args, metadata);
    } }), /metadata|regular|import|runtime|output|bytes|ENOENT|JSON/i);
  });
}

for (const corruption of ['missing map metadata', 'runtime map metadata', 'wrong map byte count']) {
  test(`refuses ${corruption} rather than excluding an unproved map sidecar`, async t => {
    const root = await temporary(t);
    const output = path.join(root, 'api');
    await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async (_command, args) => {
      await writeFile(path.join(output, 'worker.js'), moduleBytes);
      await writeFile(path.join(output, 'worker.js.map'), '{}');
      if (!args.includes('--metafile')) return;
      const metadata = buildMetadata(root, output);
      if (corruption !== 'missing map metadata') metadata.outputs[path.relative(path.join(root, 'apps/api'), path.join(output, 'worker.js.map'))] = { imports: corruption === 'runtime map metadata' ? [{ path: './README.md', kind: 'import-statement', external: true }] : [], exports: [], inputs: {}, bytes: corruption === 'wrong map byte count' ? 10 : 2 };
      await writeMetadata(args, metadata);
    } }), /metadata|map|output|bytes|runtime/i);
  });
}

test('refuses stale metadata before executing a process', async t => {
  const root = await temporary(t);
  await mkdir(path.join(root, 'api-metadata'));
  await writeFile(path.join(root, 'api-metadata/build.json'), '{}');
  let executed = false;
  await assert.rejects(producer.collectWorkerModule({ checkout: root, temporary: root, role: 'api', execute: async () => {
    executed = true;
    await writeFile(path.join(root, 'api/worker.js'), moduleBytes);
  } }), error => error?.code === 'EEXIST');
  assert.equal(executed, false);
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
const metafile = args[args.indexOf('--metafile') + 1];
if (args.includes('--outfile')) await writeFile(outfile, '------formdata-undici-012345678901\\r\\nContent-Disposition: form-data; name="metadata"\\r\\n\\r\\n{"main_module":"worker.js"}\\r\\n');
if (args.includes('--outdir')) {
  const mode = ${JSON.stringify(mode)};
  const collision = mode === 'readme-collision' || mode === 'map-collision';
  const resource = mode === 'readme-collision' ? 'README.md' : 'worker.js.map';
  const source = collision ? 'import message from "./' + resource + '";\\nexport default {};\\n' : 'export default {};\\n';
  if (mode === 'failed') throw new Error('dry run failed');
  if (mode === 'directory') await mkdir(path.join(outdir, 'worker.js'));
  else if (mode === 'symlink') await symlink('../missing.js', path.join(outdir, 'worker.js'));
  else if (mode !== 'absent') await writeFile(path.join(outdir, 'worker.js'), source);
  if (mode === 'extra') await writeFile(path.join(outdir, 'chunk.js'), 'export {};\\n');
  if (mode === 'valid') { await writeFile(path.join(outdir, 'worker.js.map'), '{}'); await writeFile(path.join(outdir, 'README.md'), 'sidecar'); }
  if (collision) await writeFile(path.join(outdir, resource), 'runtime text');
  if (args.includes('--metafile')) {
    const projectRoot = path.dirname(args[args.indexOf('--config') + 1]);
    const outputs = { [path.relative(projectRoot, path.join(outdir, 'worker.js'))]: { imports: collision ? [{ path: './' + resource, kind: 'import-statement', external: true }] : [], exports: ['default'], entryPoint: 'src/worker.ts', inputs: { 'src/worker.ts': { bytesInOutput: Buffer.byteLength(source) } }, bytes: Buffer.byteLength(source) } };
    if (mode === 'valid') outputs[path.relative(projectRoot, path.join(outdir, 'worker.js.map'))] = { imports: [], exports: [], inputs: {}, bytes: 2 };
    await writeFile(metafile, JSON.stringify({ inputs: { 'src/worker.ts': { bytes: 19, imports: [], format: 'esm' } }, outputs }));
  }
}
`, { mode: 0o700 });
  const outputDir = path.join(root, 'artifact');
  const source = `import { createBundleV1 } from ${JSON.stringify(new URL('./build-artifact.mjs', import.meta.url).href)}; await createBundleV1(${JSON.stringify({ key, checkout, outputDir })});`;
  return { root, outputDir, build: () => run(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } }) };
}

for (const mode of ['absent', 'directory', 'symlink', 'extra', 'failed', 'readme-collision', 'map-collision']) {
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
