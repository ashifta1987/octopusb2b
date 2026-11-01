// Wallet credit facility — customer UI check (desktop + mobile). Read-only: opens dialogs, never confirms a charge.
// Run: APP=http://localhost:3100 DEMO_PASSWORD=... node tests/e2e/wallet-credit-ui.mjs
import { chromium } from '@playwright/test';
const APP = process.env.APP ?? 'http://localhost:3100';
const PW = process.env.DEMO_PASSWORD;
if (!PW) { console.error('DEMO_PASSWORD is required'); process.exit(2); }
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(`${APP}/login?next=/account/wallet`);
    await page.getByLabel('Work email').fill('buyer@demo.octopusb2b.com');
    await page.getByLabel('Password').fill(PW);
    await page.getByLabel('Password').press('Enter');
    await page.waitForURL(/\/account\/wallet/, { timeout: 60000 });
    const hero = page.getByRole('region', { name: 'Wallet balance' });
    ok(await hero.getByText('Credit limit', { exact: true }).waitFor({ timeout: 30000 }).then(() => true, () => false), `${name}: wallet page shows the credit limit`);
    ok(await hero.getByText('Available to spend').isVisible(), `${name}: wallet page shows available to spend`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 0, `${name}: no horizontal scroll on /account/wallet (${overflow}px)`);
    await page.screenshot({ path: `/tmp/wallet-credit-${name}.png`, fullPage: false });

    // service request confirm dialog shows the credit line (dialog opened, then cancelled)
    await page.goto(`${APP}/request/qc`);
    const submit = page.locator('button', { hasText: /submit|request|pay/i }).last();
    await submit.waitFor({ timeout: 30000 });
    await submit.click();
    const dialog = page.getByRole('dialog');
    const opened = await dialog.waitFor({ timeout: 10000 }).then(() => true, () => false);
    if (opened) {
      ok(await dialog.getByText('Credit limit', { exact: true }).isVisible(), `${name}: charge dialog shows the credit limit`);
      await page.screenshot({ path: `/tmp/wallet-credit-dialog-${name}.png` });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    } else {
      ok(false, `${name}: charge dialog did not open (form validation may require fields)`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
