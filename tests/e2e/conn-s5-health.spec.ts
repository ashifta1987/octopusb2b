import { test, expect } from './helpers/settled';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * CONN S5 · System health E2E (STAGING ONLY; no store or carrier is called).
 *  Seeded (service role): a WooCommerce store that "needs reconnect" and a store update that failed after 8 tries.
 *  Staff › System health: both are listed with the merchant and the problem; Contact merchant → "The merchant got a message";
 *  Retry (store update) → back in the queue (the row leaves the list, the message stays); Retry (store) answers in words (tested,
 *  or "not switched on on this server"). 1280 + 390, axe clean.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const SHOP = `e2e-s5-${stamp}.example.com`;
let staff: TempStaff | null = null;
let merchant: TempCustomer | null = null;
let connId = '';
let taskId = '';

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
  merchant = await createTempCustomer('s5m');
  connId = (await sql<{ id: string }>(`insert into store_connections (org_id, platform, shop_domain, store_url, status, status_reason, last_error, last_error_at)
    values ($1, 'woocommerce', $2, $3, 'needs_reconnect', 'The store refused our keys.', 'The store refused our keys.', now()) returning id`, [merchant.orgId, SHOP, `https://${SHOP}`]))[0].id;
  const so = (await sql<{ id: string }>(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency, shipping_method)
    values ($1, 'woocommerce', $2, '#E2E-S5', 'Buyer', '{}'::jsonb, 'AE', 'USD', 'standard') returning id`, [merchant.orgId, `E2E-S5-${stamp}`]))[0].id;
  taskId = (await sql<{ id: string }>(`insert into dropship_channel_tasks (store_order_id, org_id, channel, action, status, detail, store_connection_id, attempts, last_error)
    values ($1, $2, 'woocommerce', 'send_tracking', 'failed', '{}'::jsonb, $3, 8, 'HTTP 500 from the store') returning id`, [so, merchant.orgId, connId]))[0].id;
});

test.afterAll(async () => {
  await sql(`delete from dropship_channel_tasks where id = $1`, [taskId || null]).catch(() => {});
  await sql(`delete from store_connections where id = $1`, [connId || null]).catch(() => {});
  await purgeTestOrgs([merchant?.orgId].filter(Boolean) as string[], [merchant?.id].filter(Boolean) as string[]);
  await deleteTempStaff(staff);
});

test('System health › stores and carriers needing attention @1280 + 390', async ({ page }) => {
  await staffLogin(page, staff!, '/office/dropship/health');
  await page.goto('/office/dropship/health');
  const card = page.getByTestId('c5-health');
  await expect(card).toBeVisible();
  await expect(page.getByTestId(`c5-conn-${connId}`)).toContainText(SHOP);
  await expect(page.getByTestId(`c5-conn-${connId}`)).toContainText('The store refused our keys.');
  await expect(page.getByTestId(`c5-task-${taskId}`)).toContainText('#E2E-S5');
  await expect(page.getByTestId(`c5-task-${taskId}`)).toContainText('HTTP 500 from the store');
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
    if (w === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).include('[data-testid="c5-health"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), `axe @${w}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });

  await page.getByTestId(`c5-contact-${connId}`).click();
  await expect(page.getByTestId('c5-health-msg')).toContainText('The merchant got a message');

  await page.getByTestId(`c5-task-retry-${taskId}`).click();
  await expect(page.getByTestId('c5-health-msg')).toContainText('Back in the queue');
  await expect(page.getByTestId(`c5-task-${taskId}`)).toHaveCount(0);
  expect((await sql<{ status: string; attempts: number }>(`select status, attempts from dropship_channel_tasks where id = $1`, [taskId]))[0]).toEqual({ status: 'waiting_store', attempts: 0 });

  await page.getByTestId(`c5-retry-${connId}`).click();
  await expect(page.getByTestId('c5-health-msg')).toContainText(/not switched on on this server|Still failing|The store answered/);
});
