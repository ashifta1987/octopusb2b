import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, createTempCustomer, customerLogin, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * Bug 2 (8 Nov 2026) — STAGING ONLY. A test customer submits a brand project through the real form → it is in
 * Admin › Brand projects at once with its fields and logo file; the Admin team has "New brand project MB-… — needs an
 * account manager" (no manager) and the customer has "Brand project received"; one admin e-mail is recorded; opening
 * the notification marks it read; staff close it with an internal reason the customer never sees; another customer
 * cannot read the project or its logo through the API. Desktop 1440 + phone 390 screenshots.
 */
const SHOTS = process.env.SHOTS_DIR;
let c: TempCustomer | null = null;
let other: TempCustomer | null = null;
let staff: TempStaff | null = null;
let ref = ''; let projectId = ''; let logoPath = '';
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: env } = await admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  c = await createTempCustomer('brand-admin');
  other = await createTempCustomer('brand-other');
  staff = await createTempStaff('admin');
});
test.afterAll(async () => {
  const admin = adminClient();
  if (projectId) {
    await admin.from('notifications').delete().like('dedupe_key', `brand_project:${projectId}:%`);
    if (logoPath) await admin.storage.from('brand-logos').remove([logoPath]);
    await admin.from('brand_projects').delete().eq('id', projectId);
  }
  if (staff) await admin.from('notifications').delete().eq('user_id', staff.id);
  await deleteTempStaff(staff);
  await purgeTestOrgs([c?.orgId, other?.orgId].filter(Boolean) as string[], [c?.id, other?.id].filter(Boolean) as string[]);
});

test('customer submits a brand project through the form', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await customerLogin(page, c!, '/request/brand');
  await page.goto('/request/brand');
  const w = page.getByTestId('brand-wizard');
  await w.getByTestId('brand-products').locator('label').first().click();
  await w.getByRole('button', { name: 'UAE', exact: true }).click();
  await w.getByLabel('Quantity (units)').fill('500');
  await w.getByTestId('brand-next').click();
  await w.locator('input[name="method"][value="box"]').check();
  await w.locator('input[name="packaging"][value="gift_box"]').check();
  await page.locator('#mb-logo').setInputFiles({ name: 'acme-logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') });
  await expect(w.getByText('acme-logo.svg')).toBeVisible();
  await w.getByTestId('brand-next').click();
  await w.locator('input[name="dest"][value="warehouse"]').check();
  await w.getByRole('button', { name: 'Shopify', exact: true }).click(); // warehouse stock needs a store
  await w.getByTestId('brand-send').click();
  await expect(page.getByTestId('brand-success')).toBeVisible({ timeout: 30_000 });
  ref = await page.getByTestId('brand-ref').innerText();
  const { data: bp } = await adminClient().from('brand_projects').select('id, logo_paths').eq('ref', ref).single();
  projectId = bp!.id as string; logoPath = (bp!.logo_paths as string[])[0];
  // the customer's confirmation
  await page.goto('/account/notifications');
  await expect(page.getByTestId('notification').filter({ hasText: `Brand project received · ${ref}` })).toBeVisible();
  await expect(page.getByTestId('notification').filter({ hasText: 'New brand project' })).toHaveCount(0);
});

test('one admin e-mail is recorded for the new project', async () => {
  const admin = adminClient();
  await expect.poll(async () => (await admin.from('brand_projects').select('admin_emailed_at').eq('id', projectId).single()).data?.admin_emailed_at ?? null, { timeout: 20_000 }).not.toBeNull();
  const { count } = await admin.from('email_deliveries').select('id', { count: 'exact', head: true }).eq('template', 'brand_project.submitted').gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  expect(count).toBeGreaterThanOrEqual(1);
});

test('Admin desktop 1440: list, notification opens the project and marks it read, logo link, close with a reason', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await staffLogin(page, staff!, '/admin/brand-projects');
  await page.goto('/admin/brand-projects');
  const row = page.getByTestId('brand-row').filter({ hasText: ref });
  await expect(row).toBeVisible();
  await expect(row).toContainText('500');
  await expect(row).toContainText('Branded colour box · Premium gift box');
  await expect(row).toContainText('Octopus warehouse');
  await expect(row.getByTestId('unassigned')).toHaveText('Unassigned');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-admin-desktop-1-list.png` });

  const bell = page.getByTestId('staff-bell').getByTestId('bell-unread');
  const before = Number(await bell.getAttribute('data-unread'));
  expect(before).toBeGreaterThanOrEqual(1);
  await page.goto('/admin/notifications');
  const note = page.getByTestId('notification').filter({ hasText: `New brand project ${ref} — needs an account manager` });
  await expect(note).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-admin-desktop-2-notifications.png` });
  await note.getByRole('link', { name: 'Open →' }).click();
  await page.waitForURL(new RegExp(`/admin/brand-projects/${projectId}`));
  await expect(bell).toHaveAttribute('data-unread', String(before - 1));

  // detail: full request + logo file (10-minute signed link that works)
  await expect(page.getByText('Premium gift box')).toBeVisible();
  const href = await page.getByTestId('logo-link').getAttribute('href');
  expect(href).toMatch(/\/storage\/v1\/object\/sign\/brand-logos\/.+token=/);
  expect((await page.request.get(href!)).status()).toBe(200);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-admin-desktop-3-detail.png`, fullPage: true });

  // close needs an internal reason
  await page.getByLabel('Move to').selectOption('closed');
  await page.getByLabel(/Internal reason/).fill('Customer chose another supplier (test)');
  await page.getByRole('button', { name: 'Close project' }).click();
  await expect(page.getByTestId('status-msg')).toContainText('→ closed');
  await expect(page.getByTestId('history')).toContainText('Internal reason: Customer chose another supplier (test)');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-admin-desktop-4-closed.png`, fullPage: true });
});

test('customer sees Closed and the notification, never the internal reason', async ({ page }) => {
  await customerLogin(page, c!, '/account/brand');
  await page.goto(`/account/brand?project=${ref}`);
  await expect(page.locator(`[id="${ref}"]`)).toContainText('Closed');
  await expect(page.getByText('another supplier')).toHaveCount(0);
  await page.goto('/account/notifications');
  await expect(page.getByTestId('notification').filter({ hasText: `Brand project ${ref} closed` })).toBeVisible();
  await expect(page.getByText('another supplier')).toHaveCount(0);
});

test('Admin phone 390: list and detail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await staffLogin(page, staff!, '/admin/brand-projects');
  await page.goto('/admin/brand-projects');
  await expect(page.getByTestId('brand-row').filter({ hasText: ref })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-admin-phone-1-list.png` });
  await page.goto(`/admin/brand-projects/${projectId}`);
  await expect(page.getByTestId('status-form')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-admin-phone-2-detail.png`, fullPage: true });
});

test("direct API: another customer can't read the project or its logo", async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: other!.email, password: other!.password });
  expect((await sb.from('brand_projects').select('id').eq('id', projectId)).data).toEqual([]);
  expect((await sb.rpc('admin_brand_projects', { p_id: projectId, p_status: null })).data ?? []).toEqual([]);
  const signed = await sb.storage.from('brand-logos').createSignedUrl(logoPath, 600);
  expect(signed.data?.signedUrl ?? null).toBeNull();
  const st = await sb.rpc('set_brand_project_status', { p_id: projectId, p_to: 'proof', p_reason: null });
  expect(st.error?.message ?? '').toMatch(/FORBIDDEN/);
});

