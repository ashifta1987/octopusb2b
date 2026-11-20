// Applies forward-only SQL migrations in supabase/migrations, then (optionally) seed.sql on STAGING.
// Usage: node scripts/db-migrate.mjs [--staging] [--seed]
//        node scripts/db-migrate.mjs --live        (loads .env.live ONLY when --live is passed; never runs --seed)
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { assertNotProduction } from './lib-env-guard.mjs';
import { loadStagingEnvOrExit, assertStagingDatabase, loadLiveEnvOrExit, assertLiveDatabase } from './lib-staging-guard.mjs';

const isLive = process.argv.includes('--live');
if (isLive && process.argv.includes('--staging')) { console.error('✘ refused: cannot pass both --live and --staging'); process.exit(1); }
if (isLive) loadLiveEnvOrExit();
else loadStagingEnvOrExit();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL missing');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
if (isLive) await assertLiveDatabase(client);
else await assertStagingDatabase(client);
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
