// ADDON-44 demo data for STAGING only — so unfinished screens can be seen with realistic numbers.
//   pnpm demo:seed    load / refresh the demo rows (idempotent)
//   pnpm demo:purge   delete every demo row registered in public.demo_rows, then the register itself
// Every demo row is recorded in public.demo_rows (table, key, batch) so purge removes exactly what seed added.
// Screens show an amber EXAMPLE pill while site_settings demo.addon44 = true.
// Safety: refuses to run unless DATABASE_URL in .env.staging points at the staging project ref and it is marked staging.
import { config } from 'dotenv';
import pg from 'pg';

const stg = config({ path: '.env.staging', quiet: true, processEnv: {} }).parsed ?? {};
const url = stg.DATABASE_URL;
const ref = (stg.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!url || !ref || !url.includes(ref)) throw new Error('Refusing: .env.staging DATABASE_URL is not the staging project');
const mode = process.argv[2];
if (!['seed', 'purge'].includes(mode)) throw new Error('Usage: node scripts/demo-addon44.mjs seed|purge');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const env = (await c.query(`select value #>> '{}' as v from site_settings where key = 'app_environment'`)).rows[0]?.v;
if (env !== 'staging') { await c.end(); throw new Error(`Refusing: app_environment is ${env ?? 'unset'}, not staging`); }

const BATCH = 'addon44';
/** site_settings demo values (numbers here are invented for staging and always shown with EXAMPLE). */
const SETTINGS = {
  'demo.addon44': true,
  'brand.methods': { pad: { moq: 300, days: '+5–7 days' }, laser: { moq: 200, days: '+3–5 days' }, uv: { moq: 300, days: '+5–7 days' }, box: { moq: 500, days: '+10–12 days' }, inserts: { moq: 500, days: '+4–6 days' } },
  'brand.am_reply_hours': 4,
  'brand.example_qty': { F8: 1500, G1000: 800, S7: 1000 },
};

if (mode === 'seed') {
  await c.query(`create table if not exists public.demo_rows (tbl text not null, row_key text not null, batch text not null, created_at timestamptz not null default now(), primary key (tbl, row_key))`);
  await c.query(`alter table public.demo_rows enable row level security`);
  await c.query(`revoke all on public.demo_rows from anon, authenticated`);
  for (const [key, value] of Object.entries(SETTINGS)) {
    await c.query(`insert into site_settings (key, value, description, is_public) values ($1, $2::jsonb, $3, true)
                   on conflict (key) do update set value = excluded.value, is_public = true`, [key, JSON.stringify(value), `DEMO (${BATCH}) — staging only, remove with pnpm demo:purge`]);
    await c.query(`insert into demo_rows (tbl, row_key, batch) values ('site_settings', $1, $2) on conflict do nothing`, [key, BATCH]);
  }
  const n = (await c.query(`select count(*)::int n from demo_rows where batch = $1`, [BATCH])).rows[0].n;
  console.log(`✔ demo seeded: ${n} rows registered in demo_rows (batch ${BATCH})`);
} else {
  const has = (await c.query(`select to_regclass('public.demo_rows') is not null as ok`)).rows[0].ok;
  if (!has) { console.log('Nothing to purge (no demo_rows table).'); await c.end(); process.exit(0); }
  const rows = (await c.query(`select tbl, row_key from demo_rows order by tbl, row_key`)).rows;
  const KEYCOL = { site_settings: 'key' };
  for (const r of rows) {
    const col = KEYCOL[r.tbl];
    if (!col) throw new Error(`No purge rule for table ${r.tbl}`);
    await c.query(`delete from ${r.tbl} where ${col} = $1`, [r.row_key]);
    console.log(`  − ${r.tbl}: ${r.row_key}`);
  }
  await c.query(`drop table public.demo_rows`);
  console.log(`✔ demo purged: ${rows.length} rows removed`);
}
await c.end();
