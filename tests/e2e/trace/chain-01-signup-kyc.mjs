// Chain 1 — Signup → KYC → account manager assigned (SPEC §21.1 #1).
// Google OAuth is not enabled on the Supabase project (QA SL-01/SC-03), so the OAuth hop is traced up to the provider
// boundary and the user is created with the Auth admin API (= what the OAuth callback would create). Everything after
// that runs through the real UI/RPC path with one trace id.
import { chromium } from '@playwright/test';
import { admin, BASE, count, cookieFor, ensureBuyer, hops, http, newTrace, pwCookies, remember, reporter, runWorker, signIn, sql, traceRows, until, waitRefresh } from './lib.mjs';

const { r, check, note, save } = reporter(1, 'Signup → KYC → account manager assigned');
const trace = newTrace(1);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
const browser = await chromium.launch();
try {
  // 1 · Google OAuth button → provider boundary
  const ctx0 = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  const p0 = await ctx0.newPage();
  const signup = await p0.goto(`${BASE}/signup`);
  check(signup.headers()['x-trace-id'] === trace, 'signup page echoes the trace id', signup.headers()['x-trace-id']);
  const google = p0.getByRole('button', { name: /google/i });
  const hasGoogle = await google.first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check(hasGoogle, 'Google sign-up button present on /signup');
  if (hasGoogle) {
    const [req] = await Promise.all([p0.waitForRequest((q) => /\/auth\/v1\/authorize|accounts\.google\.com/.test(q.url()), { timeout: 8000 }).catch(() => null), google.first().click().catch(() => null)]);
    await p0.waitForTimeout(2500);
    const body = (await p0.content()).slice(0, 4000);
    const providerOff = /provider is not enabled|not enabled yet|Unsupported provider|validation_failed/i.test(body);
    note(`OAuth click → ${req ? new URL(req.url()).host + new URL(req.url()).pathname : 'no authorize request'}; ${providerOff ? 'Supabase answers "provider is not enabled"' : 'landed on ' + p0.url()}`);
    r.boundary = { hop: 'Google OAuth', result: providerOff ? 'provider not enabled (blocked: Owner/Admin enables Google in Supabase Auth)' : `reached ${p0.url()}` };
  }
  await ctx0.close();

  // 2 · user created (OAuth stand-in) → sign in → onboarding form (UI)
  const t0 = Date.now();
  const buyer = await ensureBuyer('a', { country: 'NL' });
  const sb = await signIn(buyer.email, trace);
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace } });
  await ctx.addCookies(pwCookies(sb));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/onboarding/, { timeout: 15000 }).catch(() => null);
  check(/\/onboarding/.test(page.url()), 'new user without profile is routed to /onboarding', page.url());
  await page.fill('#full_name', 'QA Trace A');
  await page.fill('#company', buyer.company);
  await page.selectOption('#country', 'NL');
  await page.fill('#city', 'Rotterdam');
  await page.fill('#phone', '+31 10 000 0000');
  await page.selectOption('#business_type', { index: 1 });
  const tOnb = Date.now();
  await Promise.all([page.waitForURL(/\/account(\?|$)/, { timeout: 20000 }), page.getByRole('button', { name: 'Continue' }).click()]);
  r.latency['onboarding (SA → complete_onboarding → redirect)'] = Date.now() - tOnb;
  const [org] = await sql(`select o.id, o.name as code, o.kyc_status from org_members m join organizations o on o.id=m.org_id where m.user_id=$1`, [buyer.uid]);
  check(org, 'complete_onboarding created the organization + membership', org?.code);
  remember((s) => s.orgA = org.id);

  // 3 · KYC submit (RPC the KYC form action calls; the form also uploads documents to the private bucket)
  const sb2 = await signIn(buyer.email, trace); // fresh JWT after onboarding
  const tK = Date.now();
  const { error: ke } = await sb2.rpc('submit_kyc', { p_company: buyer.company, p_reg_no: 'QA-TRACE-123', p_address: 'Coolsingel 1, Rotterdam', p_contact: 'QA Trace A', p_phone: '+31100000000', p_email: buyer.email });
  r.latency['submit_kyc RPC'] = Date.now() - tK;
  check(!ke, 'submit_kyc accepted', ke?.message);
  const [sub] = await sql(`select id, status from kyc_submissions where org_id=$1 order by created_at desc limit 1`, [org.id]);

  // 4 · Operations verifies (staff aal2 session, same RPC as /office/kyc)
  const ops = await signIn('ops@demo.octopusb2b.com', trace, { staff: true });
  const tR = Date.now();
  const { error: re } = await ops.rpc('review_kyc', { p_submission: sub.id, p_to: 'verified', p_note: 'E2E trace' });
  r.latency['review_kyc RPC (verify → trigger assigns AM)'] = Date.now() - tR;
  check(!re, 'review_kyc → verified', re?.message);

  // 5 · Realtime nudge on the dashboard while the worker delivers the notification
  const dash = await ctx.newPage();
  await dash.goto(`${BASE}/account`);
  const amVisible = await dash.getByText(/account (manager|team)|your account team/i).first().isVisible().catch(() => false);
  note(`dashboard shows account team card after verify: ${amVisible}`);
  await dash.waitForTimeout(2500); // let the Realtime channel subscribe
  // RealtimeRefresh calls router.refresh() on a pushed row → an RSC request proves the push reached the browser
  const rsc = waitRefresh(dash);
  const tW = Date.now();
  const w = await runWorker();
  r.latency['outbox worker run'] = Date.now() - tW;
  check(w.status === 200, 'worker run', JSON.stringify(w.json)?.slice(0, 160));
  const got = await rsc;
  r.realtime = { channel: 'dashboard (order_events, quotes, notifications)', refreshed_in_ms: got ? got - tW : null };
  check(!!got, 'dashboard received the Realtime push (notifications INSERT) and refreshed', got ? `${got - tW} ms after the worker started` : 'no refresh');
  await dash.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-01-dashboard.png' });

  // 6 · collect the trace
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  r.e2e_ms = Date.now() - t0;
  const am = (await sql(`select staff_user_id, team, reason, trace_id from account_managers where org_id=$1`, [org.id]))[0];
  check(am && am.trace_id === trace, 'account_managers row written once with the trace id', am ? `team ${am.team}, reason ${am.reason}` : 'none');
  check(count(rows, 'status_history', (x) => x.entity === 'kyc') >= 1, 'status_history kyc row in trace', count(rows, 'status_history'));
  check(count(rows, 'outbox_events', (x) => x.event_type === 'kyc.verified') === 1, 'exactly one kyc.verified outbox event');
  check(count(rows, 'job_runs', (x) => x.consumer === 'notify') >= 1, 'notify consumer ran for the trace (job_runs)');
  check(count(rows, 'notifications', (x) => /KYC verified/i.test(x.title)) === 1, 'exactly one "KYC verified" notification');
  check(count(rows, 'audit_log', (x) => x.action === 'assistant.assigned') === 1, 'audit: assistant.assigned once');
  check(count(rows, 'audit_log', (x) => x.action === 'kyc.review') === 1, 'audit: kyc.review once');
  const welcome = count(rows, 'email_deliveries');
  check(welcome >= 1, 'welcome email sent to the customer', `${welcome} email_deliveries rows`);
  // idempotency: verify again → refused, no second AM row
  const { error: again } = await ops.rpc('review_kyc', { p_submission: sub.id, p_to: 'verified', p_note: 'replay' });
  const ams = (await sql(`select count(*)::int n from account_managers where org_id=$1`, [org.id]))[0].n;
  check(again && /already/.test(again.message) && ams === 1, 'replay: second verify refused, still one account manager', again?.message);
  // negative: customer cannot verify own KYC
  const { error: neg } = await sb2.rpc('review_kyc', { p_submission: sub.id, p_to: 'verified', p_note: 'self' });
  check(neg && /FORBIDDEN/.test(neg.message), 'negative: customer calling review_kyc → FORBIDDEN', neg?.message);
  r.cookie = cookieFor(sb2).length; // sanity
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  save();
  process.exit(0);
}
