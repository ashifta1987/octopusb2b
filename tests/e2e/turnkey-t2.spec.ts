import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
import { seedPaidTurnkeyFee } from './helpers/turnkey';

/**
 * Turnkey T2 E2E (STAGING ONLY) — design docs/design/turnkey-v2 (Enquiry, NewProject / ClientIntake, ClientPortal,
 * staff Project; matched to the text).
 *  1. Signed out: the catalogue pop-up's "Book a consultation" asks to log in and comes back to the enquiry form with
 *     the project chosen; Send stays disabled until the plan is given; the new project opens at Enquiry (phase 1 of 8).
 *  2. My turnkey projects lists it; nothing about suppliers or costs is on the client pages.
 *  3. Staff: Client projects list → project; move to Consultation (since T3 only after its fee is set and paid: a fee
 *     at the starting price is active at once; seeded through the database functions), set the account manager and a
 *     target date.
 *  4. The client sees Consultation as the current phase, the account manager's name and the history.
 *  5. axe clean at 1280 px and 390 px.
 */
test.describe.configure({ mode: 'serial' });
let admin: TempStaff | null = null;
let client: TempCustomer | null = null;
let code = '';
let projectId = '';

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, `${label} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  admin = await createTempStaff('admin');
  client = await createTempCustomer('tk2e2e');
});
test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (client) await db.query(`delete from tk_client_projects where org_id = $1`, [client.orgId]); // phases, history, staff facts, fees cascade
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]);
  await deleteTempStaff(admin);
});

test('T2 enquiry: catalogue → log in → form → project at Enquiry; axe', async ({ page }) => {
  await page.goto('/turnkey/catalogue'); // design handoff: the live catalogue moved from /turnkey
  // skip cards left by the T1 import test (its cleanup deletes the row while the catalogue is cached for 5 minutes)
  const first = page.getByTestId('tk-cards').locator('button:not([data-testid^="tk-card-tk-e2e"])').first();
  const pid = ((await first.getAttribute('data-testid')) ?? '').replace(/^tk-card-/, '');
  await first.click();
  await page.getByTestId('tk-dialog').getByRole('link', { name: 'Book a consultation' }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(decodeURIComponent(page.url())).toContain(`/account/turnkey/new?project=${pid}`);

  await customerLogin(page, client!, `/account/turnkey/new?project=${pid}`);
  await expect(page).toHaveURL(new RegExp(`/account/turnkey/new\\?project=${pid}`));
  await expect(page.getByTestId('tk-enquiry-project')).toHaveValue(pid);
  const send = page.getByTestId('tk-enquiry-send');
  await expect(send).toBeDisabled();
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) { await page.setViewportSize({ width: w, height: h }); await checkAxe(page, `enquiry @${w}`); }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#tk-city').fill('Izmir');
  await page.locator('#tk-area').fill('150');
  await page.locator('#tk-budget').fill('lots');
  await page.getByTestId('tk-enquiry-plan').fill('A 150 m² gym in Izmir for local members, opening next spring.');
  await expect(send).toBeDisabled(); // budget must be a number
  await page.locator('#tk-budget').fill('35,000');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page).toHaveURL(/\/account\/turnkey\/TKP-\d{5,}\?created=1/);
  code = page.url().match(/TKP-\d{5,}/)![0];
  await expect(page.getByTestId('tk-created')).toBeVisible();
  await expect(page.getByTestId('tk-phase-enquiry')).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('tk-phase-consultation')).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('tk-phases-timeline').locator('li')).toHaveCount(8);
  await expect(page.getByTestId('tk-plan')).toContainText('$35,000');
  await expect(page.getByTestId('tk-plan')).toContainText('About 150 m²');
  await expect(page.getByTestId('tk-plan')).toContainText('Opening');
  await expect(page.getByTestId('tk-manager')).toContainText('We will name your account manager soon');
  await expect(page.locator('main:visible')).not.toContainText(/supplier|factory name|margin|our cost/i);
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) { await page.setViewportSize({ width: w, height: h }); await checkAxe(page, `project @${w}`); }

  await page.goto('/account/turnkey');
  await expect(page.getByTestId(`tk-row-${code}`)).toContainText('Phase 1 of 8 · Enquiry');
  await checkAxe(page, 'my projects @390');

  const db = pgClient(); await db.connect();
  try { await assertStagingDatabase(db); projectId = (await db.query(`select id from tk_client_projects where code = $1`, [code])).rows[0].id; } finally { await db.end(); }
  expect(projectId).toBeTruthy();
});

test('T2 staff: list, move to Consultation, account manager, target date; axe', async ({ page }) => {
  await staffLogin(page, admin!, '/admin/turnkey/projects');
  await page.goto('/admin/turnkey/projects');
  await expect(page.getByTestId('tk-staff-funnel')).toBeVisible();
  await page.locator('#tk-f-q').fill(code);
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.getByTestId(`tk-staff-row-${code}`)).toContainText('E2E Buyer tk2e2e');
  await checkAxe(page, 'staff list');
  await page.getByTestId(`tk-staff-row-${code}`).getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/turnkey/projects/${code}$`));
  await expect(page.getByTestId('tk-staff-controls')).toBeVisible();
  await checkAxe(page, 'staff project');

  await expect(page.getByTestId('tk-move-gate')).toContainText('set its fee');
  await seedPaidTurnkeyFee({ projectId, stage: 'consultation', service: 'consultation', cents: 9900, proposer: admin!.id, reference: `E2E-TK2-${Date.now()}` });
  await page.reload();
  await expect(page.getByTestId('tk-move-gate')).toContainText('the fee is paid');
  await page.locator('#tk-fwd-note').fill('We will call you to agree the consultation fee.');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');
  await expect(page.getByTestId('tk-phase-consultation')).toHaveAttribute('data-state', 'current');

  await page.getByTestId('tk-am-select').selectOption({ label: 'E2E admin' });
  await page.getByTestId('tk-am-save').click();
  await expect(page.getByTestId('tk-staff-manager')).toContainText('E2E admin');

  await page.locator('#tk-due-stage').selectOption('consultation');
  await page.locator('#tk-due').fill('2031-01-15');
  await page.getByTestId('tk-due-save').click();
  await expect(page.getByTestId('tk-phase-consultation')).toContainText('Target 15 Jan 2031');

  await page.getByTestId('tk-status-select').selectOption('on_hold');
  await expect(page.getByTestId('tk-status-save')).toBeDisabled(); // a reason is required
});

test('T2 client sees the new phase, the account manager and the history', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  await expect(page.getByTestId('tk-phase-enquiry')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('tk-phase-consultation')).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('tk-manager')).toContainText('E2E admin');
  await expect(page.getByTestId('tk-history')).toContainText('Moved to Consultation');
  await expect(page.getByTestId('tk-history')).toContainText('We will call you to agree the consultation fee.');
  await expect(page.getByTestId('tk-history')).toContainText('Target date for Consultation: 15 Jan 2031');
});
