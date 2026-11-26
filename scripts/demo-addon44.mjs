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
  'dropship.markup': 2.5,
  'dropship.handling_days': 2,
  'dropship.returns': 'Faulty or damaged on arrival: report within 14 days with a photo and we replace the item or refund it to your wallet. Change-of-mind returns go back to the warehouse at your cost.',
  'dropship.default_country': 'AE',
  // W7 (owner, 26 Nov 2026): no more 3PL demo settings (warehouses / 3pl.rates_text / 3pl.cutoff) — the old 3PL request
  // form that read them is gone; Warehouse OS reads the warehouses table and the client rate plans.
};

/** EXAMPLE dropship routes: [country, duty %, express?, standard?, economy?, battery allowed on express/standard/economy] */
const ROUTES = [
  ['AE', 5, true, true, true, [true, true, true]],
  ['SA', 15, true, true, true, [false, false, false]],
  ['KW', 5, true, true, true, [true, true, false]],
  ['QA', 5, true, true, true, [true, true, false]],
  ['US', 0, true, true, true, [true, true, true]],
  ['GB', 20, true, true, true, [true, true, false]],
  ['DE', 19, true, true, true, [true, true, false]],
  ['AU', 10, false, false, true, [false, false, true]],
];
const SERVICE = {
  express: { base: 180, per: 22, fee: 60, days: [5, 10] },
  standard: { base: 120, per: 15, fee: 80, days: [7, 14] },
  economy: { base: 70, per: 10, fee: 90, days: [10, 20] },
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
  const reg = (tbl, key) => c.query(`insert into demo_rows (tbl, row_key, batch) values ($1, $2, $3) on conflict do nothing`, [tbl, key, BATCH]);

  // dropship routes (EXAMPLE rates)
  for (const [country, duty, ex, st, ec, bat] of ROUTES) {
    for (const [i, service] of ['express', 'standard', 'economy'].entries()) {
      if (![ex, st, ec][i]) continue;
      const v = SERVICE[service];
      const days = country === 'US' || country === 'AU' ? [v.days[0] + 1, v.days[1] + 2] : v.days;
      const r = await c.query(`insert into dropship_rates (country, service, ship_base_cents, ship_per_100g_cents, duty_pct, fee_cents, days_min, days_max, allows_battery, allows_liquid)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (country, service) do update set ship_base_cents = excluded.ship_base_cents, ship_per_100g_cents = excluded.ship_per_100g_cents, duty_pct = excluded.duty_pct,
          fee_cents = excluded.fee_cents, days_min = excluded.days_min, days_max = excluded.days_max, allows_battery = excluded.allows_battery, allows_liquid = excluded.allows_liquid, active = true
        returning id`, [country, service, v.base, v.per, duty, v.fee, days[0], days[1], bat[i], country === 'US' && service === 'standard']);
      await reg('dropship_rates', r.rows[0].id);
    }
  }

  // dropship products v2 (migration 204): seeded by scripts/seed-dropship-test.mjs
  console.log(`  dropship rates: ${ROUTES.length} countries (run scripts/seed-dropship-test.mjs for v2 TEST products)`);

  const n = (await c.query(`select count(*)::int n from demo_rows where batch = $1`, [BATCH])).rows[0].n;
  console.log(`✔ demo seeded: ${n} rows registered in demo_rows (batch ${BATCH})`);
} else {
  const has = (await c.query(`select to_regclass('public.demo_rows') is not null as ok`)).rows[0].ok;
  if (!has) { console.log('Nothing to purge (no demo_rows table).'); await c.end(); process.exit(0); }
  const ORDER = ['dropship_variants', 'dropship_products', 'dropship_rates', 'site_settings'];
  const rows = (await c.query(`select tbl, row_key from demo_rows`)).rows.sort((a, b) => ORDER.indexOf(a.tbl) - ORDER.indexOf(b.tbl));
  const KEYCOL = { site_settings: 'key', dropship_rates: 'id', dropship_products: 'id', dropship_variants: 'id' };
  await c.query(`delete from dropship_import_list where product_id in (select row_key::uuid from demo_rows where tbl = 'dropship_products')`);
  for (const r of rows) {
    const col = KEYCOL[r.tbl];
    if (!col) throw new Error(`No purge rule for table ${r.tbl}`);
    await c.query(`delete from ${r.tbl} where ${col}::text = $1`, [r.row_key]);
    console.log(`  − ${r.tbl}: ${r.row_key}`);
  }
  await c.query(`drop table public.demo_rows`);
  console.log(`✔ demo purged: ${rows.length} rows removed`);
}
await c.end();

