// Storefront home E2E — Nov 2026 design (Home-desktop-full.png) at 1440, 820 and 390 px against the real database.
// Header = logo + search + account; service tabs + categories; announcement bar; numbered sections 1–5 in order
// (sourcing hero with quote form, dropshipping, MOQ pools, 3PL, Turnkey); "Ready to order" shows real products; Turnkey shows
// up to five real projects with photos; #global-shipping band; no placeholders, no empty sections, no horizontal scroll.
// The quote form carries product / quantity / country into the sourcing request. Banner events written by the test are removed.
// Usage: APP=http://localhost:3100 node tests/e2e/home.mjs
import { chromium } from '@playwright/test';
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const APP = process.env.APP ?? 'http://localhost:3100';
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
const t0 = new Date();
const review = (await db.query(`select code from suppliers where identity_status <> 'ok'`)).rows.map((r) => r.code);
const liveProducts = Number((await db.query(`select count(*) n from products where status = 'live' and archived_at is null`)).rows[0].n);
const projects = Number((await db.query(`select count(*) n from turnkey_projects where status <> 'archived'`)).rows[0].n);
const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['820', { width: 820, height: 1180 }], ['390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('#sourcing').waitFor({ timeout: 60000 });
    await page.waitForLoadState('load');
    const header = page.locator('header').first();
    const headerLinks = (await header.locator('a, button').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    ok(await header.getByRole('search').count() === 1 && headerLinks.every((t) => /^(Sign in|Register|My account|)$/.test(t)), `[${label}] header = logo, search, account only (${headerLinks.join(' | ')})`);
    const tabs = (await page.getByRole('navigation', { name: 'Shop by category' }).locator('a').allInnerTexts()).map((s) => s.trim());
    ok(tabs[0] === 'Product sourcing' && tabs.includes('Dropshipping') && tabs.includes('3PL warehousing'), `[${label}] nav starts with the services (${tabs.slice(0, 5).join(' | ')})`);
    ok(await page.getByTestId('announcement').isVisible(), `[${label}] announcement bar is shown`);
    const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim();
    ok(/Tell us the product\. We find the factory\./.test(h1), `[${label}] hero headline is text ("${h1}")`);
    const order = await page.evaluate(() => ['#sourcing', '#dropshipping', '#pools', '#warehousing', '#global-shipping', '#turnkey'].map((s) => document.querySelector(s)).filter(Boolean).map((e) => e.id));
    ok(order.join() === order.slice().sort((a, b) => ['sourcing', 'dropshipping', 'pools', 'warehousing', 'global-shipping', 'turnkey'].indexOf(a) - ['sourcing', 'dropshipping', 'pools', 'warehousing', 'global-shipping', 'turnkey'].indexOf(b)).join() && order.includes('sourcing') && order.includes('dropshipping') && order.includes('warehousing'), `[${label}] sections in design order (${order.join(' → ')})`);
    const ready = await page.getByTestId('home-ready').locator('a[href^="/p/"]').count();
    ok(liveProducts ? ready >= 1 && ready <= 4 : ready === 0, `[${label}] "Ready to order" shows ${ready} real product(s)`);
    if (projects) {
      const cards = page.getByTestId('home-turnkey-card');
      ok(await cards.count() === Math.min(5, projects) && await cards.locator('img[src*="banners/turnkey"]').count() === await cards.count(), `[${label}] Turnkey: ${await cards.count()} project cards, each with its photo`);
    }
    ok(await page.locator('#global-shipping').count() === 1, `[${label}] #global-shipping band present`);
    const body = await page.locator('main').innerText();
    ok(!/\[(N|Supplier|City|Spec|Sponsored)[^\]]*\]/.test(body), `[${label}] no bracketed placeholders`);
    ok(review.every((c) => !body.includes(`Supplier ${c}`)), `[${label}] suppliers in identity review are not listed (${review.join(', ') || 'none'})`);
    const empty = await page.locator('main section').evaluateAll((els) => els.filter((e) => e.innerText.trim().length < 3).length);
    ok(empty === 0, `[${label}] no empty section shells (${empty})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `[${label}] no horizontal scroll (${overflow}px)`);
    const broken = await page.evaluate(async () => { const imgs = [...document.querySelectorAll('main img')]; for (const i of imgs) { i.loading = 'eager'; } await new Promise((r) => setTimeout(r, 2500)); return imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.split('/').pop()); });
    ok(broken.length === 0, `[${label}] no broken images (${broken.join(', ') || 'none'})`);
    if (label === '1440') {
      await page.locator('#hq-title').fill('Handheld fan 4000mAh');
      await page.locator('#hq-qty').fill('3000');
      await page.locator('#hq-country').selectOption('SA');
      await page.getByRole('button', { name: /Request quotes/ }).click();
      await page.waitForURL(/\/request\/sourcing\?/, { timeout: 60000 });
      const u = new URL(page.url());
      ok(u.searchParams.get('title') === 'Handheld fan 4000mAh' && u.searchParams.get('qty') === '3000' && u.searchParams.get('country') === 'SA', `[1440] quote form → ${u.pathname}${u.search}`);
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
