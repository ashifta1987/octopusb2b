#!/usr/bin/env node
// Builds the final restore callback body from the collected checks (restore.yml).
//   node scripts/backup/report.mjs --checks work/checks.json --success verified|completed --phase verify|post_restore|drill --out work/report.json [--failed "reason"]
// Env: RESTORE_ID, MODE, TARGET, BACKUP_CODE, GITHUB_* (run link).
import fs from 'node:fs';
import { outcome } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const checksFile = flag('--checks') ?? 'checks.json';
const checks = fs.existsSync(checksFile) ? JSON.parse(fs.readFileSync(checksFile, 'utf8')) : [];
const forced = flag('--failed');
const res = forced ? { status: 'failed', error: forced } : outcome(checks, flag('--success') ?? 'completed');
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const body = {
  type: 'restore',
  restore_id: process.env.RESTORE_ID,
  status: res.status,
  phase: flag('--phase') ?? 'verify',
  checks: checks.map((c) => ({ kind: c.kind, status: c.status, detail: String(c.detail ?? '').slice(0, 2000), data: c.data })),
  report: {
    backup: process.env.BACKUP_CODE ?? null, mode: process.env.MODE ?? null, target: process.env.TARGET ?? null, run_url: runUrl,
    finished_at: new Date().toISOString(), passed: checks.filter((c) => c.status === 'pass').length, failed: checks.filter((c) => c.status === 'fail').length,
  },
  ...(res.error ? { error: res.error } : {}),
};
fs.writeFileSync(flag('--out') ?? 'report.json', JSON.stringify(body));
console.log(`restore ${body.status}: ${body.report.passed} passed, ${body.report.failed} failed${res.error ? ` — ${res.error}` : ''}`);
