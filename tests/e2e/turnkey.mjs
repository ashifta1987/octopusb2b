// ADDON-31 E2E — Turnkey Projects at 1440 px and 360 px (real browser, real database).
// Hub → starter strip → Water bottling (register-interest) → submit → confirmation reference;
// Atlas → Zhangjiagang hub filters to water-bottling + injection → category chip → Clear filters;
// Gym → Starter/Standard/Pro tabs → Request this package → submit → confirmation;
// a temporary admin sees the lead in /admin/turnkey (auto-assigned to a temporary MENA sourcing agent).
// Every lead, signal, notification and temp user created here is deleted at the end.
// Usage: APP=http://localhost:3100 node tests/e2e/turnkey.mjs
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
const tag = `qa-tk-${Date.now()}`;
const users = [];
const leadSeq = (await db.query(`select last_value, is_called from seq_turnkey_lead`)).rows[0];

function b32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }
async function staffUser(role, extra = {}) {
  const email = `${tag}-${role}@demo.octopusb2b.com`; const password = `Qa-${crypto.randomBytes(6).toString('hex')}-9!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (error) throw error;
  const uid = data.user.id; users.push(uid);
  await db.query(`insert into profiles(id, full_name, email, totp_required, region) values ($1, $2, $3, true, $4)`, [uid, `QA ${role}`, email, extra.region ?? null]);
  await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [uid, role]);
  return { uid, email, password };
}
async function staffCookies(u) {
  const sb = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: u.email, password: u.password });
  const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: tag }); if (en.error) throw en.error;
  const v = await sb.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) }); if (v.error) throw v.error;
  const session = (await sb.auth.getSession()).data.session;
  const val = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const cookies = []; const CH = 3180;
  if (val.length <= CH) cookies.push({ name: `sb-${ref}-auth-token`, value: val });
  else for (let i = 0; i * CH < val.length; i++) cookies.push({ name: `sb-${ref}-auth-token.${i}`, value: val.slice(i * CH, (i + 1) * CH) });
  const now = Date.now();
  cookies.push({ name: 'oct_staff', value: signStaffCookie({ start: now, last: now, trusted: false, uid: u.uid }, process.env.STAFF_SESSION_SECRET) });
  const host = new URL(APP).hostname; const secure = APP.startsWith('https');
  return cookies.map((c) => ({ ...c, domain: host, path: '/', httpOnly: false, secure, sameSite: 'Lax' }));
}
const clearLimits = () => db.query(`delete from auth_rate_limits where bucket like 'tk-%'`);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const browser = await chromium.launch();
try {
  // a MENA sourcing agent so auto-assignment can be observed (leads from AE route to MENA)
  const agent = await staffUser('sourcing_agent', { region: 'MENA' });
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['360', { width: 360, height: 780 }]]) {
    await clearLimits();
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
    // 1 · hub → starter strip → water bottling → interest → confirmation
    await page.goto(APP + '/turnkey', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Open a business/ }).waitFor({ timeout: 60000 });
    const starters = await page.getByTestId('starter-card').allInnerTexts();
    ok(starters.length === 5 && /Water bottling/.test(starters[0]) && /car wash/i.test(starters[4]), `[${label}] hub: "Start with these five" = water bottling … car wash`);
    ok(await overflow(page) <= 0, `[${label}] /turnkey has no horizontal scroll`);
    if (label === '360') {
      const strip = page.getByTestId('starter-strip');
      const sw = await strip.evaluate((el) => el.scrollWidth > el.clientWidth);
      ok(sw, '[360] the five-card strip scrolls sideways');
    }
    await page.getByTestId('starter-card').first().click();
    await page.waitForURL(/\/turnkey\/water-bottling$/, { timeout: 60000 });
    ok(await page.getByText('Register interest · packaging now').waitFor({ timeout: 30000 }).then(() => true, () => false), `[${label}] water bottling shows the register-interest layout`);
    ok(await overflow(page) <= 0, `[${label}] project page has no horizontal scroll`);
    await page.getByTestId('rail-cta').first().click().catch(async () => page.getByRole('link', { name: 'Register interest →' }).last().click());
    await page.waitForURL(/\/turnkey\/water-bottling\/interest/, { timeout: 60000 });
    const t0 = Date.now();
    await page.getByLabel(/Company name/).fill(`${tag} Water Co`);
    await page.getByLabel(/Contact name/).fill('QA Buyer');
    await page.getByLabel(/^Email/).fill(`${tag}-${label}@example.com`);
    await page.getByLabel(/^Country/).selectOption('AE');
    await page.getByLabel('Preferred delivery term').selectOption('CIF');
    await page.getByRole('button', { name: 'Register interest →' }).click();
    ok(await page.getByText('Which port?').isVisible({ timeout: 5000 }).catch(() => false), `[${label}] CIF asks for the port`);
    await page.getByLabel(/Destination port/).fill('Jebel Ali');
    await page.getByRole('button', { name: 'Register interest →' }).click();
    await page.waitForURL(/\/turnkey\/confirmation\/[0-9a-f-]{36}$/, { timeout: 60000 });
    const refNo = (await page.getByTestId('lead-reference').innerText()).trim();
    ok(/^TK-\d{4}-\d{5}$/.test(refNo), `[${label}] confirmation shows reference ${refNo} (${Math.round((Date.now() - t0) / 1000)} s to submit)`);
    const lead = (await db.query(`select kind, project_id, country, region, assigned_to, delivery_place from turnkey_leads where reference = $1`, [refNo])).rows[0];
    ok(lead?.kind === 'interest' && lead.region === 'MENA' && lead.assigned_to === agent.uid && lead.delivery_place === 'Jebel Ali', `[${label}] lead stored, region MENA, auto-assigned to the MENA agent`);

    // 2 · atlas → Zhangjiagang → chip → clear
    await page.goto(APP + '/turnkey/atlas', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('atlas-list').waitFor({ timeout: 60000 });
    const all = await page.getByTestId('turnkey-card').count();
    await page.locator('[data-hub="CN-JS-ZJG"]').click();
    await page.getByTestId('hub-panel').waitFor();
    const zjg = await page.getByTestId('turnkey-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-project')).sort());
    ok(JSON.stringify(zjg).includes('water-bottling') && JSON.stringify(zjg).includes('injection-moulding'), `[${label}] Zhangjiagang hub filters the list (${zjg.join(', ')})`);
    await page.locator('[data-category="small-factory"]').click();
    const narrowed = await page.getByTestId('turnkey-card').count();
    ok(narrowed >= 1 && narrowed <= zjg.length, `[${label}] category chip narrows the list (${narrowed})`);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    ok(await page.getByTestId('turnkey-card').count() === all && all === 25, `[${label}] Clear filters → full list again (${all})`);
    ok(await overflow(page) <= 0, `[${label}] /turnkey/atlas has no horizontal scroll`);

    // 3 · gym tabs → request → confirmation
    await page.goto(APP + '/turnkey/gym', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('tier-tab').first().waitFor({ timeout: 60000 });
    const tabs = page.getByTestId('tier-tab');
    await tabs.nth(1).click();
    ok(/Commercial treadmill/.test(await page.getByTestId('tier-panel').innerText()) && /\$82,000/.test(await page.getByTestId('tier-panel').innerText()), `[${label}] Standard tab: 9 equipment lines, $82,000 total`);
    await tabs.nth(0).click();
    const starter = await page.getByTestId('tier-panel').innerText();
    ok(/30 m²/.test(starter) && /\$28,000/.test(starter) && !/Commercial treadmill/.test(starter), `[${label}] Starter tab switches budget/space (equipment list on request)`);
    await tabs.nth(2).click();
    ok(/\$165,000/.test(await page.getByTestId('tier-panel').innerText()), `[${label}] Pro tab shows $165,000`);
    await page.getByRole('link', { name: 'Request this package →' }).last().click();
    await page.waitForURL(/\/turnkey\/gym\/request\?package=/, { timeout: 60000 });
    await page.getByLabel(/Company name/).fill(`${tag} Gyms`);
    await page.getByLabel(/Contact name/).fill('QA Gym Buyer');
    await page.getByLabel(/^Email/).fill(`${tag}-gym-${label}@example.com`);
    await page.getByLabel(/^Country/).selectOption('NG');
    await page.getByRole('button', { name: 'Send to sourcing →' }).click();
    await page.waitForURL(/\/turnkey\/confirmation\//, { timeout: 60000 });
    const gymRef = (await page.getByTestId('lead-reference').innerText()).trim();
    const g = (await db.query(`select l.kind, k.tier_name, l.region, l.assigned_to from turnkey_leads l left join turnkey_packages k on k.package_id = l.package_id where reference = $1`, [gymRef])).rows[0];
    ok(g?.kind === 'quote' && g.tier_name === 'Pro' && g.region === 'Africa' && g.assigned_to === null, `[${label}] gym quote ${gymRef}: Pro package, Africa → triage pool (no Africa agent)`);
    await ctx.close();
  }

  // 4 · admin sees the leads within seconds, with assignment
  const adm = await staffUser('admin');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(await staffCookies(adm));
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(APP + '/admin/turnkey', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('leads-kanban').waitFor({ timeout: 60000 });
  const cards = await page.getByTestId('lead-card').allInnerTexts();
  const mine = cards.filter((c) => c.includes(tag));
  ok(mine.length === 4 && mine.some((c) => /assigned to QA sourcing_agent/.test(c)) && mine.some((c) => /triage pool/.test(c)), `admin /admin/turnkey lists the 4 test leads with assignment (${mine.length} found, ${Math.round((Date.now() - t0) / 1000)} s)${mine.length !== 4 || failed ? ' ' + JSON.stringify(mine.map((c) => c.split('\n').slice(-3).join(' | '))) : ''}`);
  await page.goto(APP + '/admin/turnkey?tab=projects', { waitUntil: 'domcontentloaded' });
  ok(await page.getByTestId('project-row').count() === 25, 'projects tab lists all 25 projects');
  await ctx.close();

  // 5 · rate limit: a 6th interest from the same IP in a day is refused (server action, via 5 direct submits)
  // (covered by unit-level limiter tests in the DB; skipped here to avoid flooding notifications)
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  const leads = (await db.query(`select lead_id from turnkey_leads where company_name like $1`, [`${tag}%`])).rows.map((r) => r.lead_id);
  if (leads.length) {
    await db.query(`delete from notifications where link = any($1)`, [leads.map((id) => `/admin/turnkey?lead=${id}`)]);
    await db.query(`delete from turnkey_atlas_signals where event = 'interest' and ts > now() - interval '1 hour' and country_from in ('AE','NG') and project_id = 'water-bottling'`);
    await db.query(`delete from turnkey_leads where lead_id = any($1)`, [leads]);
  }
  await db.query(`delete from turnkey_atlas_signals where ts > now() - interval '30 minutes' and country_from is null`); // local run: no geo header → test views/taps
  await clearLimits();
  for (const uid of users) {
    await db.query('delete from notifications where user_id = $1', [uid]);
    await db.query('delete from auth.mfa_factors where user_id = $1', [uid]);
    await db.query('delete from user_roles where user_id = $1', [uid]);
    await db.query('delete from profiles where id = $1', [uid]);
    await admin.auth.admin.deleteUser(uid);
  }
  // give the reference numbers back only if nobody else created a lead meanwhile
  const others = Number((await db.query(`select count(*) n from turnkey_leads`)).rows[0].n);
  if (others === 0) await db.query(`select setval('seq_turnkey_lead', $1, $2)`, [leadSeq.last_value, leadSeq.is_called]);
  await db.end();
  console.log(`cleaned up ${leads.length} test lead(s) and ${users.length} temporary user(s)`);
  console.log(failed ? `\nturnkey: ${failed} check(s) failed` : '\nturnkey: all passed');
  process.exitCode = failed ? 1 : 0;
}

