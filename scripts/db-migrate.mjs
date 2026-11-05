// Applies forward-only SQL migrations in supabase/migrations, then (optionally) seed.sql.
// Usage: node scripts/db-migrate.mjs [--seed]
import 'dotenv/config';
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { assertNotProduction } from './lib-env-guard.mjs';
config({ path: '.env.local' });
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL missing');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`create table if not exists public._migrations (name text primary key, applied_at timestamptz default now())`);
await client.query(`alter table public._migrations enable row level security`);
const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const { rows } = await client.query('select name from public._migrations');
const done = new Set(rows.map((r) => r.name));
for (const f of files) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  process.stdout.write(`→ ${f} … `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public._migrations(name) values ($1)', [f]);
    await client.query('commit');
    console.log('ok');
  } catch (e) {
    await client.query('rollback');
    console.log('FAILED');
    console.error(e.message, e.position ? `(pos ${e.position})` : '', e.where ?? '');
    process.exit(1);
  }
}
if (process.argv.includes('--seed')) {
  await assertNotProduction(client, 'seed.sql');
  process.stdout.write('→ seed.sql … ');
  try { await client.query(fs.readFileSync('supabase/seed.sql', 'utf8')); console.log('ok'); }
  catch (e) { console.log('FAILED'); console.error(e.message, e.where ?? ''); process.exit(1); }
}
await client.end();
