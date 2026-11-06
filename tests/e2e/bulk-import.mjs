// ADDON-27 E2E — Admin → Bulk import, driven through the real UI as a temporary admin (created and removed here).
// Uploads data/bulk/bowijie/source.xlsx + images.zip; expects a preview of 69 products / 77 prices / 53 images and,
// because the catalogue was already imported, ZERO creates and ZERO updates (idempotent). Commits that no-op run,
// checks the review queue, the supplier identity panel, the publish gate message, and that drafts stay off the storefront.
// Usage: APP=http://localhost:3100 node tests/e2e/bulk-import.mjs
import crypto from 'node:crypto';
import { chromium } from '@playwright/test';
import { config } from 'dotenv'; import pg from 'pg'; import { createClient } from '@supabase/supabase-js';
import { signStaffCookie } from '../../lib/staff/session-cookie.ts';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref = new URL(URL_).hostname.split('.')[0];
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
const email = `qa-import-${Date.now()}@demo.octopusb2b.com`; const password = `Qa-${crypto.randomBytes(6).toString('hex')}-9!`;
let uid = null; const runsBefore = new Set((await db.query('select id from import_runs')).rows.map((r) => r.id));

function b32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }

const browser = await chromium.launch();
try {
  const { data: cu, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  uid = cu.user.id;
  await db.query(`insert into profiles(id, full_name, email, totp_required) values ($1, 'QA import admin', $2, true)`, [uid, email]);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'admin')`, [uid]);
  const sb = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email, password });
  const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'qa-import' });
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(cookies.map((c) => ({ ...c, domain: host, path: '/', httpOnly: false, secure, sameSite: 'Lax' })));
  const page = await ctx.newPage();

  // 1 · upload through the wizard
  await page.goto(APP + '/admin/import', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Import name').waitFor({ timeout: 60000 });
  ok(await page.getByRole('link', { name: 'Bulk import' }).count() > 0, 'admin nav has "Bulk import"');
  await page.getByLabel('Import name').fill('QA re-import (idempotency check)');
  await page.getByLabel('Supplier workbook (.xlsx, max 50 MB)').setInputFiles('data/bulk/bowijie/source.xlsx');
  await page.getByLabel('Product photos (.zip, optional)').setInputFiles('data/bulk/bowijie/images.zip');
  await page.getByLabel('Supplier prices valid from').fill('2026-11-01');
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  await page.waitForURL(/\/admin\/import\/[0-9a-f-]{36}$/, { timeout: 120000 });
  const runId = page.url().split('/').pop();
  ok(true, `preview created (${runId})`);

  // 2 · preview numbers
  const stat = async (label) => (await page.locator('div', { has: page.getByText(label, { exact: true }) }).locator('.font-display, [class*="text-["]').first().textContent())?.trim();
  const body = await page.locator('main').innerText();
  ok(/Products\s*69/.test(body) && /Tiered prices\s*77/.test(body) && /Images\s*53/.test(body), 'preview shows 69 products · 77 tiered prices · 53 images');
  const run = (await db.query('select diff from import_runs where id = $1', [runId])).rows[0];
  const d = run.diff;
  ok(d.products.create === 0 && d.products.update === 0 && d.products.skip === 69 && d.prices.create === 0 && d.prices.update === 0 && d.prices.skip === 77 && d.images.create === 0,
    `re-importing the same workbook: 0 create · 0 update (products skip ${d.products.skip}, prices skip ${d.prices.skip}, images skip ${d.images.skip})`);
  ok(/legal names in use/i.test(body), 'preview warns about the 3 legal-name variants');
  void stat;

  // 3 · commit the no-op run
  page.once('dialog', (dlg) => dlg.accept());
  await page.getByRole('button', { name: 'Commit import' }).click();
  await page.getByText(/Committed/).first().waitFor({ timeout: 120000 });
  const rep = (await db.query('select status, report from import_runs where id = $1', [runId])).rows[0];
  ok(rep.status === 'committed' && rep.report.products.create === 0 && rep.report.prices.create === 0 && rep.report.images.create === 0, 'commit of the identical workbook wrote nothing new');

  // 4 · review queue
  await page.goto(APP + '/admin/import/review', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Import review queue' }).waitFor({ timeout: 60000 });
  const open = Number((await db.query(`select count(*) n from import_review_items where status = 'open'`)).rows[0].n);
  ok(open >= 31 && await page.getByText('CN-GD-BWJ-F8').first().isVisible(), `review queue lists the open items (${open}) incl. F8`);
  ok(await page.getByRole('button', { name: 'Accept quote' }).first().isVisible(), 'each item has one-click decisions (Accept quote / dashboard / Resolved / Hold)');
  ok(await page.getByText('Buyer prices for these products').isVisible(), 'buyer-price panel (cost × markup) is shown');

  // 5 · supplier identity panel
  const sup = (await db.query(`select id, code from suppliers where external_id = 'CN-GD-BWJ-0010'`)).rows[0];
  await page.goto(`${APP}/admin/suppliers?id=${sup.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Legal-name variants').waitFor({ timeout: 60000 });
  ok(await page.getByText(/legal names in use — resolve before the first order ships/).isVisible() && await page.getByRole('button', { name: 'Use this name' }).count() === 3,
    `${sup.code}: identity banner with 3 "Use this name" choices`);

  // 6 · drafts are not on the storefront; publish gate message is friendly
  const store = await (await fetch(`${APP}/search?q=${encodeURIComponent('Handheld Fan with Animated Face')}`)).text();
  ok(!/CN-GD-BWJ|Animated Face Display, 4000mAh/.test(store), 'draft Bowijie products are not on the storefront');
  const gate = await db.query(`update products set status = 'live' where external_id = 'CN-GD-BWJ-F15'`).then(() => 'no error', (e) => e.message);
  ok(/IMPORT_PUBLISH_BLOCKED.*legal-name/.test(gate), `publish gate blocks while the identity is unresolved (${gate.slice(0, 80)}…)`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, `no horizontal scroll on the admin page (${overflow}px)`);
  await ctx.close();
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  // remove this test's import runs (the real Bowijie run stays) and the temporary admin
  const mine = (await db.query('select id from import_runs where created_by = $1', [uid])).rows.map((r) => r.id).filter((id) => !runsBefore.has(id));
  if (mine.length) await db.query('delete from import_runs where id = any($1)', [mine]);
  if (uid) {
    await db.query('delete from auth.mfa_factors where user_id = $1', [uid]);
    await db.query('delete from user_roles where user_id = $1', [uid]);
    await db.query('delete from profiles where id = $1', [uid]);
    await admin.auth.admin.deleteUser(uid);
  }
  await db.end();
  console.log(`cleaned up temporary admin and ${mine.length} test import run(s)`);
  console.log(failed ? `\nbulk import: ${failed} check(s) failed` : '\nbulk import: all passed');
  process.exitCode = failed ? 1 : 0;
}

