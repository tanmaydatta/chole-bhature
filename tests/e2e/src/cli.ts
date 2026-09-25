import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanupOperatorResource } from './cleanup-operator.js';
import { loadTarget, newRunId, RunIdSchema } from './config.js';
import { executeRecipe } from './execution.js';
import { createManifest } from './manifest.js';
import { openOperatorClient, verifyFixtureMemberSession } from './operator-client.js';
import { cleanupRun, recipeInputs, type RecipeName } from './recipes.js';
import { createRunStore } from './run-store.js';
import { cleanupStagingRun } from './staging-cleanup.js';

export interface Command {
  name: RecipeName;
  runId?: string;
  inputPath?: string;
  execute: boolean;
}

export function parseCommand(argv: string[]): Command {
  const [rawName, ...options] = argv;
  if (!rawName || !(rawName in recipeInputs)) throw new Error('Specify a known recipe');
  const name = rawName as RecipeName;
  let runId: string | undefined;
  let inputPath: string | undefined;
  let execute = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (option === '--execute') {
      execute = true;
      continue;
    }
    const value = options[++index];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === '--run') runId = RunIdSchema.parse(value);
    else if (option === '--input') {
      if (!isAbsolute(value)) throw new Error('--input must name an absolute JSON file path');
      inputPath = value;
    } else throw new Error(`Unknown option: ${option}`);
  }
  if (name === 'cleanup-run') {
    if (!runId) throw new Error('cleanup-run requires --run');
    if (inputPath) throw new Error('cleanup-run does not accept --input');
  } else {
    if (!inputPath) throw new Error(`${name} requires --input JSON file`);
    if (name !== 'add-merchant' && !runId) throw new Error(`${name} requires --run`);
    if (execute) throw new Error('--execute is reserved for cleanup-run');
  }
  return { name, ...(runId ? { runId } : {}), ...(inputPath ? { inputPath } : {}), execute };
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const command = parseCommand(argv);
  const target = loadTarget(env);
  const runId = command.runId ?? newRunId();
  const directory = fileURLToPath(new URL('../.runs/', import.meta.url));
  const store = createRunStore(directory, runId);
  const lock = await store.lock();
  try {
    const manifest = command.name === 'add-merchant' && !command.runId
      ? createManifest(runId, target.kind) : await store.read();
    if (manifest.target !== target.kind) throw new Error('Run manifest target does not match E2E_TARGET');
    if (command.name === 'add-merchant' && !command.runId) await store.save(manifest);
    const operator = await openOperatorClient(target, env);
    try {
      if (command.name === 'cleanup-run') {
        if (target.kind === 'staging') {
          return cleanupStagingRun({ manifest, proof: await store.readProof(), operator,
            save: () => store.save(manifest) }, { dryRun: !command.execute });
        }
        const merchant = manifest.resources.find(item => item.kind === 'merchant');
        if (!merchant) throw new Error('Run manifest has no merchant');
        if (command.execute) {
          await operator.request('POST', '/operator/v1/platform/merchant-selection',
            { merchantId: merchant.id });
        }
        const resources = await cleanupRun(manifest,
          resource => cleanupOperatorResource({ manifest, operator }, resource),
          { dryRun: !command.execute, save: () => store.save(manifest) });
        return { runId, cleanup: command.execute ? 'best-effort-local' : 'preview', resources };
      }
      const input = JSON.parse(await readFile(command.inputPath!, 'utf8')) as unknown;
      const result = await executeRecipe({ manifest, target, operator,
        save: () => store.save(manifest),
        saveToken: (slug, token) => store.saveToken(slug, token),
        saveMemberCookie: (slug, cookie) => store.saveMemberCookie(slug, cookie),
        verifyMemberSession: input => verifyFixtureMemberSession(target, input),
        getOrCreateProof: () => store.getOrCreateProof(),
      }, command.name, input);
      return command.name === 'create-api-credential'
        ? { runId, recipe: command.name, credential: (result as { credential: unknown }).credential,
          tokenFile: store.tokenPath((input as { slug: string }).slug) }
        : { runId, recipe: command.name, result };
    } finally {
      await operator.close();
    }
  } finally {
    await lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli(process.argv.slice(2)).then(
    result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    error => {
      process.stderr.write(`${error instanceof Error ? error.message : 'E2E command failed'}\n`);
      process.exitCode = 1;
    },
  );
}
