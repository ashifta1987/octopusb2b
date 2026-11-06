// ADDON-33 E2E — bulk template v2 with SKUs + images, through the real distributor UI as a temporary distributor.
// template layout · duplicate SKU in file · SKU owned by another supplier · blank SKU · missing image · case-mismatched image ·
// zip with extra files · create · re-upload = no change · export → re-import = zero changes · edited price = 1 update with diff ·
// concurrent upload race (same new SKU in two jobs) · Generate SKUs. Everything created here is removed at the end.
// Usage: APP=http://localhost:3100 node tests/e2e/sku-import.mjs
import crypto from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium } from '@playwright/test';
import ExcelJS from 'exceljs'; import { zipSync } from 'fflate';
import { config } from 'dotenv'; import pg from 'pg'; import { createClient } from '@supabase/supabase-js';
import { signStaffCookie } from '../../lib/staff/session-cookie.ts';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL; const ref = new URL(URL_).hostname.split('.')[0];
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
const tag = crypto.randomBytes(3).toString('hex').toUpperCase();
const P = `QAE2E${tag}`;                // every SKU of this run starts with this
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oct-sku-'));
const email = `qa-sku-${Date.now()}@demo.octopusb2b.com`; const password = `Qa-${crypto.randomBytes(6).toString('hex')}-9!`;
let uid = null;
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
function b32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }

const browser = await chromium.launch();
let supplier;
try {
  supplier = (await db.query(`select s.id, s.code from suppliers s left join supplier_switches w on w.supplier_id = s.id
    where s.archived_at is null and coalesce(w.product_upload, true) and s.identity_status = 'ok' order by s.code limit 1`)).rows[0];
  const { data: cu, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (error) throw error;
  uid = cu.user.id;
  await db.query(`insert into profiles(id, full_name, email, totp_required) values ($1, 'QA SKU distributor', $2, true)`, [uid, email]);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'distributor')`, [uid]);
  await db.query(`insert into distributor_suppliers(distributor_id, supplier_id) values ($1, $2)`, [uid, supplier.id]);
  const sb = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email, password });
  const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'qa-sku' }); if (en.error) throw en.error;
  const v = await sb.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) }); if (v.error) throw v.error;
  const session = (await sb.auth.getSession()).data.session;
  const val = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const host = new URL(APP).hostname; const secure = APP.startsWith('https');
  const cookies = []; const CH = 3180;
  if (val.length <= CH) cookies.push({ name: `sb-${ref}-auth-token`, value: val });
  else for (let i = 0; i * CH < val.length; i++) cookies.push({ name: `sb-${ref}-auth-token.${i}`, value: val.slice(i * CH, (i + 1) * CH) });
  const now = Date.now();
  cookies.push({ name: 'oct_staff', value: signStaffCookie({ start: now, last: now, trusted: false, uid }, process.env.STAFF_SESSION_SECRET) });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addCookies(cookies.map((c) => ({ ...c, domain: host, path: '/', httpOnly: false, secure, sameSite: 'Lax' })));
  const page = await ctx.newPage();
  const IMPORT = APP + '/distributor/products/import';
  const open = async () => { await page.goto(IMPORT, { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'Upload and check' }).waitFor({ timeout: 60000 }); };
  const download = async (name) => { const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name }).click()]); const f = path.join(tmp, `${Date.now()}-${dl.suggestedFilename()}`); await dl.saveAs(f); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); return wb; };
  const upload = async (wb, zipFile) => {
    const f = path.join(tmp, `up-${Date.now()}.xlsx`); await wb.xlsx.writeFile(f);
    await open();
    await page.getByLabel(/Filled template \(\.xlsx/).setInputFiles(f);
    if (zipFile) await page.locator('input[name="zip"]').setInputFiles(zipFile);
    await page.getByRole('button', { name: 'Upload and check' }).click();
    await page.waitForURL(/job=[0-9a-f-]{36}/, { timeout: 120000 }).catch(async (e) => {
      console.log('  page says:', (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | '));
      throw e;
    });
    await page.getByTestId('import-summary').waitFor({ timeout: 60000 });
    return new URL(page.url()).searchParams.get('job');
  };
  const rowText = async (n) => ((await page.locator(`[data-testid="import-row"][data-row="${n}"]`).textContent()) ?? '').replace(/\s+/g, ' ');
  const confirm = async () => { page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: /Confirm and import/ }).click(); await page.waitForTimeout(500); await page.getByText(/Saved · edit/).first().waitFor({ timeout: 120000 }); };

  // 1 · template layout
  await open();
  const tpl = await download('Download template (.xlsx)');
  const ws = tpl.getWorksheet('Products');
  const head = ws.getRow(1).values.slice(1);
  ok(head.length === 23 && head[0] === 'sku' && head.slice(19, 22).join() === 'image_file,image_file_2,image_file_3' && ws.views[0].topLeftCell === 'C2',
    'template v2: 23 columns, sku first, 3 image columns, frozen at C2');
  ok((ws.conditionalFormattings ?? []).length > 0 && tpl.getWorksheet('Instructions').getCell('A2').value === 'sku', 'duplicate / missing SKU highlighting and SKU instructions present');

  // 2 · first upload: mixed good and bad rows
  const otherRow = (await db.query(`select p.sku, s.code from products p join suppliers s on s.id = p.supplier_id where p.supplier_id <> $1 and p.status <> 'archived' order by p.created_at limit 1`, [supplier.id])).rows[0];
  const other = otherRow.sku;
  const cat = ws.getCell('C2').value;
  const row = (sku, title, img, price = 0.19) => [sku, title, cat, supplier.code, 'pcs', 100, 10, 'FOB', 'CN', '7318.15', 'USD', 100, price, 500, 0.15, null, null, 'no', 'yes', img, null, null, 'QA row'];
  ws.spliceRows(2, 1);
  [row(`${P}-001`, 'QA SKU product one', 'qa1.jpg'), row(`${P}-002`, 'QA SKU product two', 'missing.jpg'), row(`${P}-DUP`, 'QA dup A', null), row(`${P}-DUP`, 'QA dup B', null),
    row(other, 'QA other supplier', null), row(null, 'QA no sku', null)].forEach((r, i) => { ws.getRow(i + 2).values = r; });
  const zip1 = path.join(tmp, 'imgs.zip'); fs.writeFileSync(zip1, Buffer.from(zipSync({ 'pics/QA1.JPG': new Uint8Array(JPG), 'pics/extra.png': new Uint8Array(JPG), '__MACOSX/pics/._QA1.JPG': new Uint8Array([0]) })));
  const job1 = await upload(tpl, zip1);
  ok(/Create/.test(await rowText(2)) && /matched "QA1\.JPG"/.test(await rowText(2)), 'case-mismatched image name matched with a warning (exact name reported)');
  ok(/Create/.test(await rowText(3)) && /"missing\.jpg" was not found in the zip/.test(await rowText(3)), 'missing image → warning, the product still imports');
  ok(/rows 4, 5/.test(await rowText(4)) && /rows 4, 5/.test(await rowText(5)), 'duplicate SKU in the file → error on both rows with all row numbers');
  ok(/SKU already used by another supplier/.test(await rowText(6)) && !(await page.locator('main').innerText()).includes(otherRow.code), "SKU owned by another supplier → error that doesn't reveal who");
  ok(/SKU is required/.test(await rowText(7)), 'blank SKU → error');
  ok(/not used by any row.*extra\.png/.test(await page.locator('main').innerText()), 'zip file not referenced by any row → info list');
  await confirm();
  const made = (await db.query(`select p.id, p.sku, (select count(*) from product_media m where m.product_id = p.id) imgs, (select source_file_name from product_media m where m.product_id = p.id limit 1) src from products p where p.sku like $1 order by p.sku`, [`${P}-%`])).rows;
  ok(made.length === 2 && Number(made[0].imgs) === 1 && made[0].src === 'QA1.JPG' && Number(made[1].imgs) === 0, `commit: 2 products created (${made.map((m) => `${m.sku}:${m.imgs} img`).join(', ')}), bad rows not saved`);

  // 2b · submit for moderation from the UI → products really change; the job only says "submitted" if they did
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Submit \d+ for moderation/ }).click();
  await page.waitForTimeout(1500); await page.reload(); await page.getByTestId('import-summary').waitFor();
  const subSt = (await db.query(`select status, count(*)::int n from products where sku like $1 group by 1`, [`${P}-%`])).rows;
  const jobSt = (await db.query(`select status from import_jobs where id = $1`, [job1])).rows[0].status;
  ok(subSt.length === 1 && subSt[0].status === 'submitted' && subSt[0].n === 2 && jobSt === 'submitted', `Submit for moderation: 2 products → submitted, job ${jobSt}`);
  const queueCount = Number((await db.query(`select count(*) n from products where sku like $1 and status in ('submitted', 'in_review')`, [`${P}-%`])).rows[0].n);
  ok(queueCount === 2, `moderation queue (submitted / in_review) holds both (${queueCount})`);
  // 3 · same file again → updates nothing (no duplicates)
  const tpl2 = new ExcelJS.Workbook(); await tpl2.xlsx.readFile(path.join(tmp, fs.readdirSync(tmp).filter((f) => f.startsWith('up-')).sort()[0]));
  await upload(tpl2, zip1);
  ok(/No change/.test(await rowText(2)) && /No change/.test(await rowText(3)), 're-uploading the same SKUs updates instead of duplicating (no changes → skipped)');
  ok(Number((await db.query(`select count(*) n from products where sku like $1`, [`${P}-%`])).rows[0].n) === 2, 'still exactly 2 products for those SKUs');

  // 4 · export → re-import unedited = zero changes; 5 · edit one price → one update with a diff
  await open();
  const exp = await download('Download my products');
  const ew = exp.getWorksheet('Products');
  const mine = []; ew.eachRow((r, n) => { if (n > 1 && String(r.getCell(1).value ?? '').startsWith(P)) mine.push(n); });
  ok(mine.length === 2 && ew.getCell(`T${mine[0]}`).value === 'QA1.JPG', 'export has the v2 layout with SKU and current image names');
  // keep only this run's rows so the test does not depend on other products of the supplier
  for (let n = ew.rowCount; n >= 2; n--) if (!mine.includes(n)) ew.spliceRows(n, 1);
  await upload(exp, null);
  const sum0 = await page.getByTestId('import-summary').innerText();
  ok(/0 new · 0 updates · 2 unchanged · 0 with errors/.test(sum0), `export → import round-trip yields zero changes (${sum0.trim()})`);
  // category rule: blank on an update keeps it; a different category is a highlighted change before commit
  const catCell = ew.getCell('C2').value;
  ew.getCell('C2').value = null;
  await upload(exp, null);
  ok(/No change/.test(await rowText(2)) && await page.getByTestId('category-change').count() === 0, 'blank category cell on an update keeps the current category (no change)');
  const otherCat = (await db.query(`select name from categories where active and parent_id is null and name <> split_part($1, ' > ', 1) order by name limit 1`, [String(catCell)])).rows[0].name;
  ew.getCell('C2').value = otherCat;
  await upload(exp, null);
  ok(await page.getByTestId('category-change').count() === 1 && await page.getByTestId('category-change-notice').isVisible() && /category/.test(await rowText(2)),
    `a different category (${otherCat}) shows as a highlighted "Category change" before commit`);
  ew.getCell('C2').value = catCell;
  ew.getCell('M2').value = 0.21;
  await upload(exp, null);
  ok(/1 updates/.test(await page.getByTestId('import-summary').innerText()) && /price tiers/.test(await rowText(2)), 'one edited price → 1 update with a field diff');
  await confirm();
  ok(Number((await db.query(`select unit_price_cents c from price_tiers t join products p on p.id = t.product_id where p.sku = $1 and t.min_qty = 100`, [`${P}-001`])).rows[0].c) === 21, 'the update saved the new price');
  ok((await db.query(`select status from products where sku = $1`, [`${P}-001`])).rows[0].status === 'submitted', 're-import (update) after submit keeps status submitted');

  // 5b · step C guard: prices equal to the supplier cost on every tier → flagged, commit blocked until confirmed
  const p1 = (await db.query(`select id from products where sku = $1`, [`${P}-001`])).rows[0].id;
  await db.query(`insert into supplier_products(supplier_id, product_id, status) values ($1, $2, 'quoted') on conflict do nothing`, [supplier.id, p1]);
  await db.query(`insert into supplier_product_prices(supplier_id, product_id, incoterm, moq_tier_min, price_minor, valid_from) values ($1, $2, 'FOB', 100, 2100, current_date), ($1, $2, 'FOB', 500, 1500, current_date)`, [supplier.id, p1]);
  ew.getCell('M2').value = 0.21; ew.getCell('O2').value = 0.15;   // = supplier cost on both tiers
  await upload(exp, null);
  ok(/price equals supplier cost, buyer price not applied/.test(await rowText(2)) && await page.getByTestId('cost-flag').isVisible() && await page.getByRole('button', { name: /Confirm and import/ }).count() === 0,
    'price = supplier cost on every tier → row flagged, Confirm and import hidden');
  page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: 'I confirm these prices' }).click();
  await page.getByText(/confirmed on/).waitFor({ timeout: 30000 });
  ok(await page.getByRole('button', { name: /Confirm and import/ }).count() === 1, 'after explicit confirmation the import can go ahead (audited)');
  ew.getCell('O2').value = null; ew.getCell('N2').value = null; ew.getCell('M2').value = 0.26;   // single tier, buyer price above cost for the next steps
  // 6 · race: two jobs validated with the same new SKU; the second commit reports a row error, not a 500
  ew.getCell('A2').value = `${P}-RACE`; ew.spliceRows(3, 1);
  const jobA = await upload(exp, null); const jobB = await upload(exp, null);
  await page.goto(`${IMPORT}?job=${jobA}`); await confirm();
  await page.goto(`${IMPORT}?job=${jobB}`); await page.getByTestId('import-summary').waitFor();
  page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: /Confirm and import/ }).click();
  await page.getByText('SKU already used by another supplier').first().waitFor({ timeout: 60000 }).catch(() => {});
  ok(/SKU already used by another supplier/.test(await rowText(2)), 'concurrent upload of the same new SKU → row error on the second commit');

  // 7 · Generate SKUs fills blanks with free category-coded SKUs
  const g = new ExcelJS.Workbook(); await g.xlsx.readFile(path.join(tmp, fs.readdirSync(tmp).filter((f) => f.includes('octopus-product-template')).sort()[0]));
  const gws = g.getWorksheet('Products'); gws.getCell('A2').value = null; gws.getRow(3).values = [null, 'QA gen', gws.getCell('C2').value, supplier.code];
  const gf = path.join(tmp, 'gen.xlsx'); await g.xlsx.writeFile(gf);
  await open();
  await page.locator('input[aria-label="Filled template for SKU generation"]').setInputFiles(gf);
  const [gdl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Generate SKUs' }).click()]);
  const gout = path.join(tmp, 'gen-out.xlsx'); await gdl.saveAs(gout);
  const gw = new ExcelJS.Workbook(); await gw.xlsx.readFile(gout);
  const s2 = String(gw.getWorksheet('Products').getCell('A2').value), s3 = String(gw.getWorksheet('Products').getCell('A3').value);
  const taken = (await db.query(`select count(*) n from sku_reservations where sku_norm in ($1, $2)`, [s2, s3])).rows[0].n;
  ok(/^[A-Z]{3}-\d{6}$/.test(s2) && /^[A-Z]{3}-\d{6}$/.test(s3) && s2 !== s3 && Number(taken) === 0, `Generate SKUs filled blanks with free SKUs (${s2}, ${s3})`);
  await ctx.close();
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  const ids = (await db.query(`select id from products where sku like $1`, [`${P}-%`])).rows.map((r) => r.id);
  const shas = (await db.query(`select distinct storage_path from product_media where product_id = any($1) and storage_path is not null`, [ids])).rows.map((r) => r.storage_path);
  if (ids.length) {
    await db.query(`delete from import_rows where product_id = any($1)`, [ids]);
    await db.query(`delete from audit_log where entity = 'products' and entity_id = any($1::text[])`, [ids]).catch(() => {});
    await db.query(`delete from products where id = any($1)`, [ids]);
  }
  await db.query(`delete from sku_reservations where sku_norm like $1`, [`${P}-%`]);   // test SKUs only
  for (const sp of shas) { const used = (await db.query(`select 1 from product_media where storage_path = $1 limit 1`, [sp])).rowCount; if (!used) await admin.storage.from('product-media').remove([sp]); }
  if (uid) {
    const jobs = (await db.query(`select id, zip_path from import_jobs where created_by = $1`, [uid])).rows;
    const zips = jobs.map((j) => j.zip_path).filter(Boolean); if (zips.length) await admin.storage.from('imports').remove(zips);
    await db.query(`delete from import_jobs where created_by = $1`, [uid]);
    await db.query(`delete from distributor_suppliers where distributor_id = $1`, [uid]);
    await db.query('delete from auth.mfa_factors where user_id = $1', [uid]);
    await db.query('delete from user_roles where user_id = $1', [uid]);
    await db.query('delete from profiles where id = $1', [uid]);
    await admin.auth.admin.deleteUser(uid);
  }
  const left = Number((await db.query(`select count(*) n from products where sku like $1`, [`${P}-%`])).rows[0].n);
  ok(left === 0, `clean-up: ${ids.length} test product(s), their SKU reservations, images, jobs and the temporary distributor removed`);
  await db.end();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\nsku import: ${failed} check(s) failed` : '\nsku import: all passed');
  process.exitCode = failed ? 1 : 0;
}
