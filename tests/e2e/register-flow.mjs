// Registration flow E2E (desktop + mobile): header/footer Sign in + Register buttons, /signup form,
// staff-email refusal, and a full sign-up → verify (admin-generated link, no email sent) → onboarding → /account.
// Cleans up the test user + org afterwards.   Usage: APP=http://localhost:3200 node tests/e2e/register-flow.mjs
import { chromium } from '@playwright/test';
import { config } from 'dotenv'; import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3200';
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const browser = await chromium.launch();
const email = `register-e2e-${Date.now()}@example.com`; const password = 'Register-e2e-2026';
let userId = null;
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(APP + '/', { waitUntil: 'networkidle', timeout: 120000 });
    const header = page.locator('header');
    const reg = header.getByRole('link', { name: 'Register', exact: true });
    const signIn = header.getByRole('link', { name: 'Sign in', exact: true });
    ok(await reg.isVisible() && await signIn.isVisible(), `${label}: header shows Sign in + Register when signed out`);
    const box = await reg.boundingBox();
    ok(box && box.x + box.width <= viewport.width && box.height >= 24, `${label}: Register button fully on screen, tap target ${Math.round(box?.height ?? 0)}px`);
    await reg.click(); await page.waitForURL(/\/signup/, { timeout: 30000 });
    ok(page.url().includes('/signup'), `${label}: Register → /signup`);
    ok(await page.getByRole('tab', { name: 'Sign up' }).getAttribute('aria-selected') === 'true', `${label}: sign-up tab is active`);
    await page.goto(APP + '/', { waitUntil: 'networkidle' });
    await page.locator('header').getByRole('link', { name: 'Sign in', exact: true }).click(); await page.waitForURL(/\/login/, { timeout: 30000 });
    ok(page.url().includes('/login'), `${label}: Sign in → /login`);
    await page.goto(APP + '/', { waitUntil: 'networkidle' });
    ok(await page.locator('footer').getByRole('link', { name: 'Register as a buyer' }).count() === 1, `${label}: footer has "Register as a buyer"`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `${label}: no horizontal scroll on the home page (${overflow}px)`);
    await ctx.close();
  }

  // sign-up form validation + staff-email refusal (no email is sent for these)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP + '/signup', { waitUntil: 'networkidle' });
    await page.getByLabel('Work email').fill('someone@example.com');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account with email' }).click();
    ok(await page.getByRole('alert').filter({ hasText: /8 characters/ }).waitFor({ timeout: 30000 }).then(() => true, () => false), 'weak password is refused with a clear message');
    await page.getByLabel('Work email').fill('new.staff@octopusb2b.com');
    await page.getByLabel('Password', { exact: true }).fill('LongEnough123');
    await page.getByRole('button', { name: 'Create account with email' }).click();
    const staffMsg = page.getByText('This is an Octopus staff email', { exact: false });
    ok(await staffMsg.waitFor({ timeout: 30000 }).then(() => true, () => false), 'staff-domain email cannot register as a customer ("This is an Octopus staff email…")');
    ok(await page.getByRole('link', { name: /Back office login/ }).count() >= 1, 'login page links staff to the back office login');
    await ctx.close();
  }

  // full registration: sign-up (admin link, no email) → verify → onboarding → /account
  {
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'signup', email, password });
    if (error) throw error;
    userId = link.user.id;
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'signup' });
    ok(!vErr && v.session, 'sign-up verification issues a session' + (vErr ? ` (${vErr.message})` : ''));
    const val = 'base64-' + Buffer.from(JSON.stringify(v.session)).toString('base64url');
    const cookies = Array.from({ length: Math.ceil(val.length / 3180) }, (_, i) => ({ name: `sb-${ref}-auth-token.${i}`, value: val.slice(i * 3180, (i + 1) * 3180), url: APP }));
    for (const [label, viewport] of [['mobile', { width: 375, height: 812 }]]) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      await page.goto(APP + '/account', { waitUntil: 'networkidle', timeout: 120000 });
      ok(page.url().includes('/onboarding'), `${label}: a new account without a profile is sent to /onboarding`);
      await page.getByLabel('Full name').fill('Register E2E');
      await page.getByLabel('Company').fill('Register E2E Trading');
      await page.getByLabel('Country').selectOption('AE');
      await page.getByLabel('City').fill('Dubai');
      await page.getByLabel('Phone / WhatsApp').fill('+971 50 000 0000');
      await page.getByLabel('Business type').selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL(/\/account(\?|$)/, { timeout: 60000 });
      ok(/\/account(\?|$)/.test(new URL(page.url()).pathname + new URL(page.url()).search), `${label}: onboarding completes and lands on the customer dashboard`);
      await page.goto(APP + '/', { waitUntil: 'networkidle' });
      ok(await page.locator('header').getByRole('link', { name: 'My account' }).isVisible(), `${label}: signed-in header shows "My account" instead of Sign in/Register`);
      await ctx.close();
    }
  }
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  if (userId) {
    // clean up over the REST API (works on networks without IPv6, where the direct DB host may not resolve)
    const { data: mem } = await admin.from('org_members').select('org_id').eq('user_id', userId);
    for (const { org_id: o } of mem ?? []) {
      for (const t of ['account_managers', 'notifications', 'ledger_accounts', 'org_members']) await admin.from(t).delete().eq('org_id', o);
      await admin.from('outbox_events').delete().eq('payload->>org_id', o);
      await admin.from('organizations').delete().eq('id', o);
    }
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
    console.log('cleaned up test user', email);
  }
  console.log(failed ? `\n${failed} failed` : '\nregistration flow: all passed');
  process.exit(failed ? 1 : 0);
}
