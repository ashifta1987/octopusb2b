#!/usr/bin/env node
// Computes the backup code (BK-YYYY-MMDD-HHMM, China time), trigger and retention class for backup.yml.
// Usage: node scripts/backup/meta.mjs [--code BK-…] [--trigger manual|scheduled|retry]  → writes code=…, trigger=…, retention=… to $GITHUB_OUTPUT (or stdout)
import fs from 'node:fs';
import { backupCode, retentionClass } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const now = new Date();
const code = (flag('--code') || '').trim() || backupCode(now);
if (!/^BK-[0-9A-Z-]+$/.test(code)) { console.error(`invalid backup code ${code}`); process.exit(1); }
const trigger = ['manual', 'scheduled', 'retry', 'drill'].includes(flag('--trigger')) ? flag('--trigger') : 'scheduled';
const retention = retentionClass(now, trigger);
const out = `code=${code}\ntrigger=${trigger}\nretention=${retention}\n`;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
process.stdout.write(out);
