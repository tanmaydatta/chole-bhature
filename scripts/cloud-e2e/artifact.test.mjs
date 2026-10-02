import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyBundleV1 } from './artifact.mjs';
import { provisionMockStack } from './provision.mjs';

const key = Object.freeze({
  repository_id: 42,
  repository: 'acme/incentives',
  pr: 7,
  head_sha: 'a'.repeat(40),
  run_id: 99,
  attempt: 3,
});

const requiredFiles = Object.freeze({
  'workers/api.mjs': 'export default { fetch() { return new Response("api"); } };\n',
  'workers/identity.mjs': 'export default { fetch() { return new Response("identity"); } };\n',
  'workers/operator.mjs': 'export default { fetch() { return new Response("operator"); } };\n',
  'assets/index.html': '<!doctype html><title>Operator</title>\n',
  'migrations/api/0001_init.sql': 'create table api_table (id text);\n',
  'migrations/identity/0001_init.sql': 'create table identity_table (id text);\n',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function tarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0);
  Buffer.from('0000644\0').copy(header, 100);
  Buffer.from('0000000\0').copy(header, 108);
  Buffer.from('0000000\0').copy(header, 116);
  Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(header, 124);
  Buffer.from('00000000000\0').copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  Buffer.from('ustar\0').copy(header, 257);
  Buffer.from('00').copy(header, 263);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);
  return header;
}

function createTar(entries) {
  const blocks = [];
  for (const { name, body, type } of entries) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    blocks.push(tarHeader(name, bytes.length, type));
    blocks.push(bytes);
    blocks.push(Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function manifestFor(files, overrides = {}) {
  return {
    schema: 1,
    key,
    build_sha: key.head_sha,
    run: { run_id: key.run_id, attempt: key.attempt },
    files: Object.entries(files).map(([filePath, contents]) => ({
      path: filePath,
      size: Buffer.byteLength(contents),
      sha256: sha256(contents),
    })),
    ...overrides,
  };
}

async function fixture({ files = requiredFiles, manifest = manifestFor(files), entries } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cloud-e2e-artifact-'));
  const archive = path.join(root, 'bundle.tar');
  await writeFile(archive, createTar(entries ?? [
    { name: 'manifest.json', body: JSON.stringify(manifest) },
    ...Object.entries(files).map(([name, body]) => ({ name, body })),
  ]));
  return { root, archive, destination: path.join(root, 'extracted') };
}

function cloudflareSpy() {
  const calls = [];
  return {
    calls,
    async provision(verified) {
      calls.push(verified);
    },
  };
}

async function provisionAfterVerification(input, cloudflare) {
  const verified = await verifyBundleV1({ ...input, expectedKey: key, expectedRun: { run_id: key.run_id, attempt: key.attempt } });
  await cloudflare.provision(verified);
  return verified;
}

async function expectRejected(input, pattern) {
  const cloudflare = cloudflareSpy();
  await assert.rejects(
    provisionAfterVerification(input, cloudflare),
    pattern,
  );
  assert.deepEqual(cloudflare.calls, []);
  await assert.rejects(lstat(input.destination), error => error?.code === 'ENOENT');
}

test('verifies the exact manifest, hashes, StackKeyV1, and producing run identity', async (t) => {
  const input = await fixture();
  t.after(() => rm(input.root, { recursive: true, force: true }));

  const cloudflare = cloudflareSpy();
  const verified = await provisionAfterVerification(input, cloudflare);

  assert.deepEqual(cloudflare.calls, [verified]);
  assert.deepEqual(verified.key, key);
  assert.equal(verified.buildSha, key.head_sha);
  assert.equal(verified.run.run_id, key.run_id);
  assert.equal(verified.files.length, Object.keys(requiredFiles).length);
  for (const file of verified.files) {
    assert.equal(path.isAbsolute(file.path), true);
    assert.match(file.path, new RegExp(`^${input.destination.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/`));
    assert.equal(file.sha256, sha256(await readFile(file.path)));
  }
});

test('rejects altered bytes before extracting or making a Cloudflare call', async (t) => {
  const alteredApi = Buffer.from(requiredFiles['workers/api.mjs']);
  alteredApi[0] ^= 1;
  const files = { ...requiredFiles, 'workers/api.mjs': alteredApi };
  const input = await fixture({ files, manifest: manifestFor(requiredFiles) });
  t.after(() => rm(input.root, { recursive: true, force: true }));

  await expectRejected(input, /hash|SHA-256/i);
});

for (const worker of ['workers/api.mjs', 'workers/identity.mjs', 'workers/operator.mjs']) {
  test(`rejects checksum-valid serialized multipart ${worker} before extraction or controller transport`, async t => {
    const multipart = '------formdata-undici-012345678901\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"main_module":"worker.js","bindings":[]}\r\n------formdata-undici-012345678901\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\nexport default {};\r\n------formdata-undici-012345678901--';
    const input = await fixture({ files: { ...requiredFiles, [worker]: multipart } });
    t.after(() => rm(input.root, { recursive: true, force: true }));
    await assert.rejects(verifyBundleV1({ ...input, expectedKey: key, expectedRun: { run_id: 99, attempt: 3 } }), /multipart|serialized/i);
    await assert.rejects(lstat(input.destination), error => error?.code === 'ENOENT');
    const calls = [];
    const result = await provisionMockStack({ key, accountId: 'account-1', ...input, provider: {
      async request(value) { calls.push(value); throw new Error('unexpected transport'); },
      async observe(value) { calls.push(value); throw new Error('unexpected observation'); },
    }, store: { async put(value) { calls.push(value); } }, now: () => '2026-10-02T09:00:00.000Z' });
    assert.equal(result.status, 'quarantined');
    assert.equal(result.cleanup.status, 'not-started');
    assert.deepEqual(calls, []);
    await assert.rejects(lstat(input.destination), error => error?.code === 'ENOENT');
  });
}

test('accepts legitimate modules containing multipart-related strings as data', async t => {
  const source = 'const boundary = "------formdata-undici-012345678901";\nconst type = "multipart/form-data";\nconst header = \'Content-Disposition: form-data; name="metadata"\';\nexport default {};\n';
  const files = { ...requiredFiles, 'workers/operator.mjs': source };
  const input = await fixture({ files });
  t.after(() => rm(input.root, { recursive: true, force: true }));
  await verifyBundleV1({ ...input, expectedKey: key, expectedRun: { run_id: 99, attempt: 3 } });
  assert.deepEqual(await readFile(path.join(input.destination, 'workers/operator.mjs')), Buffer.from(source));
});

test('rejects stale build SHA and producing run identity', async (t) => {
  const staleSha = await fixture({ manifest: manifestFor(requiredFiles, { build_sha: 'b'.repeat(40) }) });
  const staleRun = await fixture({ manifest: manifestFor(requiredFiles, { run: { run_id: 100, attempt: 3 } }) });
  t.after(async () => {
    await rm(staleSha.root, { recursive: true, force: true });
    await rm(staleRun.root, { recursive: true, force: true });
  });

  await expectRejected(staleSha, /build SHA/i);
  await expectRejected(staleRun, /run identity/i);
});

test('rejects untrusted configuration and command files', async (t) => {
  const files = { ...requiredFiles, 'wrangler.toml': 'name = "attacker"\n' };
  const input = await fixture({ files });
  t.after(() => rm(input.root, { recursive: true, force: true }));

  await expectRejected(input, /not allowed|unexpected/i);
});

test('rejects symlink, traversal, absolute, and duplicate archive paths', async (t) => {
  const manifest = manifestFor(requiredFiles);
  const cases = [
    { name: 'assets/link.mjs', body: '', type: '2', pattern: /regular|link/i },
    { name: '../workers/api.mjs', body: 'x', pattern: /path/i },
    { name: '/workers/api.mjs', body: 'x', pattern: /path/i },
    { name: 'workers/api.mjs', body: requiredFiles['workers/api.mjs'], pattern: /duplicate/i },
  ];
  for (const malicious of cases) {
    const input = await fixture({ entries: [
      { name: 'manifest.json', body: JSON.stringify(manifest) },
      ...Object.entries(requiredFiles).map(([name, body]) => ({ name, body })),
      malicious,
    ] });
    t.after(() => rm(input.root, { recursive: true, force: true }));
    await expectRejected(input, malicious.pattern);
  }
});

test('rejects unlisted files and payloads exceeding file, migration, or total caps', async (t) => {
  const extra = await fixture({ files: { ...requiredFiles, 'assets/extra.bin': 'extra' }, manifest: manifestFor(requiredFiles) });
  const oversizedFile = { ...requiredFiles, 'assets/large.bin': 'x'.repeat(20 * 1024 * 1024 + 1) };
  const oversizedMigration = { ...requiredFiles, 'migrations/api/large.sql': 'x'.repeat(1024 * 1024 + 1) };
  const oversizedTotal = { ...requiredFiles };
  for (let index = 0; index < 65; index += 1) oversizedTotal[`assets/${index}.bin`] = 'x'.repeat(1024 * 1024);
  const fileInput = await fixture({ files: oversizedFile });
  const migrationInput = await fixture({ files: oversizedMigration });
  const totalInput = await fixture({ files: oversizedTotal });
  t.after(async () => Promise.all([extra, fileInput, migrationInput, totalInput].map(input => rm(input.root, { recursive: true, force: true }))));

  await expectRejected(extra, /unlisted|manifest/i);
  await expectRejected(fileInput, /20 MiB/i);
  await expectRejected(migrationInput, /migration|1 MiB/i);
  await expectRejected(totalInput, /64 MiB/i);
});
