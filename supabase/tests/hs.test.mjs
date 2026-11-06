// HS codes DB test (6 Nov 2026) — one rolled-back transaction. Optional MIGRATION=<file.sql> to test before applying.
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const one = async (s, p) => (await db.query(s, p)).rows[0];
try {
  await db.query('begin');
  if (process.env.MIGRATION) await db.query(fs.readFileSync(process.env.MIGRATION, 'utf8'));
  const adminId = (await one(`select ur.user_id from user_roles ur where ur.role_code = 'admin' limit 1`)).user_id;
  const sup = (await one(`select id from suppliers limit 1`)).id;
  const mk = async (sku, extra = {}) => (await one(`insert into products(external_id, slug, title, supplier_id, status, unit, moq, currency, hs_code, hs_code_source)
    values ($1, 'qa-hs-' || lower($1), 'QA fan ' || $1, $2, 'draft', 'pcs', 1, 'USD', $3, $4) returning id`, [sku, sup, extra.hs ?? null, extra.src ?? null])).id;
  const sheet = await mk('QA-HS-SHEET', { hs: '8414.51', src: 'sheet' });
  const manual = await mk('QA-HS-MAN', { hs: '8516' });
  const blank = await mk('QA-HS-BLANK');
  const r0 = await one(`select hs_code_source s, hs_code_status st from products where id = $1`, [manual]);
  ok(r0.s === 'manual' && r0.st === 'confirmed', 'a code typed without a source is stored as manual / confirmed');
  // classifier write on a sheet code is refused by the trigger
  await db.query(`update products set hs_code = '9999', hs_code_source = 'ai', hs_code_status = 'suggested' where id = $1`, [sheet]);
  const r1 = await one(`select hs_code, hs_code_source from products where id = $1`, [sheet]);
  ok(r1.hs_code === '8414.51' && r1.hs_code_source === 'sheet', 'a sheet-supplied code is never overwritten by a rule / AI value');
  await db.query(`update products set hs_code = '9999', hs_code_source = 'rule', hs_code_status = 'suggested' where id = $1`, [manual]);
  ok((await one(`select hs_code from products where id = $1`, [manual])).hs_code === '8516', 'a manual code is never overwritten by a rule / AI value');
  // type confirm + change
  const t = (await one(`insert into hs_product_types(type_key, name, keywords, heading, source) values ('qa gadget', 'QA gadget', array['gadget'], '8543', 'ai') returning id`)).id;
  await db.query(`update products set hs_code = '8543', hs_code_source = 'ai', hs_code_status = 'suggested', hs_product_type_id = $2 where id = $1`, [blank, t]);
  await db.query(`update products set hs_product_type_id = $2 where id = $1`, [sheet, t]);
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminId, role: 'authenticated', aal: 'aal2' })]);
  await db.query('set local role authenticated');
  const c = (await one(`select confirm_hs_type($1) r`, [t])).r;
  const stAfterConfirm = (await one(`select hs_code_status from products where id = $1`, [blank])).hs_code_status;
  const prev = (await db.query(`select * from hs_type_change_preview($1, '8509')`, [t])).rows;
  const ch = (await one(`select change_hs_type_heading($1, '8509') r`, [t])).r;
  const bad = await db.query('savepoint b').then(() => db.query(`select change_hs_type_heading($1, '85091')`, [t])).then(() => 'accepted', (e) => e.message);
  await db.query('rollback to savepoint b');
  await db.query('reset role');
  ok(c.products_confirmed === 1 && stAfterConfirm === 'confirmed', 'confirming a type confirms its suggested products');
  ok(prev.length === 1 && prev[0].sku === 'QA-HS-BLANK', 'change preview lists only rule / AI products (the sheet product is excluded)');
  const after = await one(`select (select hs_code from products where id = $1) b, (select hs_code from products where id = $2) s`, [blank, sheet]);
  ok(ch.products_updated === 1 && after.b === '8509' && after.s === '8414.51', 'changing the heading updates the type\'s products, never the sheet code');
  ok(/HS_BAD_HEADING/.test(bad), 'a heading that is not exactly 4 digits is refused');
  const aud = Number((await one(`select count(*) n from audit_log where action in ('product.hs_code_confirmed','product.hs_code_changed','hs_type.confirmed','hs_type.heading_changed') and created_at > now() - interval '1 minute'`)).n);
  ok(aud >= 4, `audit rows written (${aud})`);
} catch (e) { ok(false, 'unexpected: ' + e.message); }
finally {
  await db.query('rollback'); await db.end();
  console.log(failed ? `\nhs: ${failed} check(s) failed` : '\nhs: all passed'); process.exitCode = failed ? 1 : 0;
}
