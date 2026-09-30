import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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

async function bundleWorker(checkout, temporary, name, config) {
  const output = path.join(temporary, `${name}.mjs`);
  await execute('pnpm', [
    '--filter', `@incentives/${name === 'operator' ? 'operator-web' : name}`,
    'exec', 'wrangler', 'deploy', '--dry-run', '--config', path.join(checkout, config), '--outfile', output,
  ], { cwd: checkout, maxBuffer: 10 * 1024 * 1024 });
  return { path: `workers/${name}.mjs`, bytes: await readFile(output) };
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
    for (const [name, config] of workerApps) workers.push(await bundleWorker(checkout, temporary, name, config));
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
