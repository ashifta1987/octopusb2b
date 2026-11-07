// Site audit crawler (ADDON-36 36-D groundwork): visits every internal link reachable from the start pages, as an
// anonymous visitor, a signed-in customer and a signed-in staff member, and records broken links and page problems.
// Usage: AUDIT_BASE=http://localhost:3200 AUDIT_ROLE=anon|customer|staff [AUDIT_MAX=400] node scripts/audit-crawl.mjs out.json
//   customer: AUDIT_EMAIL / AUDIT_PASSWORD     staff: AUDIT_EMAIL / AUDIT_PASSWORD / AUDIT_TOTP (base32 secret)
// Read-only: it only follows <a href> links (GET); it never submits forms or clicks buttons.
import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';

const BASE = (process.env.AUDIT_BASE ?? 'http://localhost:3200').replace(/\/$/, '');
const ROLE = process.env.AUDIT_ROLE ?? 'anon';
const MAX = Number(process.env.AUDIT_MAX ?? 400);
const OUT = process.argv[2] ?? `audit-${ROLE}.json`;
const START = {
  anon: ['/', '/products', '/pools', '/turnkey', '/suppliers', '/about', '/contact', '/request/sourcing', '/login', '/signup', '/staff/login', '/wallet', '/assistant', '/developers'],
  customer: ['/account', '/account/wallet', '/account/ledger', '/account/invoices', '/account/sourcing', '/account/orders', '/account/kyc', '/account/support', '/account/notifications'],
  staff: ['/admin', '/office', '/admin/customers', '/admin/approvals', '/admin/finance/transfers', '/admin/settings/payment', '/admin/reports'],
}[ROLE];
// never follow links that change state or sign out
const SKIP = [/\/export/i, /download/i, /\/print(\?|$)/, /\/auth\/signout/, /\/logout/, /signout/i, /\/api\//, /\.(pdf|csv|zip|png|jpe?g|webp|svg)(\?|$)/i, /^\/account\/ledger\/statement(\?|$)/];
const SCOPE = { anon: (p) => !/^\/(account|admin|office|distributor|scan)(\/|$)/.test(p), customer: (p) => /^\/account(\/|$|\?)/.test(p), staff: (p) => /^\/(admin|office)(\/|$|\?)/.test(p) }[ROLE];

const totp = (secret, at = Date.now()) => {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))); const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(c).digest(); const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

if (ROLE === 'customer') {
  await page.goto(`${BASE}/login?next=/account`);
  await page.getByLabel(/email/i).first().fill(process.env.AUDIT_EMAIL);
  await page.getByLabel(/^password/i).first().fill(process.env.AUDIT_PASSWORD);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}
if (ROLE === 'staff') {
  await page.goto(`${BASE}/staff/login?next=${encodeURIComponent('/admin')}`);
  await page.getByLabel('Work email').fill(process.env.AUDIT_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(process.env.AUDIT_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => /^\/(staff\/verify|admin|office|staff\/workspace)/.test(u.pathname), { timeout: 30000 });
  if (/\/staff\/verify/.test(page.url())) {
    if ((Date.now() / 1000) % 30 > 26) await page.waitForTimeout(4500);
    await page.getByLabel('Digit 1 of 6').click();
    await page.keyboard.type(totp(process.env.AUDIT_TOTP));
    const btn = page.getByRole('button', { name: /verify|continue/i }).first();
    if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
    await page.waitForURL((u) => !/\/staff\/(login|verify)/.test(u.pathname), { timeout: 30000 });
  }
}

const seen = new Map(); // path → { from:Set }
const queue = [];
const add = (path, from) => {
  if (!seen.has(path)) { seen.set(path, { from: new Set() }); queue.push(path); }
  if (from) seen.get(path).from.add(from);
};
START.forEach((p) => add(p, '(start)'));
const results = [];
let consoleErrs = [], pageErrs = [], badRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrs.push(String(e.message).slice(0, 300)));
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.origin === BASE && r.status() >= 400 && !u.pathname.startsWith('/_next/static')) badRequests.push(`${r.status()} ${u.pathname}${u.search}`);
  if (u.origin !== BASE && r.status() >= 400 && r.request().resourceType() === 'image') badRequests.push(`${r.status()} ${r.url().slice(0, 160)}`);
});

while (queue.length && results.length < MAX) {
  const path = queue.shift();
  consoleErrs = []; pageErrs = []; badRequests = [];
  let status = 0, finalPath = path, err = null;
  try {
    const resp = await page.goto(BASE + path, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); // streamed content; some pages poll
    status = resp?.status() ?? 0;
    finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
  } catch (e) { err = String(e.message).split('\n')[0]; }
  const info = await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const h1 = [...document.querySelectorAll('h1')].filter((h) => h.offsetParent !== null).map((h) => h.innerText.trim());
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60), visible: a.offsetParent !== null }));
    const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.offsetParent !== null).map((i) => i.currentSrc || i.src).slice(0, 10);
    return {
      title: document.title, h1, links, brokenImages: imgs,
      notFound: /We couldn.t find that page|This page could not be found/.test(text),
      forbidden: /You don.t have access to this page/.test(text),
      errorBoundary: /Something went wrong|Application error|Unhandled Runtime Error/i.test(text),
      placeholders: [...new Set((text.match(/\[[A-Z][A-Za-z $#%.\/-]{1,30}\]|\bundefined\b|\bNaN\b|\[object Object\]|US\$ NaN/g) ?? []))].slice(0, 10),
      emptyHrefs: [...document.querySelectorAll('a')].filter((a) => a.offsetParent !== null && (!a.getAttribute('href') || a.getAttribute('href') === '#' || a.getAttribute('href').startsWith('javascript:'))).map((a) => (a.innerText || '').trim().slice(0, 40)).slice(0, 10),
    };
  }).catch(() => ({ title: '', h1: [], links: [], brokenImages: [], notFound: false, forbidden: false, errorBoundary: false, placeholders: [], emptyHrefs: [] }));
  results.push({
    path, finalPath, status, err, title: info.title, h1: info.h1.slice(0, 2), notFound: info.notFound, forbidden: info.forbidden, errorBoundary: info.errorBoundary,
    placeholders: info.placeholders, emptyHrefs: info.emptyHrefs, brokenImages: info.brokenImages,
    consoleErrors: [...new Set(consoleErrs)].slice(0, 8), pageErrors: [...new Set(pageErrs)].slice(0, 5), badRequests: [...new Set(badRequests)].slice(0, 10),
    from: [...(seen.get(path)?.from ?? [])].slice(0, 5),
  });
  for (const l of info.links) {
    if (!l.href || l.href.startsWith('mailto:') || l.href.startsWith('tel:') || l.href.startsWith('#')) continue;
    let u; try { u = new URL(l.href, BASE + path); } catch { continue; }
    if (u.origin !== BASE) continue;
    const p = u.pathname + u.search;
    if (SKIP.some((r) => r.test(u.pathname) || r.test(p))) continue;
    if (!SCOPE(u.pathname)) continue;
    // de-duplicate: at most 2 query-string variants of the same path, at most 25 product pages, 8 of other detail patterns
    if (!seen.has(p)) {
      const keys = [...seen.keys()];
      if (u.search && keys.filter((k) => k.split('?')[0] === u.pathname && k.includes('?')).length >= 2) continue;
      const pat = (x) => x.split('?')[0].replace(/\/(p|pool|turnkey|c|account\/sourcing|account\/orders|office\/rfqs|office\/orders|office\/kyc|admin\/customers)\/[^/]+.*/, '/$1/*');
      const pattern = pat(p);
      if (pattern !== u.pathname && keys.filter((k) => pat(k) === pattern).length >= (pattern === '/p/*' ? 25 : 8)) continue;
    }
    add(p, path);
  }
  console.log(`${results.length}\t${status}\t${path}`);
  if (results.length % 20 === 0) fs.writeFileSync(OUT, JSON.stringify({ base: BASE, role: ROLE, partial: true, pages: results }, null, 1));
}
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, role: ROLE, at: new Date().toISOString(), pages: results }, null, 1));
console.log(`\n✔ ${ROLE}: ${results.length} pages → ${OUT}`);
await browser.close();
