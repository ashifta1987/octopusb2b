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
const COLOURS = [['Black', '#111827'], ['White', '#F3F4F6'], ['Pink', '#F9A8D4'], ['Green', '#86EFAC'], ['Blue', '#93C5FD']];
/** deterministic 0..n-1 from a uuid */
const pick = (id, salt, n) => parseInt(id.replace(/-/g, '').slice(salt, salt + 6), 16) % n;

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

  // dropship products: up to 18 verified live products with a photo, spread over categories
  const prods = (await c.query(`
    select * from (
      select distinct on (p.category_id, (row_number() over (partition by p.category_id order by p.created_at desc) - 1) / 1)
             p.id, p.title, p.min_price_cents, p.currency, p.gross_weight, row_number() over (partition by p.category_id order by p.created_at desc) rn
      from products p join suppliers s on s.id = p.supplier_id
      where s.verified and s.archived_at is null and p.status = 'live' and p.image_url is not null and p.min_price_cents > 0
    ) x where rn <= 4 order by rn, id limit 18`)).rows;
  for (const [n, p] of prods.entries()) {
    const usdCents = p.currency === 'CNY' ? Number(p.min_price_cents) / 7.1 : Number(p.min_price_cents); // demo FX, staging only
    const unit = Math.max(150, Math.round(usdCents * 1.25));
    const gw = Number(p.gross_weight);
    const weight = gw > 0 && gw < 30 ? Math.round(gw * 1000) : 250 + pick(p.id, 0, 650);
    const battery = /battery|recharge|\d+ ?mah\b|smart ?watch|tracker|earbud|power bank/i.test(p.title);
    const liquid = /\b(oil|liquid|perfume|ink)\b/i.test(p.title);
    const short = p.title.split(/ with | for |,/i)[0].trim();
    await c.query(`insert into dropship_products (product_id, enabled, unit_cents, weight_g, has_battery, has_liquid, store_title, store_bullets, store_description)
      values ($1, true, $2, $3, $4, $5, $6, $7, $8)
      on conflict (product_id) do update set enabled = true, unit_cents = excluded.unit_cents, weight_g = excluded.weight_g, has_battery = excluded.has_battery,
        has_liquid = excluded.has_liquid, store_title = excluded.store_title, store_bullets = excluded.store_bullets, store_description = excluded.store_description, updated_at = now()`,
      [p.id, unit, weight, battery, liquid, short,
       [`${short}, ready to ship to your customer`, battery ? 'Rechargeable, charging cable in the box' : 'Durable everyday build', 'Packed in a plain outer box with your packing slip', 'Tracked delivery to your customer'],
       `${short}. Shipped from stock with tracking, in a plain outer box with your packing slip. No supplier or Octopus branding on the parcel.`]);
    await reg('dropship_products', p.id);
    await c.query(`delete from demo_rows where tbl = 'dropship_variants' and row_key in (select id::text from dropship_variants where product_id = $1)`, [p.id]);
    await c.query(`delete from dropship_variants where product_id = $1`, [p.id]);
    const nv = 1 + pick(p.id, 6, 3);
    for (let k = 0; k < nv; k++) {
      const [name, hex] = COLOURS[(pick(p.id, 12, COLOURS.length) + k) % COLOURS.length];
      const wh = n % 4 === 3 ? 0 : 80 + pick(p.id, 18 + k, 1900);   // every 4th product: none in our warehouse (no Express)
      const pt = 100 + pick(p.id, 24 - k, 700);
      const v = await c.query(`insert into dropship_variants (product_id, name, colour_hex, stock_warehouse, stock_partner, sort) values ($1,$2,$3,$4,$5,$6) returning id`, [p.id, name, hex, wh, pt, k]);
      await reg('dropship_variants', v.rows[0].id);
    }
  }
  console.log(`  dropship: ${prods.length} products, ${ROUTES.length} countries`);

  const n = (await c.query(`select count(*)::int n from demo_rows where batch = $1`, [BATCH])).rows[0].n;
  console.log(`✔ demo seeded: ${n} rows registered in demo_rows (batch ${BATCH})`);
} else {
  const has = (await c.query(`select to_regclass('public.demo_rows') is not null as ok`)).rows[0].ok;
  if (!has) { console.log('Nothing to purge (no demo_rows table).'); await c.end(); process.exit(0); }
  // children first: import-list rows of demo products, variants, products, routes, then settings
  const ORDER = ['dropship_variants', 'dropship_products', 'dropship_rates', 'site_settings'];
  const rows = (await c.query(`select tbl, row_key from demo_rows`)).rows.sort((a, b) => ORDER.indexOf(a.tbl) - ORDER.indexOf(b.tbl));
  const KEYCOL = { site_settings: 'key', dropship_rates: 'id', dropship_products: 'product_id', dropship_variants: 'id' };
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

