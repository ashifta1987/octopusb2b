import { test, expect, type Page } from '@playwright/test';
import { adminClient, createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';

/**
 * Bug 1 (8 Nov 2026) — STAGING ONLY. A temporary customer with 2 unread notifications:
 * bubble 2 → open one, come back → bubble 1 and that row has no dot → reload → still 1 → open the second → bubble gone.
 * Desktop (1440 px) and phone (390 px, header bell). The other customer's notification cannot be marked read.
 * Run with the staging env pre-loaded (E2E_BASE_URL → a dev server started with .env.staging).
 */
const SHOTS = process.env.SHOTS_DIR;
let c: TempCustomer | null = null;
let other: TempCustomer | null = null;
let otherNote = '';
test.describe.configure({ mode: 'serial' });

const seed = async (orgId: string) => {
  const admin = adminClient();
  const { error } = await admin.from('notifications').insert([
    { org_id: orgId, title: 'KYC verified', body: 'Your company verification status changed.', link: '/account/kyc', created_at: new Date(Date.now() - 60_000).toISOString() },
    { org_id: orgId, title: '3PL request SR-E2E paid', body: 'Your 3pl request is now paid.', link: '/account/sourcing', created_at: new Date().toISOString() },
  ]);
  if (error) throw error;
};

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: env } = await admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  c = await createTempCustomer('notif');
  other = await createTempCustomer('notif-other');
  await seed(c.orgId);
  const { data } = await admin.from('notifications').insert({ org_id: other.orgId, title: 'Other company only' }).select('id').single();
  otherNote = data!.id as string;
});
test.afterAll(async () => { await purgeTestOrgs([c?.orgId, other?.orgId].filter(Boolean) as string[], [c?.id, other?.id].filter(Boolean) as string[]); });

const shot = async (p: Page, o: { path: string; fullPage?: boolean }) => {
  await expect(p.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: o.path, fullPage: o.fullPage ?? false });
};
const menuBadge = (p: Page) => p.getByTestId('section-menu').getByRole('link', { name: /^Notifications/ }).getByTestId('nav-badge');
const bell = (p: Page) => p.getByTestId('bell-unread');

test('desktop 1440: open one → bubble drops at once and stays after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await customerLogin(page, c!, '/account/notifications');
  await page.goto('/account/notifications');
  await expect(page.getByTestId('notification')).toHaveCount(2);
  await expect(menuBadge(page)).toHaveText('2');
  await expect(bell(page)).toHaveAttribute('data-unread', '2');
  if (SHOTS) await shot(page, { path: `${SHOTS}/notif-desktop-1-two-unread.png`, fullPage: false });

  // open "KYC verified" (Open →) and come back
  await page.getByTestId('notification').filter({ hasText: 'KYC verified' }).getByRole('link', { name: 'Open →' }).click();
  await page.waitForURL(/\/account\/kyc/);
  await expect(menuBadge(page)).toHaveText('1'); // side menu on the target page already shows 1
  await expect(bell(page)).toHaveAttribute('data-unread', '1');
  await page.goto('/account/notifications');
  await expect(menuBadge(page)).toHaveText('1');
  const kyc = page.getByTestId('notification').filter({ hasText: 'KYC verified' });
  await expect(kyc).toHaveAttribute('data-read', '1');
  await expect(kyc.getByTestId('unread-dot')).toHaveCount(0);
  if (SHOTS) await shot(page, { path: `${SHOTS}/notif-desktop-2-one-opened.png`, fullPage: false });

  await page.reload();
  await expect(menuBadge(page)).toHaveText('1');
  await expect(bell(page)).toHaveAttribute('data-unread', '1');

  // the second, by clicking the row
  await page.getByTestId('notification').filter({ hasText: 'SR-E2E' }).locator('p').click();
  await page.waitForURL(/\/account\/sourcing/);
  await expect(bell(page)).toHaveAttribute('data-unread', '0');
  await page.goto('/account/notifications');
  await expect(menuBadge(page)).toHaveCount(0);
  await expect(page.getByTestId('unread-dot')).toHaveCount(0);
  if (SHOTS) await shot(page, { path: `${SHOTS}/notif-desktop-3-all-read.png`, fullPage: false });
});

test('phone 390: same result with the header bell', async ({ page }) => {
  // fresh unread pair for the phone run
  const admin = adminClient();
  await admin.from('notifications').delete().eq('org_id', c!.orgId); // test company's own rows only (setup)
  await seed(c!.orgId);
  await page.setViewportSize({ width: 390, height: 844 });
  await customerLogin(page, c!, '/account/notifications');
  await page.goto('/account/notifications');
  await expect(bell(page)).toHaveAttribute('data-unread', '2');
  if (SHOTS) await shot(page, { path: `${SHOTS}/notif-phone-1-two-unread.png` });
  await page.getByTestId('notification').filter({ hasText: 'KYC verified' }).getByRole('link', { name: 'Open →' }).click();
  await page.waitForURL(/\/account\/kyc/);
  await expect(bell(page)).toHaveAttribute('data-unread', '1');
  await page.goto('/account/notifications');
  await expect(page.getByTestId('notification').filter({ hasText: 'KYC verified' }).getByTestId('unread-dot')).toHaveCount(0);
  if (SHOTS) await shot(page, { path: `${SHOTS}/notif-phone-2-one-opened.png` });
  await page.reload();
  await expect(bell(page)).toHaveAttribute('data-unread', '1');
});

test("direct API: a customer cannot mark another company's notification read", async () => {
  // signed in as customer A straight against the REST API (no app in between)
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: c!.email, password: c!.password });
  const upd = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', otherNote).select('id');
  expect(upd.error).toBeNull();
  expect(upd.data).toEqual([]); // nothing matched: not visible, not updatable
  const read = await sb.from('notifications').select('id').eq('id', otherNote);
  expect(read.data).toEqual([]);
  const title = await sb.from('notifications').update({ title: 'x' }).eq('org_id', c!.orgId).select('id');
  expect(title.error?.message ?? '').toMatch(/permission denied/i);
  const { data: still } = await adminClient().from('notifications').select('read_at').eq('id', otherNote).single();
  expect(still!.read_at).toBeNull();
});
