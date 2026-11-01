// Removes every row written by the trace chains (trace ids "e2e-…", qa-trace-* users and their orgs, temporary TOTP
// factors). audit_log rows are kept (append-only by design) and reported. Usage: node tests/e2e/trace/cleanup.mjs [--keep-users]
import fs from 'node:fs';
import { cleanup, db, OUT, sql } from './lib.mjs';

const res = await cleanup({ keepUsers: process.argv.includes('--keep-users') });
const left = await sql(`select table_name from information_schema.columns where table_schema='public' and column_name='trace_id'`);
const remaining = {};
for (const { table_name: t } of left) {
  const [{ n }] = await sql(`select count(*)::int n from public.${t} where trace_id like 'e2e-%'`);
  if (n) remaining[t] = n;
}
const users = await sql(`select count(*)::int n from auth.users where email like 'qa-trace-%'`);
const out = { at: new Date().toISOString(), ...res, remaining_e2e_rows: remaining, remaining_qa_trace_users: users[0].n };
fs.writeFileSync(`${OUT}/cleanup.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await db.end();
