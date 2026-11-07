// Copies catalogue + site configuration from production to the STAGING database (ADDON-41 setup, 7 Nov 2026).
// Never copies customers, orders, wallet/ledger, KYC, messages, audit or staff accounts.
// Usage: node scripts/staging-sync.mjs        (reads .env.local = source/live, .env.staging = target)
// Safety: the target must be the staging project ref AND not be marked production; the source is only read.
import { config } from 'dotenv';
import pg from 'pg';

const src = config({ path: '.env.local', quiet: true, processEnv: {} }).parsed?.DATABASE_URL;
const stg = config({ path: '.env.staging', quiet: true, processEnv: {} }).parsed;
const dst = stg?.DATABASE_URL;
const STAGING_REF = (stg?.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!src || !dst || !STAGING_REF) throw new Error('Missing DATABASE_URL in .env.local or .env.staging');
if (!dst.includes(STAGING_REF) || src.includes(STAGING_REF)) throw new Error('Refusing: target is not the staging project, or source is staging');

// ADDON-44: demo rows registered in public.demo_rows (pnpm demo:seed) are kept; live values never overwrite them.
let DEMO_KEYS = new Set();
// FK-safe order. Tables listed with `mirror: true` are emptied on staging first (config that must match live).
const TABLES = [
  { t: 'roles', mirror: false }, { t: 'permission_areas' }, { t: 'role_permissions', mirror: true },
  { t: 'site_settings', mirror: `key <> 'app_environment' and (to_regclass('public.demo_rows') is null or key not in (select row_key from public.demo_rows where tbl = 'site_settings'))`, skip: (r) => r.key === 'app_environment' || DEMO_KEYS.has(r.key) }, { t: 'content_blocks', mirror: true }, { t: 'company_profile' }, { t: 'branches' },
  { t: 'pages' }, { t: 'terms_versions' }, { t: 'services' }, { t: 'service_prices' }, { t: 'carriers' }, { t: 'sla_policies' },
  { t: 'ad_placements' }, { t: 'support_macros' }, { t: 'integrations', mirror: true }, { t: 'fx_rates' }, { t: 'email_templates' },
  { t: 'categories', order: 'level' }, { t: 'tags' }, { t: 'hs_product_types', mirror: true },
  { t: 'suppliers' }, { t: 'supplier_contacts' }, { t: 'supplier_name_variants' }, { t: 'supplier_verifications' }, { t: 'supplier_switches' },
  { t: 'certificates' }, { t: 'freed_supplier_codes' },
  { t: 'products' }, { t: 'product_costs' }, { t: 'price_tiers' }, { t: 'product_media' }, { t: 'product_specs' }, { t: 'product_tags' },
  { t: 'product_certificates' }, { t: 'sku_reservations' }, { t: 'supplier_products' }, { t: 'supplier_product_prices' },
  { t: 'home_banners' }, { t: 'banners' },
  { t: 'turnkey_hubs' }, { t: 'turnkey_projects' }, { t: 'turnkey_packages' }, { t: 'turnkey_equipment' }, { t: 'turnkey_project_sources' },
];

const S = new pg.Client({ connectionString: src, ssl: { rejectUnauthorized: false } });
const D = new pg.Client({ connectionString: dst, ssl: { rejectUnauthorized: false } });
await S.connect(); await D.connect();
const envRow = await D.query(`select value #>> '{}' v from site_settings where key = 'app_environment'`);
if (envRow.rows[0]?.v === 'production') {
  // a fresh staging database inherits 'production' from a migration: re-mark it before anything else
  await D.query(`update site_settings set value = '"staging"'::jsonb where key = 'app_environment'`);
}
if ((await D.query(`select value #>> '{}' v from site_settings where key = 'app_environment'`)).rows[0]?.v !== 'staging') throw new Error('Target is not marked staging');
if ((await D.query(`select to_regclass('public.demo_rows') r`)).rows[0].r) DEMO_KEYS = new Set((await D.query(`select row_key from public.demo_rows where tbl = 'site_settings'`)).rows.map((r) => r.row_key));

const exists = async (c, t) => (await c.query(`select to_regclass($1) r`, [`public.${t}`])).rows[0].r !== null;
const userFkCols = async (t) => (await D.query(
  `select a.attname from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
    where k.contype = 'f' and k.conrelid = $1::regclass and k.confrelid = 'auth.users'::regclass`, [`public.${t}`])).rows.map((r) => r.attname);
const cols = async (t) => (await D.query(
  `select column_name, udt_name from information_schema.columns where table_schema = 'public' and table_name = $1
     and is_generated = 'NEVER' and coalesce(identity_generation, '') <> 'ALWAYS' order by ordinal_position`, [t])).rows;

const report = [];
try {
  await D.query('begin');
  for (const spec of TABLES) {
    const { t } = spec;
    if (!(await exists(S, t)) || !(await exists(D, t))) { report.push([t, 'missing', 0]); continue; }
    const meta = await cols(t);
    const c = meta.map((m) => m.column_name);
    const isJson = new Set(meta.filter((m) => m.udt_name === 'json' || m.udt_name === 'jsonb').map((m) => m.column_name));
    const nullCols = new Set(await userFkCols(t));
    const { rows } = await S.query(`select ${c.map((x) => (isJson.has(x) ? `"${x}"::text as "${x}"` : `"${x}"`)).join(', ')} from public."${t}"${spec.order ? ` order by ${spec.order}` : ''}`);
    if (spec.mirror) await D.query(`delete from public."${t}"${typeof spec.mirror === 'string' ? ` where ${spec.mirror}` : ''}`);
    let n = 0;
    for (const r of rows) {
      if (spec.skip?.(r)) continue;
      const vals = c.map((x) => (nullCols.has(x) ? null : r[x]));
      const res = await D.query(
        `insert into public."${t}"(${c.map((x) => `"${x}"`).join(', ')}) values (${c.map((_, i) => `$${i + 1}`).join(', ')}) on conflict do nothing`,
        vals); // json columns are read as text, so JSON null and SQL NULL stay distinct
      n += res.rowCount;
    }
    report.push([t, rows.length, n]);
  }
  // sequences (supplier codes, product ids, document numbers…) continue where live is, so codes never clash
  const seqs = (await S.query(`select sequencename s, last_value v from pg_sequences where schemaname = 'public' and last_value is not null`)).rows;
  for (const { s, v } of seqs) {
    if (await D.query(`select to_regclass($1) r`, [`public.${s}`]).then((x) => x.rows[0].r)) await D.query(`select setval($1, greatest($2::bigint, (select coalesce(last_value, 1) from pg_sequences where schemaname = 'public' and sequencename = $3)))`, [`public.${s}`, v, s]);
  }
  // staging-only bank details (clearly marked; never a real account)
  await D.query(`delete from company_bank_accounts`);
  await D.query(`insert into company_bank_accounts(currency, bank_name, account_holder, account_number, swift, active, notes)
                 values ('USD', 'STAGING TEST BANK – DO NOT PAY', 'STAGING – Shenzhen Octopus Trading Co., Ltd.', '000-000000-000', 'TESTHKHH', true, 'Staging only. Not a real account.')`)
    .catch(async (e) => { console.warn('bank row:', e.message); });
  await D.query('commit');
} catch (e) {
  await D.query('rollback'); console.error('✘ sync failed, staging unchanged:', e.message); process.exitCode = 1;
}
for (const [t, a, b] of report) console.log(`${t.padEnd(26)} live ${String(a).padStart(4)}  → inserted ${b}`);
await S.end(); await D.end();
