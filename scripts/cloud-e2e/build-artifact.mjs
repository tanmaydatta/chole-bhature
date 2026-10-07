import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { artifactLimits } from './artifact.mjs';
import { parseStackKey } from './key.mjs';

const execute = promisify(execFile);
const workerApps = Object.freeze([
  ['api', 'apps/api/wrangler.toml'],
  ['identity', 'apps/identity/wrangler.toml'],
  ['operator', 'apps/operator-web/wrangler.toml'],
]);
const safePart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
// Observed external platform imports in the pinned three-Worker build. New
// specifiers require characterization; a namespace prefix alone is not proof.
const platformImports = new Set(['cloudflare:workers', 'node:crypto', 'node:async_hooks']);
const importKinds = new Set(['import-statement', 'dynamic-import', 'require-call']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateRelative(relative) {
  const parts = relative.split('/');
  if (parts.length === 0 || parts.some(part => !safePart.test(part) || part === '.' || part === '..')) {
    throw new TypeError('Build input contains an unsafe file path.');
  }
  return relative;
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0);
  Buffer.from('0000644\0').copy(header, 100);
  Buffer.from('0000000\0').copy(header, 108);
  Buffer.from('0000000\0').copy(header, 116);
  Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(header, 124);
  Buffer.from('00000000000\0').copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = 48;
  Buffer.from('ustar\0').copy(header, 257);
  Buffer.from('00').copy(header, 263);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);
  return header;
}

function createTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    blocks.push(tarHeader(entry.path, entry.bytes.length), entry.bytes);
    blocks.push(Buffer.alloc((512 - (entry.bytes.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

async function collectDirectory(root, prefix) {
  const files = [];
  async function visit(directory, relative = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const nextRelative = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new TypeError(`Build input contains a symbolic link: ${nextRelative}.`);
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(source, nextRelative);
      } else if (entry.isFile()) {
        files.push({ path: validateRelative(`${prefix}/${nextRelative}`), bytes: await readFile(source) });
      } else {
        throw new TypeError(`Build input contains a non-regular file: ${nextRelative}.`);
      }
    }
  }
  await visit(root);
  return files;
}

async function collectMigrations(root, kind) {
  const files = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.sql')) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new TypeError(`Migration input is invalid: ${entry.name}.`);
      continue;
    }
    files.push({ path: `migrations/${kind}/${entry.name}`, bytes: await readFile(path.join(root, entry.name)) });
  }
  return files;
}

function validateSizes(entries) {
  let total = 0;
  for (const entry of entries) {
    if (entry.bytes.length > artifactLimits.fileBytes) throw new RangeError(`Artifact file exceeds 20 MiB: ${entry.path}.`);
    if (entry.path.startsWith('migrations/') && entry.bytes.length > artifactLimits.migrationBytes) {
      throw new RangeError(`Artifact migration exceeds 1 MiB: ${entry.path}.`);
    }
    total += entry.bytes.length;
    if (total > artifactLimits.totalBytes) throw new RangeError('Artifact exceeds 64 MiB.');
  }
}

export async function collectWorkerModule({ checkout, temporary, role, execute: run = execute }) {
  const app = workerApps.find(([name]) => name === role);
  if (!app) throw new TypeError('Worker role must be api, identity, or operator.');
  const output = path.join(temporary, role);
  const metadataDirectory = path.join(temporary, `${role}-metadata`);
  const metadataPath = path.join(metadataDirectory, 'build.json');
  // A fresh role directory prevents a successful no-output process from reusing stale bytes.
  await mkdir(output, { recursive: false, mode: 0o700 });
  // Keep metadata fresh and outside the runtime-output namespace so a module
  // named like a sidecar or default metafile cannot replace our build evidence.
  await mkdir(metadataDirectory, { recursive: false, mode: 0o700 });
  await run('pnpm', [
    '--filter', `@incentives/${role === 'operator' ? 'operator-web' : role}`,
    'exec', 'wrangler', 'deploy', '--dry-run', '--config', path.join(checkout, app[1]), '--outdir', output, '--metafile', metadataPath,
  ], { cwd: checkout, maxBuffer: 10 * 1024 * 1024 });
  const names = await readdir(output);
  for (const name of names) {
    const entry = await lstat(path.join(output, name));
    if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError(`Worker output must be a regular file: ${name}.`);
    if (name !== 'worker.js' && name !== 'worker.js.map' && name !== 'README.md') {
      throw new TypeError(`Unexpected Worker output cannot be represented in bundle-v1: ${name}.`);
    }
  }
  if (!names.includes('worker.js')) throw new TypeError('Worker output is missing worker.js.');
  const metadataFile = await lstat(metadataPath);
  if (!metadataFile.isFile() || metadataFile.isSymbolicLink()) throw new TypeError('Worker metadata must be a regular file.');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (!isRecord(metadata) || !isRecord(metadata.inputs) || !isRecord(metadata.outputs)) throw new TypeError('Worker metadata must contain inputs and outputs.');
  const bytes = await readFile(path.join(output, 'worker.js'));
  const outputs = new Map();
  // Pinned Wrangler's esbuild absWorkingDir is the fixed config's project root,
  // not this process's cwd or the directory containing the metafile.
  const projectRoot = path.dirname(path.join(checkout, app[1]));
  for (const [name, entry] of Object.entries(metadata.outputs)) {
    const resolved = path.resolve(projectRoot, name);
    if (outputs.has(resolved) || ![path.join(output, 'worker.js'), path.join(output, 'worker.js.map')].includes(resolved)) throw new TypeError('Unexpected Worker metadata output.');
    if (!isRecord(entry) || !Array.isArray(entry.imports) || !Array.isArray(entry.exports) || entry.exports.some(value => typeof value !== 'string') || !isRecord(entry.inputs) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new TypeError('Worker metadata output is incomplete.');
    outputs.set(resolved, entry);
  }
  const main = outputs.get(path.join(output, 'worker.js'));
  if (!main || typeof main.entryPoint !== 'string' || !main.entryPoint || !Object.hasOwn(metadata.inputs, main.entryPoint) || !isRecord(metadata.inputs[main.entryPoint]) || !Object.keys(main.inputs).length) throw new TypeError('Worker metadata is missing its main output/input association.');
  if (main.bytes !== bytes.length) throw new TypeError('Worker metadata bytes do not match the selected module.');
  for (const [name, input] of Object.entries(main.inputs)) {
    const source = metadata.inputs[name];
    if (!Object.hasOwn(metadata.inputs, name) || !isRecord(source) || !Number.isSafeInteger(source.bytes) || source.bytes < 0 || !Array.isArray(source.imports) || !isRecord(input) || !Number.isSafeInteger(input.bytesInOutput) || input.bytesInOutput < 0) throw new TypeError('Worker metadata input association is incomplete.');
  }
  for (const dependency of main.imports) {
    if (!isRecord(dependency) || !importKinds.has(dependency.kind) || dependency.external !== true || !platformImports.has(dependency.path)) throw new TypeError('Worker runtime import cannot be represented in bundle-v1.');
  }
  const map = outputs.get(path.join(output, 'worker.js.map'));
  if (names.includes('worker.js.map') !== Boolean(map)) throw new TypeError('Worker map metadata does not match the output directory.');
  if (map && (Object.hasOwn(map, 'entryPoint') || map.imports.length || map.exports.length || Object.keys(map.inputs).length || map.bytes !== (await lstat(path.join(output, 'worker.js.map'))).size)) throw new TypeError('Worker map metadata does not describe a generated sidecar.');
  return { path: `workers/${role}.mjs`, bytes };
}

export async function createBundleV1({ key: inputKey, checkout, outputDir }) {
  const key = parseStackKey(inputKey);
  if (typeof checkout !== 'string' || !path.isAbsolute(checkout) || typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) {
    throw new TypeError('Checkout and outputDir must be absolute paths.');
  }
  if (!(await stat(checkout)).isDirectory()) throw new TypeError('Checkout must be a directory.');
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const temporary = await mkdtemp(path.join(tmpdir(), 'cloud-e2e-bundle-'));
  try {
    await execute('pnpm', ['build'], { cwd: checkout, maxBuffer: 10 * 1024 * 1024 });
    const workers = [];
    for (const [role] of workerApps) workers.push(await collectWorkerModule({ checkout, temporary, role }));
    const assets = await collectDirectory(path.join(checkout, 'apps/dashboard/dist'), 'assets');
    const migrations = [
      ...await collectMigrations(path.join(checkout, 'apps/api/migrations'), 'api'),
      ...await collectMigrations(path.join(checkout, 'apps/identity/migrations'), 'identity'),
    ];
    const files = [...workers, ...assets, ...migrations].sort((left, right) => left.path.localeCompare(right.path));
    if (!files.some(file => file.path === 'assets/index.html')) throw new TypeError('Operator SPA build is missing assets/index.html.');
    validateSizes(files);
    const manifest = {
      schema: 1,
      key,
      build_sha: key.head_sha,
      run: { run_id: key.run_id, attempt: key.attempt },
      files: files.map(file => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes) })),
    };
    const archive = createTar([{ path: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) }, ...files]);
    await writeFile(path.join(outputDir, 'bundle.tar'), archive, { mode: 0o600, flag: 'wx' });
    return manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const [keyText, outputDir] = process.argv.slice(2);
  if (!keyText || !outputDir || process.argv.length !== 4) {
    throw new TypeError('Usage: build-artifact.mjs <StackKeyV1 JSON> <absolute output directory>');
  }
  const manifest = await createBundleV1({ key: JSON.parse(keyText), checkout: process.cwd(), outputDir });
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (import.meta.main) main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
