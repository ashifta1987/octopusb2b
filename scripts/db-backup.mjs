// Local logical backup (JSON, gzip per table) before risky data operations — e.g. `pnpm db:wipe-demo` (ADDON-24 step 9).
// Complements the nightly encrypted off-site backups of SPEC §16 and Supabase's own daily backup.
// Usage: pnpm db:backup [outDir] [--live]      (defaults to staging; pass --live to read .env.live read-only)
import pg from 'pg'; import fs from 'node:fs'; import zlib from 'node:zlib';
import { loadStagingEnvOrExit, assertStagingDatabase, loadLiveEnvOrExit, assertLiveDatabase } from './lib-staging-guard.mjs';
const isLive = process.argv.includes('--live');
if (isLive) loadLiveEnvOrExit();
else loadStagingEnvOrExit();
const outArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const out = outArg ?? `backups/${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (isLive) { await assertLiveDatabase(c); await c.query('begin read only'); await c.query(`set local statement_timeout = '60s'`); }
else await assertStagingDatabase(c);
const tables = (await c.query(`select table_schema s, table_name t from information_schema.tables
  where table_type = 'BASE TABLE' and (table_schema = 'public'
     or (table_schema = 'auth' and table_name in ('users', 'identities', 'mfa_factors'))
     or (table_schema = 'storage' and table_name in ('objects', 'buckets')))
  order by 1, 2`)).rows;
const manifest = { at: new Date().toISOString(), project: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0], tables: {} };
for (const { s, t } of tables) {
  const r = await c.query(`select * from "${s}"."${t}"`);
  fs.writeFileSync(`${out}/${s}.${t}.json.gz`, zlib.gzipSync(JSON.stringify(r.rows)));
  manifest.tables[`${s}.${t}`] = r.rowCount;
}
manifest.sequences = (await c.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)).rows;
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
if (isLive) await c.query('commit').catch(() => {});
await c.end();
console.log(`✔ backup: ${Object.keys(manifest.tables).length} tables, ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows → ${out}`);
