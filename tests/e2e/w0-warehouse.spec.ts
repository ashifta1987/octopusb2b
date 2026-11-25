import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Warehouse OS · W0 E2E (STAGING ONLY) — boards 1, 31, 8 (matched to the written design) + multi-warehouse Locations.
 *  1. Admin: dashboard with real counts and connections; warehouse switcher; add a second location (QE-01).
 *  2. Users and roles: add a packer, duplicate refused, suspend with a reason, restore; role table.
 *  3. A packer sees the dashboard but not Locations and can't manage people.
 *  4. Client portal: 8 tabs, real overview, active warehouses listed.
 *  5. axe clean at 1280 px and 390 px.
 */
test.describe.configure({ mode: 'serial' });

let admin: TempStaff | null = null;
let packer: TempStaff | null = null;
let client: TempCustomer | null = null;

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  admin = await createTempStaff('admin');
  packer = await createTempStaff('warehouse');
  client = await createTempCustomer('w0e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`insert into company_services(org_id, service, status) values ($1, 'warehouse', 'on') on conflict (org_id, service) do update set status = 'on'`, [client.orgId]);
    await db.query(`delete from warehouses where code = 'QE-01'`);
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`delete from warehouse_staff where warehouse_code = 'QE-01' or user_id = any($1::uuid[])`, [[admin?.id, packer?.id].filter(Boolean)]);
    await db.query(`delete from warehouses where code = 'QE-01' and not is_default`);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(packer);
  await deleteTempStaff(admin);
  void adminClient;
});

test('W0 admin: dashboard, switcher, add a location', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, admin!, '/office/warehouse');
  await page.goto('/office/warehouse');
  await expect(page.getByTestId('warehouse-staff-shell')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Dashboard');
  await expect(page.getByTestId('wh-connections')).toContainText('4PX');
  await expect(page.getByTestId('wh-tile-units-in-stock')).toBeVisible();
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('wh-switcher')).toBeVisible();
  await checkAxe(page, 'dashboard @1280');

  await page.goto('/office/warehouse/locations');
  await expect(page.getByTestId('wh-location-FS-01')).toContainText('Default');
  await page.getByTestId('wh-location-new').click();
  const f = page.getByTestId('wh-location-form');
  await f.getByLabel('Code').fill('QE-01');
  await f.getByLabel('Name').fill('E2E Qingyuan');
  await f.getByLabel('City').fill('Qingyuan');
  await f.getByLabel('Province').fill('Guangdong');
  await page.getByTestId('wh-location-save').click();
  await expect(page.getByTestId('wh-locations-msg')).toContainText('Saved');
  await expect(page.getByTestId('wh-location-QE-01')).toContainText('Active');
  await checkAxe(page, 'locations @1280');

  // switch to the new warehouse: the dashboard follows it
  await page.goto('/office/warehouse');
  await page.getByTestId('wh-switcher').getByLabel('Warehouse').selectOption('QE-01');
  await page.getByTestId('wh-switcher').getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByTestId('wh-dashboard')).toContainText('E2E Qingyuan · the day at a glance');
});

test('W0 users and roles: add, duplicate refused, suspend with a reason, restore', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await staffLogin(page, admin!, '/office/warehouse/users');
  await page.goto('/office/warehouse/users');
  await expect(page.getByTestId('wh-roles-table')).toContainText('Approve weight overrides (PIN)');
  const add = page.getByTestId('wh-add-staff');
  await add.getByLabel('Work email').fill(packer!.email);
  await add.getByLabel('Warehouse').selectOption('FS-01');
  await add.getByLabel('Role').selectOption('packer');
  await page.getByTestId('wh-add-submit').click();
  await expect(page.getByTestId('wh-users-msg')).toContainText('Added');
  await page.getByTestId('wh-add-submit').click();
  await expect(page.getByTestId('wh-users-msg')).toContainText('already works at this warehouse');
  await page.reload();
  const row = page.getByTestId(`wh-staff-${packer!.email}`);
  await expect(row).toContainText('Active');
  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(row.getByRole('button', { name: 'Suspend' })).toBeDisabled();
  await row.getByLabel('Reason').fill('E2E on leave');
  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByTestId('wh-users-msg')).toContainText('Suspended');
  await page.reload();
  await expect(page.getByTestId(`wh-staff-${packer!.email}`)).toContainText('E2E on leave');
  await page.getByTestId(`wh-staff-${packer!.email}`).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('wh-users-msg')).toContainText('Restored');
  await checkAxe(page, 'users @1280');
});

test('W0 packer: no Locations, cannot manage people', async ({ page }) => {
  await staffLogin(page, packer!, '/office/warehouse');
  await page.goto('/office/warehouse');
  await expect(page.locator('h1')).toContainText('Dashboard');
  await expect(page.getByTestId('warehouse-sidebar').getByRole('link', { name: 'Locations' })).toHaveCount(0);
  await page.goto('/office/warehouse/users');
  await expect(page.getByTestId('wh-add-staff')).toHaveCount(0);
  await expect(page.getByText('Only warehouse admins can add or change people.')).toBeVisible();
  await page.goto('/office/warehouse/locations');
  await expect(page).toHaveURL(/\/office\/warehouse$/);
});

test('W0 client portal: tabs, real overview, warehouses; axe at 1280 and 390', async ({ page }) => {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await customerLogin(page, client!, '/account/warehouse');
    await page.goto('/account/warehouse');
    await expect(page.getByTestId('wh-portal')).toBeVisible();
    const tabs = page.getByTestId('wh-portal-tabs');
    for (const t of ['Overview', 'Inventory', 'Orders', 'Send stock', 'Returns', 'Invoices', 'Integrations', 'Support']) await expect(tabs).toContainText(t);
    await expect(page.getByTestId('wh-portal-units-in-stock')).toContainText('—');
    await expect(page.getByTestId('wh-portal-open-orders')).toContainText(/\d/);
    await expect(page.locator('#wh-locs').locator('..')).toContainText('Foshan');
    await checkAxe(page, `portal @${w}`);
  }
  await page.context().clearCookies();
  await staffLogin(page, admin!, '/office/warehouse');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/office/warehouse', '/office/warehouse/users', '/office/warehouse/locations']) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    await checkAxe(page, `${route} @390`);
  }
});
