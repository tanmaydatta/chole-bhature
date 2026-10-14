import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SimulatorError } from './client.js';
import { runScenario } from './scenario.js';

const usage = 'pnpm --filter @incentives/integration-simulator start --origin ORIGIN --environment local|staging --scenario FILE\nPrivate merchant key: INCENTIVES_SECRET_KEY process input only; never argv.\n';
export async function runCli(args: string[], environment: Record<string, string | undefined>, write: (value: string) => void): Promise<number> {
  try {
    if (args.length === 1 && args[0] === '--help') { write(usage); return 0; }
    const options = new Map<string, string>();
    if (args.length !== 6) throw new SimulatorError('configuration', 'INVALID_CONFIG');
    for (let index = 0; index < args.length; index += 2) {
      const name = args[index]!; const value = args[index + 1]!;
      if (!['--origin', '--environment', '--scenario'].includes(name) || options.has(name) || !value || value.startsWith('--')) throw new SimulatorError('configuration', 'INVALID_CONFIG');
      options.set(name, value);
    }
    const scenario: unknown = JSON.parse(await readFile(options.get('--scenario')!, 'utf8'));
    if (scenario === null || typeof scenario !== 'object' || Array.isArray(scenario)
      || ['secretKey', 'origin', 'environment', 'capture'].some(key => Object.hasOwn(scenario, key))) throw new SimulatorError('configuration', 'INVALID_CONFIG');
    const result = await runScenario({ ...scenario, origin: options.get('--origin'), environment: options.get('--environment'), secretKey: environment.INCENTIVES_SECRET_KEY });
    for (const entry of result.trace) write(`${JSON.stringify(entry)}\n`);
    write(`${JSON.stringify({ status: 'completed', currency: result.applied.currency,
      originalMerchandiseSubtotal: result.applied.original_total_pence, totalDiscount: result.applied.discount_pence,
      discountedMerchandiseSubtotal: result.applied.total_pence, repricedMerchandiseSubtotal: result.repriced.total_pence, captures: result.captures.length })}\n`);
    return 0;
  } catch (error) {
    const safe = error instanceof SimulatorError ? error : new SimulatorError('configuration', 'INVALID_CONFIG');
    write(`${JSON.stringify(safe.diagnostic())}\n`); return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2), { INCENTIVES_SECRET_KEY: process.env.INCENTIVES_SECRET_KEY }, value => process.stdout.write(value));
}
