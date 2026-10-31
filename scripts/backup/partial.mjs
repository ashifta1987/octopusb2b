#!/usr/bin/env node
// Partial restore (SPEC §16.3): extracts the chosen tables from the plain data dump into a SQL file that
// drops + recreates them in the `recovery` schema of the target (production) database. Admins then compare rows
// side by side (recovery_compare) and copy selected rows back (restore_records — never money tables).
//   node scripts/backup/partial.mjs --data work/plain/data.sql --modules products,cms --out work/recovery.sql [--check work/checks.json]
import fs from 'node:fs';
import readline from 'node:readline';
import { recoveryRewriter, tablesForModules } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const modules = (flag('--modules') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const tables = tablesForModules(modules);
if (!tables.length) { console.error('partial: no tables for modules', modules); process.exit(1); }

const rw = recoveryRewriter(tables);
const out = fs.createWriteStream(flag('--out') ?? 'recovery.sql');
const write = (lines) => { for (const l of lines) out.write(l + '\n'); };
write(rw.header());
const rl = readline.createInterface({ input: fs.createReadStream(flag('--data') ?? 'data.sql', { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) write(rw.line(line));
write(rw.footer());
await new Promise((r) => out.end(r));

const missing = tables.filter((t) => !rw.found.has(t));
const check = {
  kind: 'other',
  status: rw.found.size ? 'pass' : 'fail',
  detail: `Recovery schema: ${[...rw.found].join(', ') || 'no tables'} loaded from the backup${missing.length ? `; not in backup: ${missing.join(', ')}` : ''}`,
  data: { modules, tables: [...rw.found], missing },
};
if (flag('--check')) {
  const p = flag('--check');
  const prev = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  fs.writeFileSync(p, JSON.stringify([...prev, check], null, 2));
}
console.log(check.detail);
