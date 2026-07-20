import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function localBuildCommands(
  repositoryRoot = defaultRepositoryRoot,
  nodeExecutable = process.execPath,
) {
  return [
    {
      label: 'Contracts',
      command: nodeExecutable,
      args: [
        path.join(repositoryRoot, 'packages/contracts/node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.json',
      ],
      cwd: path.join(repositoryRoot, 'packages/contracts'),
    },
    {
      label: 'Dashboard types',
      command: nodeExecutable,
      args: [
        path.join(repositoryRoot, 'apps/dashboard/node_modules/typescript/bin/tsc'),
        '-b',
      ],
      cwd: path.join(repositoryRoot, 'apps/dashboard'),
    },
    {
      label: 'Dashboard assets',
      command: nodeExecutable,
      args: [
        path.join(repositoryRoot, 'apps/dashboard/node_modules/vite/bin/vite.js'),
        'build',
      ],
      cwd: path.join(repositoryRoot, 'apps/dashboard'),
    },
  ];
}

export function localWorkerCommands(
  repositoryRoot = defaultRepositoryRoot,
  nodeExecutable = process.execPath,
) {
  return [
    ['Core', 'api'],
    ['Identity', 'identity'],
    ['Operator Web', 'operator-web'],
  ].map(([label, app]) => ({
    label,
    command: nodeExecutable,
    args: [
      path.join(repositoryRoot, `apps/${app}/node_modules/wrangler/bin/wrangler.js`),
      'dev',
      '--config',
      path.join(repositoryRoot, `apps/${app}/wrangler.toml`),
    ],
    cwd: path.join(repositoryRoot, `apps/${app}`),
  }));
}

export function runLocalWorkers({
  repositoryRoot = defaultRepositoryRoot,
  nodeExecutable = process.execPath,
  spawnSyncImpl = spawnSync,
  spawnImpl = spawn,
  signalTarget = process,
  setExitCode = code => { process.exitCode = code; },
  environment = process.env,
} = {}) {
  for (const build of localBuildCommands(repositoryRoot, nodeExecutable)) {
    const result = spawnSyncImpl(build.command, build.args, {
      cwd: build.cwd,
      env: environment,
      shell: false,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      setExitCode(result.status ?? 1);
      return { children: [], stop() {} };
    }
  }

  const children = localWorkerCommands(repositoryRoot, nodeExecutable).map(specification => ({
    specification,
    child: spawnImpl(specification.command, specification.args, {
      cwd: specification.cwd,
      env: environment,
      shell: false,
      stdio: 'inherit',
    }),
  }));

  let stopping = false;
  function stop(signal = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    signalTarget.once(signal, () => stop(signal));
  }
  for (const { child } of children) {
    child.once('error', () => {
      setExitCode(1);
      stop();
    });
    child.once('exit', code => {
      if (!stopping && code !== 0) {
        setExitCode(code ?? 1);
        stop();
      }
    });
  }
  return { children, stop };
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) runLocalWorkers();
