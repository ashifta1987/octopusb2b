// Runs a command with the STAGING environment (.env.staging) loaded first, so the app / tests never fall back to
// .env.local (live). Refuses unless APP_ENVIRONMENT=staging. Prints nothing from the env file.
// Usage: node scripts/with-staging-env.mjs <command> [args…]   e.g.  node scripts/with-staging-env.mjs npx next dev -p 3100
import { spawn } from 'node:child_process';
import { loadStagingEnvOrExit } from './lib-staging-guard.mjs';
loadStagingEnvOrExit();
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error('usage: node scripts/with-staging-env.mjs <command> [args…]'); process.exit(1); }
const child = spawn(cmd, args, { env: process.env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
