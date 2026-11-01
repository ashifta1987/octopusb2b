// ADDON-22 customer auth E2E: no Google anywhere (360/768/1440), email + password sign-in → dashboard, 5 wrong passwords
// → lockout notice + alert email logged, forgot password → one-time reset link → new password → other sessions revoked.
// Uses a temporary customer user (created with the Auth admin API, no email sent) and removes it afterwards.
// Usage: APP=http://localhost:3100 DEMO_PASSWORD=... node tests/e2e/customer-auth.mjs
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { config } from 'dotenv'; import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const browser = await chromium.launch();
const email = `auth-e2e-${Date.now()}@example.com`; const password = 'AuthE2e-2026x'; const newPassword = 'AuthE2e-2027y';
let userId = null;

async function login(page, em, pw) {
  await page.goto(APP + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400); // hydration
  await page.getByLabel('Work email').fill(em);
  await page.getByLabel('Password', { exact: true }).fill(pw);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

try {
  // 1 · Google is gone from every sign-in page, at every viewport
  for (const w of [360, 768, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    for (const path of ['/signup', '/login', '/staff/login']) {
      await page.goto(APP + path, { waitUntil: 'networkidle', timeout: 120000 });
      const google = await page.getByText(/google/i).count();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(google === 0 && overflow <= 0, `${w}px ${path}: no Google button / text, no horizontal scroll`);
    }
    await page.goto(APP + '/login', { waitUntil: 'networkidle' });
    ok(await page.getByRole('link', { name: 'Forgot password?' }).waitFor({ timeout: 15000 }).then(() => true, () => false), `${w}px /login: "Forgot password?" link`);
    await ctx.close();
  }
  const settings = await (await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } })).json();
  ok(settings?.external?.google === false, 'Supabase Auth: Google provider is disabled (cannot create a Google identity)');
  const { data: sp } = await admin.from('site_settings').select('value').eq('key', 'auth.social_providers').maybeSingle();
  ok(Array.isArray(sp?.value) && sp.value.length === 0, 'site_settings auth.social_providers = []');

  // temp customer (confirmed, no email sent)
  const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Auth E2E' } });
  if (ce) throw ce;
  userId = cu.user.id;
  await admin.from('profiles').upsert({ id: userId, full_name: 'Auth E2E', email });

  // 2 · email + password sign-in → customer area; audit row carries provider=email + IP field
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, email, password);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
    ok(/\/(account|onboarding)/.test(new URL(page.url()).pathname), `sign-in with email + password → ${new URL(page.url()).pathname}`);
    const { data: a } = await admin.from('audit_log').select('action, details').eq('actor_id', userId).eq('action', 'auth.sign_in').order('created_at', { ascending: false }).limit(1);
    ok(a?.[0]?.details?.provider === 'email' && 'ip' in (a?.[0]?.details ?? {}), 'audit_log auth.sign_in has provider=email and the IP');
    await ctx.close();
  }
  // demo buyer (has a profile) lands on the dashboard
  if (process.env.DEMO_PASSWORD) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, 'buyer@demo.octopusb2b.com', process.env.DEMO_PASSWORD);
    await page.waitForURL(/\/account/, { timeout: 60000 }).catch(() => null);
    ok(new URL(page.url()).pathname === '/account', 'mobile: existing customer signs in → /account dashboard');
    await ctx.close();
  }

  // 3 · five wrong passwords → locked; sixth shows the lockout notice; alert email logged; admin notified
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    let last = '';
    for (let i = 1; i <= 6; i++) {
      await login(page, email, 'Wrong-pass-' + i);
      const alert = page.getByRole('alert').filter({ hasText: /\S/ });
      await alert.waitFor({ timeout: 30000 });
      last = (await alert.textContent()) ?? '';
      if (i < 5) ok(/Wrong email or password/i.test(last), `attempt ${i}: "Wrong email or password"`);
    }
    ok(/locked/i.test(last) && /Try again after/i.test(last), `6th attempt shows the lockout notice ("${last.slice(0, 80)}…")`);
    await login(page, email, password);
    const fa = page.getByRole('alert').filter({ hasText: /\S/ });
    const blocked = await fa.waitFor({ timeout: 30000 }).then(async () => /locked/i.test((await fa.textContent()) ?? ''), () => false);
    ok(blocked, 'even the right password is refused while locked');
    const hash = createHash('sha256').update(email).digest('hex');
    const { data: mail } = await admin.from('email_deliveries').select('template, status').eq('recipient_hash', hash).eq('template', 'auth.lockout');
    ok((mail ?? []).length === 1, `lockout alert email delivered to the account owner (${mail?.[0]?.status ?? 'none'})`);
    const { data: lk } = await admin.from('audit_log').select('details').eq('action', 'auth.lockout').eq('entity_id', email).limit(1);
    ok(lk?.length === 1 && lk[0].details?.ip !== undefined, 'audit_log auth.lockout row with IP');
    const { data: n } = await admin.from('notifications').select('title').ilike('body', `${email}%`).limit(1);
    ok(n?.[0]?.title === 'Customer account locked', `admins notified: "${n?.[0]?.title ?? 'none'}"`);
    await admin.from('auth_lockouts').delete().eq('email', email);   // unlock for the next step
    await ctx.close();
  }

  // 4 · forgot password → one-time reset link → new password → other sessions revoked
  {
    const other = await browser.newContext(); const op = await other.newPage();
    await login(op, email, password);
    await op.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(APP + '/forgot', { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill(`nobody-${Date.now()}@example.com`);   // neutral answer, no email sent
    await page.getByRole('button', { name: 'Send reset link' }).click();
    ok(await page.getByRole('status').waitFor({ timeout: 30000 }).then(() => true, () => false), 'forgot password: neutral "link is on its way" answer');

    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    if (le) throw le;
    await page.goto(`${APP}/reset-password?token_hash=${link.properties.hashed_token}&type=recovery`, { waitUntil: 'networkidle' });
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Repeat new password').fill(newPassword);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/reset-password'), { timeout: 60000 });
    ok(!new URL(page.url()).pathname.startsWith('/reset-password'), `new password saved → ${new URL(page.url()).pathname}`);
    const { data: ra } = await admin.from('audit_log').select('details').eq('actor_id', userId).eq('action', 'auth.password_reset').limit(1);
    ok(ra?.[0]?.details?.other_sessions === 'revoked', 'audit_log auth.password_reset (other sessions revoked)');

    // reusing the same link fails (one-time)
    const p2 = await (await browser.newContext()).newPage();
    await p2.goto(`${APP}/reset-password?token_hash=${link.properties.hashed_token}&type=recovery`, { waitUntil: 'networkidle' });
    ok(await p2.getByText('This link no longer works').waitFor({ timeout: 30000 }).then(() => true, () => false), 'the reset link works only once');

    // the other browser's session was revoked: its refresh token no longer works
    await op.context().clearCookies({ name: /code-verifier/ }).catch(() => null);
    const cookies = await op.context().cookies();
    const authCookie = cookies.filter((c) => c.name.includes('auth-token')).map((c) => c.value).join('');
    let refreshOk = null;
    try {
      const raw = authCookie.startsWith('base64-') ? Buffer.from(authCookie.slice(7), 'base64').toString() : decodeURIComponent(authCookie);
      const rt = JSON.parse(raw).refresh_token;
      const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
      refreshOk = r.ok;
    } catch { refreshOk = null; }
    ok(refreshOk === false, `other device signed out (old refresh token rejected: ${refreshOk === false ? 'yes' : refreshOk})`);

    // this run has used ~10 sign-in attempts from one IP within a minute → start a fresh rate-limit window
    await admin.from('auth_rate_limits').delete().like('bucket', 'login:%');
    const fresh = await (await browser.newContext()).newPage();
    await login(fresh, email, newPassword);
    await fresh.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => null);
    ok(!new URL(fresh.url()).pathname.startsWith('/login'), 'sign-in with the new password works');
    await ctx.close(); await other.close();
  }

  // 5 · per-IP rate limit: the 11th attempt within a minute is refused before the password is even checked
  {
    await admin.from('auth_rate_limits').delete().like('bucket', 'login:%');
    const ghost = `ratelimit-${Date.now()}@example.com`;
    const page = await (await browser.newContext()).newPage();
    let msg = '';
    for (let i = 1; i <= 11; i++) {
      await login(page, ghost, 'x-wrong-' + i);
      const a = page.getByRole('alert').filter({ hasText: /\S/ });
      await a.waitFor({ timeout: 30000 });
      msg = (await a.textContent()) ?? '';
    }
    ok(/Too many attempts from your network/i.test(msg), `11th attempt from one IP in a minute is rate-limited ("${msg.slice(0, 70)}")`);
    await admin.from('auth_rate_limits').delete().like('bucket', 'login:%');
    await admin.from('auth_lockouts').delete().eq('email', ghost);
  }
} catch (e) {
  ok(false, 'unexpected error: ' + (e?.message ?? e));
} finally {
  await browser.close();
  if (userId) {
    await admin.from('auth_lockouts').delete().eq('email', email);
    await admin.from('notifications').delete().ilike('body', `${email}%`);
    const { data: mem } = await admin.from('org_members').select('org_id').eq('user_id', userId);
    for (const { org_id: o } of mem ?? []) {
      for (const t of ['account_managers', 'notifications', 'ledger_accounts', 'org_members']) await admin.from(t).delete().eq('org_id', o);
      await admin.from('organizations').delete().eq('id', o);
    }
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
    console.log('cleaned up test user', email);
  }
  console.log(failed ? `\ncustomer auth: ${failed} check(s) failed` : '\ncustomer auth: all passed');
  process.exitCode = failed ? 1 : 0;
}

