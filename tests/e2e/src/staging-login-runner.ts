import { runStagingLogin } from './staging-login.js';

runStagingLogin(process.argv.slice(2), process.env).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Staging login failed'}\n`);
  process.exitCode = 1;
});
