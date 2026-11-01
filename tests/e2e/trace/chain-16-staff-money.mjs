// Chain 16 — Staff login → workspace → money action (SPEC §21.1 #16).
// finance@ signs in through /staff/login + /staff/verify (TOTP on a temporary factor), opens Finance, confirms a bank
// top-up (money). Negatives: password-only session has no staff access; a stale TOTP (older than step_up_minutes)
// gets STEP_UP_REQUIRED on the money RPC (rolled-back transaction with stale JWT claims).
import { chromium } from '@playwright/test';
import pg from 'pg';
import { BASE, count, ensureBuyer, hops, newTrace, PW, pwCookies, remember, reporter, signIn, sql, totp, traceRows, loadState, traced } from './lib.mjs';

const { r, check, note, save } = reporter(16, 'Staff login → workspace → money action');
const trace = newTrace(16);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const browser = await chromium.launch();
try {
  const EMAIL = 'finance@demo.octopusb2b.com';
  await signIn(EMAIL, trace, { staff: true }); // makes sure our temporary TOTP factor exists (secret kept for the run)
  const secret = loadState().secrets[EMAIL].secret;
  const buyer = await ensureBuyer('a');
  const sbA = await signIn(buyer.email, trace);
  const ref = 'E2E-TRACE-BANK-' + Date.now().toString(36).toUpperCase();
  const { error: te } = await sbA.rpc('request_topup', { p_amount: 10000, p_method: 'bank_transfer', p_reference: ref });
  check(!te, 'customer reported a bank transfer top-up (pending)', te?.message ?? ref);

  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const t0 = Date.now();
  await page.goto(`${BASE}/staff/login`);
  await page.fill('#se', EMAIL);
  await page.fill('#sp', PW);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/staff\/verify/, { timeout: 20000 });
  r.latency['step 1: password → /staff/verify'] = Date.now() - t0;
  // fresh 30 s window so the code does not roll over while typing
  if (Date.now() % 30000 > 25000) await page.waitForTimeout(30000 - (Date.now() % 30000) + 200);
  const code = totp(secret);
  for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1} of 6`).fill(code[i]);
  const tv = Date.now();
  const verifyBtn = page.getByRole('button', { name: 'Verify and continue' });
  if (await verifyBtn.isEnabled().catch(() => false)) await verifyBtn.click().catch(() => null);
  await page.waitForURL(/\/staff\/workspace|\/admin|\/office/, { timeout: 20000 });
  r.latency['step 2: TOTP → workspace'] = Date.now() - tv;
  check(true, 'signed in with 2FA → workspace picker', page.url());
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('tr', { hasText: ref });
  await row.getByRole('button', { name: 'Confirm' }).waitFor({ timeout: 15000 });
  const tc = Date.now();
  await row.getByRole('button', { name: 'Confirm' }).click();
  const credited = await (async () => { for (let i = 0; i < 30; i++) { const [x] = await sql(`select status from wallet_topups where reference=$1`, [ref]); if (x?.status === 'credited') return true; await page.waitForTimeout(500); } return false; })();
  r.latency['money action: Confirm top-up (confirm_topup + step-up check)'] = Date.now() - tc;
  check(credited, 'finance confirmed the top-up with a fresh 2FA session (wallet credited)', ref);
  r.e2e_ms = Date.now() - t0;
  await page.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-16-finance.png' });

  const rows = await traceRows(trace);
  r.hops = hops(rows);
  const actions = (rows.audit_log ?? []).map((a) => a.action);
  r.audit = actions;
  for (const a of ['auth.sign_in', 'auth.2fa_verified']) check(actions.includes(a), `audit: ${a}`, actions.join(', '));
  check(actions.some((a) => /topup|wallet/.test(a)), 'audit: money approval (top-up confirmation) logged', actions.join(', '));
  check(count(rows, 'journals') === 1, 'one credit journal for the confirmation', count(rows, 'journals'));

  // negative 1: password-only session (aal1) → no staff access
  const pw = traced(trace);
  const { data: s1 } = await pw.auth.signInWithPassword({ email: EMAIL, password: PW });
  pw._session = s1.session; pw._user = s1.user;
  const c2 = await browser.newContext();
  await c2.addCookies(pwCookies(pw, { staff: true }));
  const p2 = await c2.newPage();
  await p2.goto(`${BASE}/admin/finance`);
  await p2.waitForURL(/\/staff\/verify/, { timeout: 15000 }).catch(() => null);
  check(/\/staff\/verify/.test(p2.url()), 'negative: staff without aal2 is sent to /staff/verify', p2.url());
  const { error: aal1 } = await pw.rpc('confirm_topup', { p_topup: '00000000-0000-0000-0000-000000000000' });
  check(!!aal1, 'negative: aal1 session calling confirm_topup refused', aal1?.message);
  // negative 2: stale TOTP → STEP_UP_REQUIRED (rolled back)
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query('begin');
  try {
    const fid = (await db.query(`select id from profiles where email=$1`, [EMAIL])).rows[0].id;
    const [{ id: tid }] = (await db.query(`insert into wallet_topups(org_id, amount_cents, method, reference, status) values ($1, 100, 'bank_transfer', 'E2E-STALE', 'pending') returning id`, [loadState().orgA])).rows;
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: fid, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 3600 }] })]);
    await db.query('set local role authenticated');
    let msg = null;
    try { await db.query(`select confirm_topup($1, null)`, [tid]); } catch (e) { msg = e.message; }
    check(/STEP_UP_REQUIRED/.test(msg ?? ''), 'negative: TOTP older than step_up_minutes → STEP_UP_REQUIRED on the money RPC', msg);
  } finally {
    await db.query('rollback');
    await db.end();
  }
  note('UI maps STEP_UP_REQUIRED to /staff/verify?reason=step_up (lib/staff/step-up.ts), covered by the staff-auth suite.');
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
