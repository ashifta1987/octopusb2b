// ADDON-29 E2E — download template → fill → upload → preview → commit, driven through the real UI as a temporary admin.
// (a) blank template, 2 rows for throwaway supplier CN-ZZ-QAT-0001 (1 with an image) → commit → 2 products, 1 image → FULL CLEAN-UP
// (b) pre-filled Bowijie template, one price edited → preview shows exactly 1 price update, everything else skips → discarded
// (c) a blank Product Id → preview lists the error and offers no Commit button → discarded
// Usage: APP=http://localhost:3100 node tests/e2e/template-roundtrip.mjs
import crypto from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium } from '@playwright/test';
import ExcelJS from 'exceljs'; import { zipSync } from 'fflate';
import { config } from 'dotenv'; import pg from 'pg'; import { createClient } from '@supabase/supabase-js';
import { signStaffCookie } from '../../lib/staff/session-cookie.ts';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref = new URL(URL_).hostname.split('.')[0];
const QA = 'CN-ZZ-QAT-0001';
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
const email = `qa-template-${Date.now()}@demo.octopusb2b.com`; const password = `Qa-${crypto.randomBytes(6).toString('hex')}-9!`;
let uid = null;
const runsBefore = new Set((await db.query('select id from import_runs')).rows.map((r) => r.id));
const seqSnapshot = (await db.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)).rows;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oct-tpl-'));

function b32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }
// smallest valid JPEG-ish payload is enough: storage stores bytes, the importer checks name/extension/size
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

const browser = await chromium.launch();
try {
  const { data: cu, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  uid = cu.user.id;
  await db.query(`insert into profiles(id, full_name, email, totp_required) values ($1, 'QA template admin', $2, true)`, [uid, email]);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'admin')`, [uid]);
  const sb = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email, password });
  const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'qa-template' });
  if (en.error) throw en.error;
  const v = await sb.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  if (v.error) throw v.error;
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

  const openImport = async () => {
    await page.goto(APP + '/admin/import', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Blank template' }).waitFor({ timeout: 60000 });
  };
  const download = async (button) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: button }).click()]);
    const file = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(file);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); return { wb, name: dl.suggestedFilename() };
  };
  const upload = async (name, xlsxFile, zipFile) => {
    await openImport();
    await page.getByLabel('Import name').fill(name);
    await page.getByLabel('Supplier workbook (.xlsx, max 50 MB)').setInputFiles(xlsxFile);
    if (zipFile) await page.getByLabel('Product photos (.zip, optional)').setInputFiles(zipFile);
    await page.getByLabel('Supplier prices valid from').fill('2026-11-01');
    await page.getByRole('button', { name: 'Upload and preview' }).click();
    await page.waitForURL(/\/admin\/import\/[0-9a-f-]{36}$/, { timeout: 120000 });
    return page.url().split('/').pop();
  };
  const discard = async () => {
    page.once('dialog', (dlg) => dlg.accept());
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.waitForTimeout(1500);
  };

  // UI: template card
  await openImport();
  const body0 = await page.locator('main').innerText();
  ok(/Supplier to pre-fill/.test(body0) && /Filenames must match the Image file column exactly, including case/.test(body0), 'template card: supplier picker + .xlsx/.zip reminder');
  ok(await page.getByRole('button', { name: 'Template pre-filled with existing products' }).isDisabled(), 'pre-filled button is disabled until a supplier is chosen');
  await page.getByLabel('Factory models (one per line)').fill('F8制冷手持风扇\nP10 Humidifier');
  await page.getByLabel('Supplier external id').fill('CN-GD-BWJ-0010');
  ok((await page.getByTestId('generated-ids').innerText()).trim() === 'CN-GD-BWJ-F8\nCN-GD-BWJ-P10', 'Generate Product Ids → CN-GD-BWJ-F8, CN-GD-BWJ-P10');

  // (a) blank → fill 2 rows → commit
  const { wb: blank, name: blankName } = await download('Blank template');
  ok(blank.worksheets.map((w) => w.name).join(',') === 'README,Supplier,Products,Not Quoted' && blank.getWorksheet('Products').getCell('A1').value === 'Product Id' && blank.getWorksheet('Products').getCell('I1').value === 'Image file',
    `blank template downloaded (${blankName}): README, Supplier, Products, Not Quoted; A1 Product Id, I1 Image file`);
  const sup = blank.getWorksheet('Supplier');
  sup.getCell('B2').value = QA; sup.getCell('B3').value = 'QAT'; sup.getCell('B4').value = 'QA Tester, Sales'; sup.getCell('B6').value = 'qa@example.com';
  sup.getCell('A11').value = 'QA Throwaway Trading Co., Ltd.'; sup.getCell('D11').value = 'true';
  const ws = blank.getWorksheet('Products');
  ws.getRow(2).values = ['CN-ZZ-QAT-A1', 'A1', null, 'Electronics', 2.5, 'FOB, MOQ 500', null, null, 'qa1.jpg'];
  ws.getRow(3).values = ['CN-ZZ-QAT-A2', 'A2', null, 'Electronics', 3.75, 'FOB, MOQ 200'];
  const fileA = path.join(tmp, 'qa-a.xlsx'); await blank.xlsx.writeFile(fileA);
  const zipA = path.join(tmp, 'qa-a.zip'); fs.writeFileSync(zipA, Buffer.from(zipSync({ 'photos/qa1.jpg': new Uint8Array(JPG) })));
  const runA = await upload('QA template round trip (a)', fileA, zipA);
  const dA = (await db.query('select diff, staging from import_runs where id = $1', [runA])).rows[0];
  ok((dA.staging.errors ?? []).length === 0 && dA.diff.products.create === 2 && dA.diff.images.create === 1, `preview (a): 2 new products, 1 image, no errors (${JSON.stringify(dA.staging.errors ?? [])})`);
  page.once('dialog', (dlg) => dlg.accept());
  await page.getByRole('button', { name: 'Commit import' }).click();
  await page.getByText(/Committed/).first().waitFor({ timeout: 120000 });
  const made = (await db.query(`select p.external_id, p.status, (select count(*) from product_media m where m.product_id = p.id) imgs from products p where p.external_id like 'CN-ZZ-QAT-%' order by 1`)).rows;
  ok(made.length === 2 && made.filter((m) => Number(m.imgs) === 1).length === 1 && made.find((m) => m.external_id === 'CN-ZZ-QAT-A1' && Number(m.imgs) === 1),
    `commit (a): 2 products created (${made.map((m) => `${m.external_id}:${m.status}:${m.imgs} img`).join(', ')}), exactly 1 with an image`);

  // (b) pre-filled Bowijie → edit one price → 1 price update
  const bwj = (await db.query(`select id from suppliers where external_id = 'CN-GD-BWJ-0010'`)).rows[0];
  await openImport();
  await page.getByLabel('Supplier to pre-fill').selectOption(bwj.id);
  const { wb: pre, name: preName } = await download('Template pre-filled with existing products');
  let edited = 0;
  for (const s of pre.worksheets) s.eachRow((row) => { if (row.getCell(1).value === 'CN-GD-BWJ-F9') { row.getCell(5).value = 4.7; edited++; } });
  ok(pre.getWorksheet('Supplier').getCell('B2').value === 'CN-GD-BWJ-0010' && edited === 1, `pre-filled template downloaded (${preName}); F9 price edited 4.61 → 4.70`);
  const fileB = path.join(tmp, 'qa-b.xlsx'); await pre.xlsx.writeFile(fileB);
  const runB = await upload('QA template round trip (b)', fileB, 'data/bulk/bowijie/images.zip');
  const dB = (await db.query('select diff from import_runs where id = $1', [runB])).rows[0].diff;
  ok(dB.prices.update === 1 && dB.prices.create === 0 && dB.products.create === 0 && dB.products.update === 0 && dB.images.create === 0,
    `preview (b): prices ${dB.prices.create}/${dB.prices.update}/${dB.prices.skip}, products ${dB.products.create}/${dB.products.update}/${dB.products.skip}, images +${dB.images.create}`);
  ok(await page.getByTestId('field-change').count() === 1 && /4\.61.*4\.70|4\.61[\s\S]*4\.7/.test(await page.getByTestId('field-change').first().innerText()), 'preview (b) lists the one field change (4.61 → 4.70)');
  await discard();
  ok((await db.query('select status from import_runs where id = $1', [runB])).rows[0].status === 'discarded', 'run (b) discarded — nothing written');

  // (c) blank Product Id → error, no Commit
  const bad = new ExcelJS.Workbook(); await bad.xlsx.readFile(fileA);
  bad.getWorksheet('Products').getCell('A3').value = null;
  const fileC = path.join(tmp, 'qa-c.xlsx'); await bad.xlsx.writeFile(fileC);
  const runC = await upload('QA template round trip (c)', fileC, zipA);
  const errText = await page.getByTestId('import-error').first().innerText().catch(() => '');
  ok(/Product Id/i.test(errText) && await page.getByRole('button', { name: 'Commit import' }).count() === 0, `preview (c): error shown ("${errText.replace(/\s+/g, ' ').slice(0, 90)}"), no Commit button`);
  await discard();
  void runC;

  // mobile: preview page and template card don't overflow
  await page.setViewportSize({ width: 390, height: 844 });
  await openImport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, `no horizontal scroll on /admin/import at 390px (${overflow}px)`);
  await ctx.close();
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  // ── clean-up: throwaway supplier + products + everything that references them, storage, runs, temp admin, sequences
  const prodIds = (await db.query(`select id from products where external_id like 'CN-ZZ-QAT-%'`)).rows.map((r) => r.id);
  const supIds = (await db.query(`select id from suppliers where external_id = $1`, [QA])).rows.map((r) => r.id);
  const refs = async (table) => (await db.query(`
    select c.conrelid::regclass::text t, a.attname col from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1`, [table])).rows;
  try {
    await db.query('begin');
    if (prodIds.length) for (const r of await refs('public.products')) await db.query(`delete from ${r.t} where ${r.col} = any($1)`, [prodIds]);
    if (prodIds.length) await db.query('delete from products where id = any($1)', [prodIds]);
    if (supIds.length) for (const r of await refs('public.suppliers')) await db.query(`delete from ${r.t} where ${r.col} = any($1)`, [supIds]);
    if (supIds.length) await db.query('delete from suppliers where id = any($1)', [supIds]);
    await db.query('commit');
  } catch (e) { await db.query('rollback'); console.log('✘ clean-up failed:', e.message); failed++; }
  const { data: objs } = await admin.storage.from('product-media').list(`import/${QA}`);
  if (objs?.length) await admin.storage.from('product-media').remove(objs.map((o) => `import/${QA}/${o.name}`));
  const mine = (await db.query('select id from import_runs where created_by = $1', [uid])).rows.map((r) => r.id).filter((id) => !runsBefore.has(id));
  if (mine.length) await db.query('delete from import_runs where id = any($1)', [mine]);
  if (uid) {
    await db.query('delete from auth.mfa_factors where user_id = $1', [uid]);
    await db.query('delete from user_roles where user_id = $1', [uid]);
    await db.query('delete from profiles where id = $1', [uid]);
    await admin.auth.admin.deleteUser(uid);
  }
  // give back only the supplier record number the throwaway supplier used (OCT-xxxx). Never rewind other sequences:
  // audit_log rows written by the commit stay, so rewinding audit_log_id_seq would cause duplicate keys.
  for (const r of seqSnapshot.filter((x) => x.sequencename === 'seq_supplier_code')) {
    const max = Number((await db.query(`select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::bigint), 0) m from suppliers`)).rows[0].m);
    await db.query(`select setval($1, $2, true)`, [r.sequencename, Math.max(Number(r.last_value ?? 0), max)]);
  }
  const left = Number((await db.query(`select (select count(*) from products where external_id like 'CN-ZZ-QAT-%') + (select count(*) from suppliers where external_id = $1) n`, [QA])).rows[0].n);
  ok(left === 0, `clean-up: throwaway supplier/products removed (${prodIds.length} products, ${supIds.length} supplier, ${objs?.length ?? 0} storage files, ${mine.length} runs), sequences restored`);
  await db.end();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\ntemplate round trip: ${failed} check(s) failed` : '\ntemplate round trip: all passed');
  process.exitCode = failed ? 1 : 0;
}
