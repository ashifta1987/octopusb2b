import { test, expect } from './helpers/settled';
import AxeBuilder from '@axe-core/playwright';
import { pgClient } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * CONN S4 · Carrier layer E2E (STAGING ONLY; sandbox carrier account, no carrier is called).
 *  1. Office › Warehouse › Carriers: a sandbox account → "Test connection" → "Connection works" and "Last test worked" on the
 *     account; services show the Magnets column; a new service can be added with "Takes magnets" off. 1280 + 390, axe clean.
 *  2. Commercial invoice link: an unknown label → 404 page (no PDF, nothing leaked).
 * Everything the test adds is removed in afterAll.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const ACC = `E2E S4 sandbox ${stamp}`;
const CODE = `S4E${stamp}`.toUpperCase().slice(0, 20);
let staff: TempStaff | null = null;
let accId = '';

async function sql<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    return (await db.query(q, p)).rows as T[];
  } finally {
    await db.end();
  }
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  staff = await createTempStaff('admin');
  accId = (await sql<{ id: string }>(`insert into wh_carrier_accounts (warehouse_code, carrier, name, mode) values ('FS-01', '4px', $1, 'sandbox') returning id`, [ACC]))[0].id;
});

test.afterAll(async () => {
  if (accId) {
    await sql(`delete from integration_logs where endpoint = $1`, [`carrier_account:${accId}`]).catch(() => {});
    await sql(`delete from wh_carrier_services where account_id = $1`, [accId]).catch(() => {});
    await sql(`delete from wh_carrier_accounts where id = $1`, [accId]).catch(() => {});
  }
  await deleteTempStaff(staff);
});

test('Carriers › Test connection + magnets @1280 + 390', async ({ page }) => {
  await staffLogin(page, staff!, '/office/warehouse/carriers');
  await page.goto('/office/warehouse/carriers');
  const row = page.getByTestId(`wh-account-${accId}`);
  await expect(row).toContainText(ACC);
  await row.getByTestId(`wh-account-test-${accId}`).click();
  await expect(page.getByTestId(`wh-account-row-msg-${accId}`)).toContainText('Connection works');
  await expect(page.getByTestId(`wh-account-check-${accId}`)).toContainText('Last test worked');
  await row.locator('summary').click();
  const form = page.getByTestId(`wh-service-form-${accId}`);
  await form.getByLabel('Product code').fill(CODE);
  await form.getByLabel('Service name').fill('E2E air');
  await form.getByLabel('Takes magnets').uncheck();
  await page.getByTestId(`wh-service-submit-${accId}`).click();
  await expect(page.getByTestId(`wh-service-${CODE}`)).toContainText('E2E air');
  await expect(row.locator('th', { hasText: 'Magnets' })).toBeVisible();
  const [svc] = await sql<{ accepts_magnet: boolean }>(`select accepts_magnet from wh_carrier_services where account_id = $1 and code = $2`, [accId, CODE]);
  expect(svc.accepts_magnet).toBe(false);
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
    if (w === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), `axe @${w}`).toEqual([]);
  }
});

test('Commercial invoice of an unknown label → 404, no PDF', async ({ page }) => {
  await staffLogin(page, staff!, '/office/warehouse/labels');
  const r = await page.request.get('/api/labels/commercial-invoice/00000000-0000-4000-8000-000000000000');
  expect(r.status()).toBe(404);
  expect(r.headers()['content-type']).not.toContain('pdf');
});
