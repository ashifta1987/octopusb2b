import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers/settled';
import { odsPreview } from './helpers/ods';
import { createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/**
 * ODS 1.0 · T3 (introduction site + sign-in), master prompt Part 4. STAGING / LOCAL ONLY.
 * The new theme is switched on per browser context with the staging preview cookie (helpers/ods.ts) — no setting is
 * changed, so other staging users keep today's site. Tests tagged @writes create a temporary customer (staging DB) and
 * clean it up; everything else is read-only.
 */
const SHOTS = process.env.ODS_SHOTS;
const SERVICES = ['sourcing', 'pools', 'dropship', 'warehouse', 'brand'] as const;

async function axe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `${label} axe: ${JSON.stringify(bad.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))}`).toEqual([]);
}
async function open(page: Page, path: string, status = 200) {
  const res = await page.goto(path);
  expect(res?.status(), `${path}`).toBe(status);
  await waitForHydration(page);
}
/** No sideways page scroll; wide content may scroll only inside its own box (e.g. the comparison table). */
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function bothWidths(page: Page, path: string, name: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await open(page, path);
  await expect(page.locator('[data-theme="ods"]').first()).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await axe(page, `${path} @1280`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await noOverflow(page), `${path} @390 must not overflow sideways`).toBe(true);
  await axe(page, `${path} @390`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
}

test.describe('ODS T3 · switch off: today’s site is unchanged', () => {
  test.beforeEach(async ({ context }) => odsPreview(context, 'off'));
  test('home, login and service URLs answer as before', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('[data-theme="ods"]')).toHaveCount(0);
    await open(page, '/login');
    await expect(page.locator('[data-theme="ods"]')).toHaveCount(0);
    await open(page, '/sourcing');
    expect(new URL(page.url()).pathname).toBe('/sourcing');
    expect((await page.goto('/services/pools'))?.status()).toBe(404);
    expect((await page.goto('/how-it-works'))?.status()).toBe(404);
  });
  test('/welcome/setup falls back to /onboarding; /ods/* is never served', async ({ page, request }) => {
    const r = await request.get('/welcome/setup?next=/shop', { maxRedirects: 0, headers: { cookie: 'ods_preview=off' } });
    expect(r.status()).toBe(307);
    expect(r.headers().location).toMatch(/\/onboarding\?next=%2Fshop$/);
    expect((await page.goto('/ods'))?.status()).toBe(404);
    expect((await page.goto('/ods/login'))?.status()).toBe(404);
  });
});

test.describe('ODS T3 · Part 4.1 introduction page', () => {
  test.beforeEach(async ({ context }) => odsPreview(context, 'on'));
  test('signed out sees the page; SEO basics', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/');
    await expect(page.getByTestId('ods-home')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Source, store and sell from China');
    await expect(page).toHaveTitle(/Octopus B2B — Source, store and sell from China/);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((t) => /"Organization"/.test(t)), 'Organization JSON-LD').toBe(true);
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBe(0);
    // no sample data shown as real: example cards are labelled
    await expect(page.getByText('Example', { exact: false }).first()).toBeVisible();
  });
  test('every Continue with Google CTA → /login?next=/shop in the octopus-shop tab (desktop), same tab on phones', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/');
    const ctas = page.locator('[data-cta="google"]');
    expect(await ctas.count()).toBeGreaterThanOrEqual(2);
    for (const cta of await ctas.all()) {
      await expect(cta).toHaveAttribute('href', '/login?next=/shop');
      await expect(cta).toHaveAttribute('target', 'octopus-shop');
      expect(await cta.getAttribute('rel'), 'named tabs must not use rel=noopener').toBeNull();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByTestId('hero-cta')).not.toHaveAttribute('target', /.+/);
  });
  test('axe clean at 1280 and 390; no sideways scroll except inside the comparison table', async ({ page }) => {
    test.setTimeout(120_000);
    await bothWidths(page, '/', 'home');
    const box = page.getByTestId('comparison-table');
    await box.scrollIntoViewIfNeeded();
    expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth), 'the comparison table scrolls inside its own box on phones').toBe(true);
  });
  test('signed-in header (fixture): "Signed in as … · Go to my shop"', async ({ page }) => {
    await open(page, '/dev/ui/screens/public-home-signed-in');
    await expect(page.getByTestId('signed-in-as')).toContainText(/Signed in as/);
    await expect(page.getByRole('link', { name: /Go to my shop/ }).first()).toHaveAttribute('href', '/shop');
  });
});

test.describe('ODS T3 · Part 4.2 service pages and info pages', () => {
  test.beforeEach(async ({ context }) => odsPreview(context, 'on'));
  for (const s of SERVICES) {
    test(`/services/${s}`, async ({ page }) => {
      test.setTimeout(90_000);
      await bothWidths(page, `/services/${s}`, `service-${s}`);
      await expect(page.getByTestId('service-page')).toHaveAttribute('data-service', s);
      await expect(page.locator('[data-cta="google"]').first()).toHaveAttribute('href', '/login?next=/shop');
    });
  }
  test('/turnkey keeps its URL and gets the ODS service layout (D4)', async ({ page }) => {
    test.setTimeout(90_000);
    await bothWidths(page, '/turnkey', 'service-turnkey');
    await expect(page.getByTestId('service-page')).toHaveAttribute('data-service', 'turnkey');
  });
  for (const p of ['/how-it-works', '/shipping', '/help', '/legal/terms', '/legal/privacy', '/legal/cookies', '/legal/refunds']) {
    test(p, async ({ page }) => {
      test.setTimeout(90_000);
      await bothWidths(page, p, p.replace(/^\//, '').replace(/\//g, '-'));
    });
  }
  test('unknown service → 404', async ({ page }) => {
    expect((await page.goto('/services/unknown'))?.status()).toBe(404);
  });
});

test.describe('ODS T3 · route renames at "all"', () => {
  test('old service URLs 308 to /services/* only at "all"', async ({ request }) => {
    for (const [from, to] of [['/sourcing', '/services/sourcing'], ['/pools', '/services/pools'], ['/3pl', '/services/warehouse'], ['/make-my-brand', '/services/brand']]) {
      const all = await request.get(from, { maxRedirects: 0, headers: { cookie: 'ods_preview=all' } });
      expect(all.status(), from).toBe(308);
      expect(new URL(all.headers().location!, 'http://x').pathname).toBe(to);
      const on = await request.get(from, { maxRedirects: 0, headers: { cookie: 'ods_preview=on' } });
      expect(on.status(), `${from} at "on"`).toBe(200);
    }
    const tk = await request.get('/turnkey', { maxRedirects: 0, headers: { cookie: 'ods_preview=all' } });
    expect(tk.status(), '/turnkey stays (D4)').toBe(200);
  });
  test('/onboarding 308s to /welcome/setup when on (query kept)', async ({ request }) => {
    const r = await request.get('/onboarding?next=/shop', { maxRedirects: 0, headers: { cookie: 'ods_preview=on' } });
    expect(r.status()).toBe(308);
    expect(r.headers().location).toMatch(/\/welcome\/setup\?next=%2Fshop$/);
  });
});

test.describe('ODS T3 · Part 4.3–4.5 sign-in, callback, setup, invite', () => {
  test.beforeEach(async ({ context }) => odsPreview(context, 'on'));
  test('/login: Google first, work email second; axe at 1280 and 390', async ({ page }) => {
    test.setTimeout(90_000);
    await bothWidths(page, '/login?next=/shop', 'login');
    await expect(page.getByTestId('ods-login')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Sign in or create your account');
    await expect(page.getByTestId('google-signin')).toBeVisible();
    await expect(page.getByTestId('email-form')).toBeVisible();
    await expect(page.getByText('We only use your Google name, email and photo.')).toBeVisible();
    // /signup is the same page (one button creates the account)
    await open(page, '/signup');
    await expect(page.getByTestId('ods-login')).toBeVisible();
  });
  test('/login states (States-Auth)', async ({ page }) => {
    await open(page, '/dev/ui/screens/login-states');
    expect(await page.getByTestId('login-state').count()).toBeGreaterThanOrEqual(5);
    await axe(page, 'login states');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/login-states-1280.png`, fullPage: true });
  });
  test('next never leaves the site (login page and callback)', async ({ page, request }) => {
    // the router payload echoes the requested URL (URL-encoded); the page itself must never carry the raw target
    await open(page, '/login?next=https://evil.example/x');
    expect(await page.content()).not.toContain('https://evil.example');
    await open(page, '/login?next=//evil.example');
    expect(await page.content()).not.toMatch(/["'=]\/\/evil\.example/);
    for (const n of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const r = await request.get(`/auth/callback?next=${encodeURIComponent(n)}`, { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(r.status());
      expect(new URL(r.headers().location!, 'http://localhost').host, `callback next=${n}`).not.toContain('evil.example');
    }
  });
  test('/welcome/setup needs a session; form fixture renders and validates', async ({ page, request }) => {
    const r = await request.get('/welcome/setup', { maxRedirects: 0, headers: { cookie: 'ods_preview=on' } });
    expect(r.status()).toBe(307);
    expect(r.headers().location).toMatch(/\/login\?next=%2Fwelcome%2Fsetup$/);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await open(page, '/dev/ui/screens/welcome-setup');
    await expect(page.getByTestId('setup-form').first()).toBeVisible();
    await axe(page, 'setup @1280');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/welcome-setup-1280.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await noOverflow(page)).toBe(true);
    await axe(page, 'setup @390');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/welcome-setup-390.png`, fullPage: true });
  });
  test('/invite states (fixture) + signed-out invite page', async ({ page }) => {
    await open(page, '/dev/ui/screens/invite');
    const states = await page.getByTestId('invite-state').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
    for (const s of ['signed-out', 'invite', 'wrong-account', 'expired']) expect(states).toContain(s);
    await axe(page, 'invite states');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite-states-1280.png`, fullPage: true });
    await open(page, '/invite/some-token');
    await expect(page.getByTestId('invite-state')).toHaveAttribute('data-state', 'signed-out');
  });
});

test.describe('ODS T3 · Part 4.6 tabs and sign-out broadcast', () => {
  test.beforeEach(async ({ context }) => odsPreview(context, 'on'));
  test('signing out in one tab shows "You signed out" in the others', async ({ context }) => {
    const shopTab = await context.newPage();
    await open(shopTab, '/dev/ui/screens/signed-out');
    const other = await context.newPage();
    await open(other, '/dev/ui/screens/signed-out');
    await other.getByTestId('sign-out').click();
    const overlay = shopTab.getByTestId('signed-out-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('alertdialog')).toContainText('You signed out');
    await expect(overlay.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?state=signed-out');
  });
});

test.describe('ODS T3 · signed in (@writes: temporary staging customer)', () => {
  test.describe.configure({ mode: 'serial' });
  let c: TempCustomer | null = null;
  test.beforeAll(async () => {
    c = await createTempCustomer(`ods-t3-${Date.now().toString(36)}`);
  });
  test.afterAll(async () => {
    if (c) await purgeTestOrgs([c.orgId], [c.id]);
  });
  test('signed-in visitor sees "Go to my shop" on / (ODS) @writes', async ({ page, context }) => {
    await odsPreview(context, 'off'); // sign in with today's form, then switch this browser to the new theme
    await customerLogin(page, c!, '/account');
    await odsPreview(context, 'on');
    await open(page, '/');
    expect(new URL(page.url()).pathname, 'ODS 4.1: no redirect from / for signed-in visitors').toBe('/');
    await expect(page.getByTestId('signed-in-as')).toBeVisible();
    for (const cta of await page.locator('[data-cta="google"]').all()) await expect(cta).toHaveAttribute('href', '/shop');
  });
});
