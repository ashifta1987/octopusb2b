// Runs every SPEC §21.1 chain in dependency order against the local build (BASE, default http://localhost:3100),
// writing docs/qa/2026-11-01-trace/chain-NN.json + logs/. Pause the production dispatcher first
// (select cron.alter_job(<octopus-outbox-dispatch>, active := false)) so the deployed worker doesn't take the events.
// Usage: node tests/e2e/trace/run-all.mjs [--no-cleanup]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ORDER = ['chain-01-signup-kyc', 'chain-12-payment-replay', 'chain-02-rfq-to-order', 'chain-03-production-ship', 'chain-04-tracking-webhook',
  'chain-05-service-qc', 'chain-13-ad-click', 'chain-14-public-api', 'chain-09-10-assistant', 'chain-06-group-buy', 'chain-11-currency',
  'chain-07-08-backups', 'chain-16-staff-money', 'chain-15-outbox-failure'];
const LOGS = 'docs/qa/2026-11-01-trace/logs';
fs.mkdirSync(LOGS, { recursive: true });
const run = (file) => {
  const t0 = Date.now();
  const p = spawnSync('node', [`tests/e2e/trace/${file}.mjs`], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const out = (p.stdout + p.stderr).split('\n').filter((l) => !/MODULE_TYPELESS|Reparsing as ES|"type": "module"|trace-warnings/.test(l)).join('\n');
  fs.writeFileSync(`${LOGS}/${file}.txt`, out);
  const fails = (out.match(/^✘/gm) ?? []).length;
  console.log(`${fails ? '✘' : '✔'} ${file} (${Math.round((Date.now() - t0) / 1000)} s, ${fails} failed checks)`);
};
if (!process.argv.includes('--no-cleanup')) run('cleanup');
for (const f of ORDER) run(f);
