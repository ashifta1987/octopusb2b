// ADDON-25 E2E: eye toggle on every password field, keyboard access, auto-hide reset on a wrong password, admin step-1
// sign-in still works, no reveal toggle on the 2FA code step, and axe finds no violations caused by the toggle.
// Usage: APP=http://localhost:3100 ADMIN_PASSWORD=... node tests/e2e/password-eye.mjs
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { config } from 'dotenv'; import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
const ADMIN_PW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PW) { console.error('ADMIN_PASSWORD is required'); process.exit(2); }
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const browser = await chromium.launch();

async function a11y(page, label) {
  const r = await new AxeBuilder({ page }).include('form').analyze();
  const mine = r.violations.filter((v) => v.nodes.some((n) => /Show password|Hide password|aria-pressed/.test(n.html)));
  ok(mine.length === 0, `${label}: axe — no violations on the eye toggle${mine.length ? ' (' + mine.map((v) => v.id).join(', ') + ')' : ''}`);
}

try {
  // 1 · every password page shows the eye
  for (const [path, w] of [['/login', 1440], ['/signup', 390], ['/staff/login', 768]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
    await page.goto(APP + path, { waitUntil: 'domcontentloaded' });
    const eye = page.getByRole('button', { name: 'Show password' });
    await eye.first().waitFor({ timeout: 30000 });
    ok(await eye.count() === 1 && (await eye.first().getAttribute('aria-pressed')) === 'false', `${path} @${w}px: eye button, hidden by default (aria-pressed=false)`);
    await a11y(page, path);
    await page.context().close();
  }

  // 2 · staff login: click to read, click to hide, keyboard Space/Enter, wrong password resets, then sign in
  {
    await admin.from('auth_lockouts').delete().eq('email', 'admin@demo.octopusb2b.com');
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(APP + '/staff/login', { waitUntil: 'domcontentloaded' });
    const pw = page.getByLabel('Password', { exact: true });
    await pw.waitFor(); await page.waitForTimeout(400);
    await page.getByLabel('Work email').fill('admin@demo.octopusb2b.com');
    await pw.fill('wrong-password-1');
    await page.getByRole('button', { name: 'Show password' }).click();
    ok(await pw.getAttribute('type') === 'text' && await pw.inputValue() === 'wrong-password-1', 'click the eye → the typed password is readable');
    ok(await page.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed') === 'true', 'aria-pressed=true and label "Hide password" while visible');
    await page.getByRole('button', { name: 'Hide password' }).click();
    ok(await pw.getAttribute('type') === 'password', 'click again → hidden');
    // keyboard: Tab from the field reaches the toggle; Space and Enter both toggle
    await pw.focus(); await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    ok(focused === 'Show password', `Tab from the field focuses the toggle (${focused})`);
    await page.keyboard.press('Space');
    ok(await pw.getAttribute('type') === 'text', 'Space toggles it on');
    await page.keyboard.press('Enter');
    ok(await pw.getAttribute('type') === 'password', 'Enter toggles it off (does not submit)');
    ok(new URL(page.url()).pathname === '/staff/login', 'still on step 1 (the toggle never submits the form)');
    // wrong password with the field revealed → error shown, reveal resets to hidden
    await page.getByRole('button', { name: 'Show password' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const err = page.getByRole('alert').filter({ hasText: /Wrong email or password/ });
    ok(await err.waitFor({ timeout: 30000 }).then(() => true, () => false), 'wrong password → error message shown');
    ok(await page.getByLabel('Password', { exact: true }).getAttribute('type') === 'password', 'reveal state reset to hidden after the failed attempt');
    ok(await page.getByLabel('Work email').inputValue() === 'admin@demo.octopusb2b.com', 'the email stays filled in after a wrong password');
    // correct password → step 2
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PW);
    await page.getByRole('button', { name: 'Show password' }).click();
    ok(await page.getByLabel('Password', { exact: true }).inputValue() === ADMIN_PW, 'admin can confirm what they typed before submitting');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL(/\/staff\/verify/, { timeout: 60000 }).catch(() => null);
    ok(new URL(page.url()).pathname === '/staff/verify', 'admin signs in (step 1 passed → 2FA step)');
    // 3 · the 2FA code step has no reveal toggle
    await page.waitForTimeout(1500);
    ok(await page.getByRole('button', { name: /Show password|Hide password/ }).count() === 0, '2FA code step: no reveal toggle');
    await page.context().close();
  }

  // 4 · auto-hide after the timeout (uses the configured default, 15 s)
  {
    const page = await (await browser.newContext()).newPage();
    await page.goto(APP + '/login', { waitUntil: 'domcontentloaded' });
    const pw = page.getByLabel('Password', { exact: true });
    await pw.waitFor(); await page.waitForTimeout(400);
    await pw.fill('Secret-123');
    await page.getByRole('button', { name: 'Show password' }).click();
    await page.mouse.click(5, 5); // no more interaction with the field
    await page.waitForTimeout(16500);
    ok(await pw.getAttribute('type') === 'password', 'auto-hides after 15 s without interaction');
    await page.context().close();
  }
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  await admin.from('auth_lockouts').delete().eq('email', 'admin@demo.octopusb2b.com');
  console.log(failed ? `\npassword eye: ${failed} check(s) failed` : '\npassword eye: all passed');
  process.exitCode = failed ? 1 : 0;
}
