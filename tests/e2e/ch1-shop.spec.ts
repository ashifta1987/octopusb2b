import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
import { getShopFlag, setShopFlag, type ShopFlag } from './helpers/shop-flag';

/**
 * CH-1 Shop E2E (STAGING ONLY) — Shop_Home / M_Shop_Home / Shop_Products / M_Shop_Products, owner prompt §1 + §5.
 *  1. Sign-in landing: customer → /shop; safe ?next= followed, unsafe ignored; signed-in /, /login, /signup → /shop; staff keep "/".
 *  2. New-tab links (desktop: target=_blank rel=noopener + "(opens in a new tab)"; phone: same tab). One session across tabs.
 *  3. Products: filters + sort change the URL and the result; product page price-by-quantity table.
 *  4. Request form: below MOQ refused naming the minimum; valid → RFQ-<n> with line 1. Sample → SRV-<n>.
 *  5. Quote list: two products → ONE request with 2 lines, the list empties.
 *  6. Dropship rail: no price before access. Viewer: buttons disabled with the reason.
 *  7. No supplier / cost leaks in HTML, RSC payload or image URLs. axe at 1280 and 390.
 */
test.describe.configure({ mode: 'serial' });

const created: TempCustomer[] = [];
let buyer: TempCustomer;
let staff: TempStaff | null = null;
let products: { id: string; slug: string; title: string; moq: number }[] = [];
let shopFlagBefore: ShopFlag;
let leak: { codes: string[]; names: string[]; models: string[]; skus: string[] } = { codes: [], names: [], models: [], skus: [] };

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  // these tests need the Shop ON (the staging default); an explicit OFF left by someone is switched on and put back afterwards
  shopFlagBefore = await getShopFlag();
  if (shopFlagBefore === false) await setShopFlag(true);
  const db = pgClient(); await db.connect();
  try {
    await assertStagingDatabase(db);
    products = (await db.query(`select id, slug, title, coalesce(moq, 1) moq from products where status = 'live' and archived_at is null and coalesce(moq, 1) > 1 order by featured desc, created_at limit 3`)).rows;
    // what must never reach a customer: supplier codes / names, factory model numbers, SKUs of the shown products
    const ids = products.map((p) => p.id);
    const r = (await db.query(`select s.code, s.legal_name as name, s.manufacturer_code mcode, p.factory_model, p.sku from products p join suppliers s on s.id = p.supplier_id where p.id = any($1)`, [ids])).rows;
    leak = {
      codes: r.flatMap((x) => [x.code, x.mcode]).filter((x: string | null) => x && x.length >= 4),
      names: r.map((x) => x.name).filter((x: string | null) => x && x.length >= 5),
      models: r.map((x) => x.factory_model).filter((x: string | null) => x && x.length >= 5),
      skus: r.map((x) => x.sku).filter((x: string | null) => x && x.length >= 6),
    };
  } finally { await db.end(); }
  expect(products.length, 'needs live products with MOQ > 1 on staging').toBeGreaterThanOrEqual(2);
  buyer = await createTempCustomer('ch1'); created.push(buyer);
  // the sourcing / sample fees are charged from the wallet (settings): a temporary credit limit, removed with the org
  const db2 = pgClient(); await db2.connect();
  try { await db2.query(`insert into wallet_credit_limits(org_id, limit_minor, currency, note) values ($1, 100000, current_platform_currency(), 'e2e ch1')`, [buyer.orgId]); } finally { await db2.end(); }
});

test.afterAll(async () => {
  if (shopFlagBefore === false) await setShopFlag(false);
  await purgeTestOrgs(created.map((c) => c.orgId), created.map((c) => c.id));
  await deleteTempStaff(staff);
});

async function login(page: Page, c: TempCustomer, next?: string) {
  await page.goto(next === undefined ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).first().fill(c.email);
  await page.getByLabel(/^password/i).first().fill(c.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('1 · sign-in landing: /shop by default, safe next followed, unsafe ignored, signed-in /, /login, /signup → /shop', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await login(page, buyer);
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByTestId('shop-header')).toBeVisible();
  for (const p of ['/', '/signup', '/login']) {
    await page.goto(p);
    await expect(page, `${p} while signed in`).toHaveURL(/\/shop$/);
  }
  await page.goto('/login?next=%2Faccount%2Fwallet');
  await expect(page).toHaveURL(/\/account\/wallet$/);
  await ctx.close();

  for (const [next, want] of [['/account/sourcing', /\/account\/sourcing$/], ['//evil.example', /\/shop$/], ['/\\evil.example', /\/shop$/], ['https://evil.example', /\/shop$/]] as const) {
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await login(p2, buyer, next);
    await expect(p2, `next=${next}`).toHaveURL(want);
    expect(new URL(p2.url()).host).not.toContain('evil');
    await c2.close();
  }
});

test('1b · staff opening / still see the website (no customer redirect)', async ({ browser }) => {
  staff = await createTempStaff('operations');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await staffLogin(page, staff, '/office');
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await ctx.close();
});

test('2 · new-tab links on desktop, same tab on phone; one session in both tabs', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await customerLogin(page, buyer, '/shop');
  const panel = page.getByTestId('panel-link');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('target', '_blank');
  await expect(panel).toHaveAttribute('rel', /noopener/);
  await expect(panel).toContainText('(opens in a new tab)');
  await expect(page.getByTestId('welcome-panel-link')).toHaveAttribute('target', '_blank');
  const [tab2] = await Promise.all([ctx.waitForEvent('page'), panel.click()]);
  await tab2.waitForLoadState();
  await expect(tab2).toHaveURL(/\/account$/);
  // one session: sign out in the panel tab → the shop tab is signed out too
  // the panel's own "Sign out" posts to /auth/signout (same form as the account shell)
  await tab2.evaluate(() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/auth/signout'; document.body.appendChild(f); f.submit(); });
  await tab2.waitForURL((u) => u.pathname === '/');
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await customerLogin(p, buyer, '/shop');
  await expect(p.getByTestId('panel-link')).toBeHidden();
  const ph = p.getByTestId('panel-link-phone');
  await expect(ph).toBeVisible();
  expect(await ph.getAttribute('target')).toBeNull();
  await expect(p.getByTestId('shop-tabs')).toBeVisible();
  await p.getByTestId('shop-tabs').getByRole('link', { name: 'Account' }).click();
  await expect(p).toHaveURL(/\/account$/);
  expect(phone.pages().length).toBe(1);
  await phone.close();
});

test('3 · products: filters and sort; product page price tiers', async ({ page }) => {
  await customerLogin(page, buyer, '/shop/products');
  await expect(page.getByTestId('result-count')).toBeVisible();
  const all = Number((await page.getByTestId('result-count').locator('b').innerText()).replace(/\D/g, ''));
  await page.getByLabel('Verified supplier').check();
  await page.waitForURL(/verified=1/);
  const verified = Number((await page.getByTestId('result-count').locator('b').innerText()).replace(/\D/g, ''));
  expect(verified).toBeLessThanOrEqual(all);
  await page.locator('#sort').selectOption('moq_asc');
  await page.waitForURL(/sort=moq_asc/);
  await expect(page.getByTestId('result-count')).toContainText('lowest moq');
  await page.goto('/shop/products?lead=7&moq=50');
  await expect(page.getByTestId('result-count')).toBeVisible();
  await page.goto(`/shop/products/${products[0].slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(products[0].title);
  await expect(page.getByText('MOQ', { exact: true }).first()).toBeVisible();
  const tiers = page.getByTestId('price-tiers');
  if (await tiers.count()) await expect(tiers.locator('tbody tr').first()).toBeVisible();
  // the shop copy is never indexed and points at the public page
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toMatch(/noindex/);
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toContain(`/p/${products[0].slug}`);
});

test('4 · request form: MOQ check, RFQ created with line 1; sample → SRV-', async ({ page }) => {
  const P = products[0];
  await customerLogin(page, buyer, `/shop/products/${P.slug}#request`);
  const form = page.getByTestId('rfq-form');
  await form.getByTestId('rfq-qty').fill(String(P.moq - 1));
  await expect(form.getByText(`Enter at least ${P.moq.toLocaleString('en-US')}`)).toBeVisible();
  await expect(form.getByTestId('rfq-submit')).toBeDisabled();
  await form.getByTestId('rfq-qty').fill(String(P.moq));
  await form.getByTestId('rfq-country').selectOption('AE');
  await form.getByTestId('rfq-submit').click();
  const done = page.getByTestId('rfq-done');
  await expect(done).toContainText(/Request RFQ-\d+ sent/);
  const code = (await done.locator('h3').innerText()).match(/RFQ-\d+/)![0];
  const db = pgClient(); await db.connect();
  try {
    const r = (await db.query(`select r.org_id, r.product_id, r.quantity, (select count(*) from rfq_lines l where l.rfq_id = r.id)::int n from rfqs r where r.code = $1`, [code])).rows[0];
    expect(r.org_id).toBe(buyer.orgId); expect(r.product_id).toBe(P.id); expect(r.quantity).toBe(P.moq); expect(r.n).toBe(1);
  } finally { await db.end(); }
  const sample = page.getByTestId('sample-form');
  await sample.getByLabel('Ship to *').selectOption('AE');
  await sample.getByTestId('sample-submit').click();
  await expect(page.getByTestId('sample-done')).toContainText(/SRV-\d+/);
});

test('5 · quote list: two products → ONE request with 2 lines; the list empties', async ({ page }) => {
  await customerLogin(page, buyer, `/shop/products/${products[0].slug}`);
  await page.getByTestId('product-buttons').getByTestId('add-to-list').click();
  await expect(page.getByTestId('product-buttons').getByTestId('added-to-list')).toBeVisible();
  await page.goto(`/shop/products/${products[1].slug}`);
  await page.getByTestId('product-buttons').getByTestId('add-to-list').click();
  await expect(page.getByTestId('product-buttons').getByTestId('added-to-list')).toBeVisible();
  await expect(page.getByTestId('quote-count')).toHaveText('2');
  await page.goto('/shop/quote-list');
  await expect(page.getByTestId('quote-line')).toHaveCount(2);
  await page.getByTestId('list-country').selectOption('SA');
  await page.getByTestId('send-list').click();
  const done = page.getByTestId('quote-list-done');
  await expect(done).toContainText(/RFQ-\d+ sent with 2 products/);
  const code = (await done.locator('h2').innerText()).match(/RFQ-\d+/)![0];
  const db = pgClient(); await db.connect();
  try {
    const n = (await db.query(`select count(*)::int n from rfq_lines l join rfqs r on r.id = l.rfq_id where r.code = $1`, [code])).rows[0].n;
    const left = (await db.query(`select count(*)::int n from quote_list_items where org_id = $1`, [buyer.orgId])).rows[0].n;
    expect(n).toBe(2); expect(left).toBe(0);
  } finally { await db.end(); }
  await page.goto('/shop/quote-list');
  await expect(page.getByTestId('quote-list-empty')).toBeVisible();
  // the panel shows both products on the request
  await page.goto(`/account/sourcing/${code}`);
  await expect(page.getByTestId('rfq-lines').locator('tbody tr')).toHaveCount(2);
});

test('6 · dropship rail gated (no price before access); viewer sees disabled buttons with the reason', async ({ page, browser }) => {
  await customerLogin(page, buyer, '/shop');
  const rail = page.getByTestId('shop-rail-dropship');
  await expect(rail).toBeVisible();
  await expect(rail.getByTestId('dropship-gate')).toBeVisible();
  await expect(rail).not.toContainText(/US\$|Landed \$/);
  const viewer = await createTempCustomer('ch1-viewer'); created.push(viewer);
  const db = pgClient(); await db.connect();
  try { await db.query(`update org_members set member_role = 'viewer' where user_id = $1`, [viewer.id]); } finally { await db.end(); }
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await customerLogin(p, viewer, `/shop/products/${products[0].slug}`);
  await expect(p.getByTestId('role-reason')).toBeVisible();
  await expect(p.getByTestId('product-buttons').getByRole('button', { name: 'Request quote' })).toBeDisabled();
  await expect(p.getByTestId('rfq-form')).toHaveCount(0);
  await ctx.close();
});

test('7 · no supplier / cost leaks in HTML, RSC payload or image URLs', async ({ page }) => {
  await customerLogin(page, buyer, '/shop');
  const bodies: string[] = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] ?? '';
    if (/text\/html|text\/x-component|application\/json/.test(ct) && new URL(r.url()).pathname.startsWith('/shop')) bodies.push(await r.text().catch(() => ''));
  });
  for (const path of ['/shop', '/shop/products', `/shop/products/${products[0].slug}`, '/shop/quote-list']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => null);
    bodies.push(await page.content());
  }
  const all = bodies.join('\n');
  for (const s of [...leak.codes, ...leak.names, ...leak.models, ...leak.skus]) expect(all.includes(s), `leak: ${s}`).toBe(false);
  const hit = all.match(/.{0,80}("supplier_id"|"cost_cents"|"margin[a-z_]*"|"factory_model"|"purchase_price).{0,80}/);
  expect(hit?.[0] ?? null, 'supplier / cost field names in the page or payload').toBeNull();
  const imgs = await page.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  for (const src of imgs) for (const s of [...leak.codes, ...leak.models]) expect(src.includes(s), `image URL leak: ${src}`).toBe(false);
});

test('8 · axe at 1280 and 390', async ({ browser }) => {
  test.setTimeout(240_000); // 6 pages × 2 widths, each settled + axe
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await customerLogin(page, buyer, '/shop');
    for (const path of ['/shop', '/shop/products', `/shop/products/${products[0].slug}`, '/shop/quote-list', '/shop/pools', '/shop/turnkey']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => null);
      await axe(page, `${path} @${vp.width}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} @${vp.width}: no sideways page scroll`).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  }
});
