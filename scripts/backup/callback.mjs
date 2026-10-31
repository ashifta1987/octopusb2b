#!/usr/bin/env node
// Signed status callback from the backup/restore workflows to the app (POST $APP_URL/api/backups/status).
// Usage:
//   node scripts/backup/callback.mjs '{"type":"backup","code":"BK-…","status":"running"}'
//   node scripts/backup/callback.mjs --file payload.json [--merge '{"status":"completed"}'] [--out response.json] [--allow-fail]
// Env: APP_URL, BACKUP_CALLBACK_SECRET. Prints the JSON response; exits 1 on a non-2xx (unless --allow-fail).
import fs from 'node:fs';
import { signPayload } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(n);

const app = (process.env.APP_URL ?? '').replace(/\/+$/, '');
const secret = process.env.BACKUP_CALLBACK_SECRET ?? '';
if (!app || !secret) {
  console.error('callback: APP_URL and BACKUP_CALLBACK_SECRET must be set');
  process.exit(has('--allow-fail') ? 0 : 1);
}

let payload = {};
const file = flag('--file');
if (file) payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const inline = args.find((a, i) => !a.startsWith('--') && !['--file', '--merge', '--out'].includes(args[i - 1]));
if (inline) payload = { ...payload, ...JSON.parse(inline) };
const merge = flag('--merge');
if (merge) payload = { ...payload, ...JSON.parse(merge) };
if (process.env.GITHUB_RUN_ID && payload.github_run_id === undefined && ['backup', 'restore'].includes(payload.type)) payload.github_run_id = process.env.GITHUB_RUN_ID;

const body = JSON.stringify(payload);
let last = '';
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const res = await fetch(`${app}/api/backups/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Octopus-Signature': signPayload(body, secret),
        // lets the callback reach a Vercel deployment protected by Deployment Protection (optional)
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
      },
      body,
    });
    const text = await res.text();
    if (res.ok) {
      const out = flag('--out');
      if (out) fs.writeFileSync(out, text);
      process.stdout.write(text + '\n');
      process.exit(0);
    }
    last = `${res.status} ${text.slice(0, 500)}`;
    if (res.status < 500 && res.status !== 429) break; // client errors are not retried
  } catch (e) {
    last = e instanceof Error ? e.message : String(e);
  }
  await new Promise((r) => setTimeout(r, attempt * 3000));
}
console.error(`callback ${payload.type ?? '?'} failed: ${last}`);
process.exit(has('--allow-fail') ? 0 : 1);
