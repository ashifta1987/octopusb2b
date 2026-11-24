// HS codes DB test (updated for Step I1a: item_master is sole HS writer, one-way sync to products, direct products.hs_* writes blocked)
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
    values ($1, 'qa-hs-' || lower($1), 'QA fan ' || $1, $2, 'draft', 'pcs', 1, 'USD', $3, $4) returning id, item_id`, [sku, sup, extra.hs ?? null, extra.src ?? null]));
  const sheet = await mk('QA-HS-SHEET', { hs: '8414.51', src: 'sheet' });
  const manual = await mk('QA-HS-MAN', { hs: '8516' });
  const blank = await mk('QA-HS-BLANK');

  // Direct update to products.hs_* is blocked by trg_block_direct_product_hs_write
  const directBlocked = await db.query('savepoint d')
    .then(() => db.query(`update products set hs_code = '9999' where id = $1`, [blank.id]))
    .then(() => 'accepted', (e) => e.message);
  await db.query('rollback to savepoint d');
  ok(/DIRECT_PRODUCT_HS_WRITE_BLOCKED/.test(directBlocked), 'direct UPDATE to products.hs_* is rejected');

  const r0 = await one(`select p.hs_code_source s, p.hs_code_status st, im.hs_verified v from products p join item_master im on im.id = p.item_id where p.id = $1`, [manual.id]);
  ok(r0.s === 'manual' && r0.st === 'confirmed' && r0.v === false, 'a code typed without a source is stored as manual / confirmed on item_master & synced, with hs_verified=false');

  const rSheet0 = await one(`select hs_verified v from item_master where id = $1`, [sheet.item_id]);
  ok(rSheet0.v === false, 'a sheet-supplied code does NOT auto-set hs_verified');

  // classifier write on a sheet / manual item_master row is refused by guard_item_master
  await db.query(`update item_master set hs_code = '9999', hs_code_source = 'ai', hs_code_status = 'suggested' where id = $1`, [sheet.item_id]);
  const r1 = await one(`select hs_code, hs_code_source from products where id = $1`, [sheet.id]);
  ok(r1.hs_code === '8414.51' && r1.hs_code_source === 'sheet', 'a sheet-supplied code is never overwritten by a rule / AI value');

  await db.query(`update item_master set hs_code = '9999', hs_code_source = 'rule', hs_code_status = 'suggested' where id = $1`, [manual.item_id]);
  ok((await one(`select hs_code from products where id = $1`, [manual.id])).hs_code === '8516', 'a manual code is never overwritten by a rule / AI value');

  // type confirm + change via item_master
  const t = (await one(`insert into hs_product_types(type_key, name, keywords, heading, source) values ('qa gadget', 'QA gadget', array['gadget'], '8543', 'ai') returning id`)).id;
  await db.query(`update item_master set hs_code = '8543', hs_code_source = 'ai', hs_code_status = 'suggested', hs_product_type_id = $2 where id = $1`, [blank.item_id, t]);
  await db.query(`update item_master set hs_product_type_id = $2 where id = $1`, [sheet.item_id, t]);
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminId, role: 'authenticated', aal: 'aal2' })]);
  await db.query('set local role authenticated');
  const c = (await one(`select confirm_hs_type($1) r`, [t])).r;
  const stAfterConfirm = (await one(`select hs_code_status from portal_products() where id = $1`, [blank.id])).hs_code_status;
  const verAfterConfirm = (await one(`select hs_verified, hs_verified_by from item_master where id = $1`, [blank.item_id]));
  const prev = (await db.query(`select * from hs_type_change_preview($1, '8509')`, [t])).rows;
  const ch = (await one(`select change_hs_type_heading($1, '8509') r`, [t])).r;
  const bad = await db.query('savepoint b').then(() => db.query(`select change_hs_type_heading($1, '85091')`, [t])).then(() => 'accepted', (e) => e.message);
  await db.query('rollback to savepoint b');
  await db.query('reset role');

  ok(c.products_confirmed === 1 && stAfterConfirm === 'confirmed' && verAfterConfirm.hs_verified === true && verAfterConfirm.hs_verified_by === adminId,
    'confirming a type confirms its suggested items, syncs products, and records hs_verified + hs_verified_by');
  ok(prev.length === 1 && prev[0].sku === 'QA-HS-BLANK', 'change preview lists only rule / AI products (the sheet product is excluded)');
  const after = await one(`select (select hs_code from products where id = $1) b, (select hs_code from products where id = $2) s`, [blank.id, sheet.id]);
  ok(ch.products_updated === 1 && after.b === '8509' && after.s === '8414.51', 'changing the heading updates the type\'s products, never the sheet code');
  ok(/HS_BAD_HEADING/.test(bad), 'a heading that is not exactly 4 digits is refused');
  const aud = Number((await one(`select count(*) n from audit_log where action in ('product.hs_code_confirmed','product.hs_code_changed','hs_type.confirmed','hs_type.heading_changed') and created_at > now() - interval '1 minute'`)).n);
  ok(aud >= 4, `audit rows written (${aud})`);
} catch (e) { ok(false, 'unexpected: ' + e.message); }
finally {
  await db.query('rollback'); await db.end();
  console.log(failed ? `\nhs: ${failed} check(s) failed` : '\nhs: all passed'); process.exitCode = failed ? 1 : 0;
}
