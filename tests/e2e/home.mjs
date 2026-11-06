// ADDON-32 E2E — storefront home at 1440, 820 and 390 px against the real database.
// Header = logo + search + account only; announcement bar; Turnkey lead banner whose CTA goes to /turnkey; banner grid,
// stats strip, Turnkey section (five-card strip scrolls sideways at 390), 10-card feature grid, #global-shipping band;
// sections without data are hidden (never empty shells / placeholders); a supplier in identity review never shows;
// no horizontal scroll. Banner events written by the test are removed.
// Usage: APP=http://localhost:3100 node tests/e2e/home.mjs
import { chromium } from '@playwright/test';
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
const t0 = new Date();
const review = (await db.query(`select code from suppliers where identity_status <> 'ok'`)).rows.map((r) => r.code);
const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['820', { width: 820, height: 1180 }], ['390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('banner-grid').waitFor({ timeout: 60000 });
    await page.waitForLoadState('load');
    const header = page.locator('header').first();
    const headerLinks = (await header.locator('a, button').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    ok(await header.getByRole('search').count() === 1 && headerLinks.every((t) => /^(Sign in|Register|My account|)$/.test(t)), `[${label}] header = logo, search, account only (${headerLinks.join(' | ')})`);
    ok(await page.getByTestId('announcement').isVisible(), `[${label}] announcement bar is shown`);
    const cta = page.getByTestId('lead-cta').first();
    ok(await cta.getAttribute('href') === '/turnkey' && /Turnkey/.test(await cta.innerText()), `[${label}] lead banner = Turnkey, CTA → /turnkey`);
    const h1 = await page.locator('h1').first().innerText();
    ok(/Open a business/.test(h1), `[${label}] LCP headline is text ("${h1.trim()}")`);
    ok(await page.getByTestId('stats-strip').locator('li').count() >= 2, `[${label}] stats strip shows live tiles (${await page.getByTestId('stats-strip').locator('li').count()})`);
    ok(await page.getByTestId('home-turnkey').isVisible() && await page.getByTestId('starter-card').count() === 5, `[${label}] Turnkey section with the five starter picks`);
    ok(await page.getByTestId('home-features').locator('a[data-feature]').count() === 10, `[${label}] feature grid has 10 cards`);
    ok(await page.locator('#global-shipping').count() === 1, `[${label}] #global-shipping band present`);
    const body = await page.locator('main').innerText();
    ok(!/\[Supplier name\]|\[Customer testimonial/.test(body), `[${label}] no bracketed placeholders in production`);
    ok(review.every((c) => !body.includes(`Supplier ${c}`)), `[${label}] suppliers in identity review are not listed (${review.join(', ') || 'none'})`);
    const empty = await page.locator('main section').evaluateAll((els) => els.filter((e) => e.innerText.trim().length < 3).length);
    ok(empty === 0, `[${label}] no empty section shells (${empty})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `[${label}] no horizontal scroll (${overflow}px)`);
    if (label === '390') {
      ok(await page.getByTestId('home-turnkey').getByTestId('starter-strip').evaluate((el) => el.scrollWidth > el.clientWidth), '[390] the five-card strip scrolls sideways');
      ok(!(await page.getByTestId('banner-grid').locator('text=OCTOPUS B2B · 40HC').isVisible()), '[390] container illustration hidden');
    }
    if (label === '1440') {
      await cta.click();
      await page.waitForURL(/\/turnkey$/, { timeout: 60000 });
      ok(true, '[1440] Turnkey banner CTA opens /turnkey');
    }
    await ctx.close();
  }
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await browser.close();
  const r = await db.query(`delete from banner_events where ts >= $1 and region is null`, [t0]); // local runs have no geo header
  await db.query(`delete from auth_rate_limits where bucket like 'banner:%'`);
  await db.end();
  console.log(`removed ${r.rowCount} test banner event(s)`);
  console.log(failed ? `\nhome: ${failed} check(s) failed` : '\nhome: all passed');
  process.exitCode = failed ? 1 : 0;
}

