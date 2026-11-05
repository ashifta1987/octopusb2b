// ADDON-23: the customer sidebar has no "Advertising" item (360 / 768 / 1440 px) and /account/ads redirects to the
// dashboard with a one-line notice. Read-only.   Usage: APP=http://localhost:3100 BUYER_PASSWORD=... node tests/e2e/customer-nav.mjs
import { chromium } from '@playwright/test';
const APP = process.env.APP ?? 'http://localhost:3100';
const PW = process.env.BUYER_PASSWORD;
if (!PW) { console.error('BUYER_PASSWORD is required'); process.exit(2); }
const EXPECTED = ['Dashboard', 'AI assistant', 'RFQs', 'Service requests', 'Orders', 'Group buys', 'Wallet', 'Ledger & invoices', 'Company & KYC', 'API & integrations', 'Help & complaints'];
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const browser = await chromium.launch();
try {
  for (const w of [360, 768, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Work email').waitFor({ timeout: 30000 }); await page.waitForTimeout(400);
    await page.getByLabel('Work email').fill('buyer@demo.octopusb2b.com');
    await page.getByLabel('Password', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL(/\/account/, { timeout: 60000 });
    // the dashboard keeps a realtime connection open, so wait for the sidebar instead of network idle
    await page.locator('nav a', { hasText: 'Help & complaints' }).first().waitFor({ timeout: 60000 });
    const advertising = await page.getByRole('link', { name: 'Advertising', exact: true }).count();
    ok(advertising === 0, `${w}px: no "Advertising" link in the customer portal`);
    const navLinks = await page.locator('nav a').allTextContents();
    const labels = EXPECTED.filter((l) => navLinks.some((t) => t.trim() === l));
    ok(labels.length === EXPECTED.length, `${w}px: sidebar has all ${EXPECTED.length} customer items${labels.length === EXPECTED.length ? '' : ' — missing: ' + EXPECTED.filter((l) => !labels.includes(l)).join(', ')}`);
    ok(!(await page.locator('a[href^="/account/ads"]').count()), `${w}px: no link to /account/ads anywhere on the dashboard`);

    await page.goto(APP + '/account/ads', { waitUntil: 'domcontentloaded' });
    await page.getByText("That area isn't part of your account.").waitFor({ timeout: 60000 }).catch(() => null);
    const path = new URL(page.url()).pathname;
    const notice = await page.getByText("That area isn't part of your account.").isVisible().catch(() => false);
    ok(path === '/account' && notice, `${w}px: /account/ads → ${path} with the notice`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `${w}px: no horizontal scroll (${overflow}px)`);
    await ctx.close();
  }
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  console.log(failed ? `\ncustomer nav: ${failed} check(s) failed` : '\ncustomer nav: all passed');
  process.exitCode = failed ? 1 : 0;
}

