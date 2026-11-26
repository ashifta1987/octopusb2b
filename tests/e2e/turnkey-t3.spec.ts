import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { recordBankTransfer } from './helpers/turnkey';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Turnkey T3 E2E (STAGING ONLY) — design docs/design/turnkey-v2 (SetFee "admin approval above 2x", payment gates,
 * Account manager with cover; programme D5: the 2x rule is for service fees).
 *  1. Staff (admin A) sets fees on the project page: the form says whether approval is needed. Design at US$ 400
 *     (≤ 2× US$ 299) is active at once; Consultation at US$ 250 (> 2× US$ 99) waits for an admin. The move to
 *     Consultation is refused until its fee is active and paid. A sets the account manager (A) and a cover (B) for a
 *     period that includes today; "My projects" lists the project.
 *  2. Admin B sees only the above-2× fee in Admin › Turnkey › Fee approvals (the proposer A cannot approve it) and
 *     approves it: active, proforma issued.
 *  3. The client sees both fees (amount, "To pay", Pay from wallet) and no staff names or notes; the account manager
 *     card shows the cover. Finance records the bank transfer → the client sees "Paid".
 *  4. Staff moves the project into Consultation.
 *  axe clean at 1280 px and 390 px on every screen.
 */
test.describe.configure({ mode: 'serial' });
let adminA: TempStaff | null = null;
let adminB: TempStaff | null = null;
let client: TempCustomer | null = null;
let code = '';
let projectId = '';
const stamp = Date.now().toString(36);
const NAME_A = `E2E TK Anna ${stamp}`;
const NAME_B = `E2E TK Ben ${stamp}`;
const NOTE = `Two sessions agreed on the phone ${stamp}`;

async function checkAxe(page: Page, label: string) {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${label} @${w} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  await assertStagingOrThrow();
  adminA = await createTempStaff('admin');
  adminB = await createTempStaff('admin');
  client = await createTempCustomer('tk3e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    for (const [t, n] of [[adminA, NAME_A], [adminB, NAME_B]] as const) await db.query(`update profiles set full_name = $2 where id = $1`, [t!.id, n]);
    // the client's enquiry, through the same function the enquiry form calls (as the client)
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: client!.id, role: 'authenticated', aal: 'aal1' })]);
    await db.query('set local role authenticated');
    const r = (await db.query(`select tk_submit_enquiry($1, null, $2, 'TR', 'Izmir', null, 150, 3500000, 'A 150 m² gym in Izmir for local members, opening next spring.') r`,
      [client!.orgId, `TK3 E2E gym ${stamp}`])).rows[0].r;
    await db.query('commit');
    code = r.code; projectId = r.id;
  } finally {
    await db.end();
  }
});
test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (client) await db.query(`delete from tk_client_projects where org_id = $1`, [client.orgId]); // phases, history, staff facts and fees cascade
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]); // proforma, tax invoice and their lines
  await deleteTempStaff(adminA);
  await deleteTempStaff(adminB);
});

test('T3 staff: set fees (2x rule shown before sending), gate refuses the move, account manager + cover; axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-staff-fees')).toBeVisible();

  // Design: US$ 400 is within 2× the US$ 299 starting fee → active at once
  await page.getByTestId('tk-fee-stage').selectOption('design');
  await expect(page.getByTestId('tk-fee-service')).toHaveValue('layout_drawing');
  await expect(page.getByTestId('tk-fee-amount')).toHaveValue('299'); // starts at the starting fee
  await page.getByTestId('tk-fee-amount').fill('400');
  await expect(page.getByTestId('tk-fee-rule')).toContainText('Active at once');
  await page.getByTestId('tk-fee-propose').click();
  await expect(page.getByTestId('tk-fee-msg')).toContainText('active now');
  await expect(page.getByTestId('tk-staff-fee-design-v1')).toContainText('Active');
  await expect(page.getByTestId('tk-staff-fee-design-v1')).toContainText('Not needed (within 2× the starting fee)');

  // Consultation: US$ 250 is above 2× the US$ 99 starting fee → an admin (not A) approves it
  await page.getByTestId('tk-fee-stage').selectOption('consultation');
  await expect(page.getByTestId('tk-fee-amount')).toHaveValue('99');
  await expect(page.getByTestId('tk-fee-rule')).toContainText('Active at once');
  await page.getByTestId('tk-fee-amount').fill('250');
  await expect(page.getByTestId('tk-fee-rule')).toContainText('Needs an admin’s approval: above 2× the starting fee');
  await page.getByTestId('tk-fee-note').fill(NOTE);
  await page.getByTestId('tk-fee-propose').click();
  await expect(page.getByTestId('tk-fee-msg')).toContainText('an admin who is not you');
  const row = page.getByTestId('tk-staff-fee-consultation-v1');
  await expect(row).toContainText('US$ 250.00');
  await expect(row).toContainText('Waiting for admin approval');
  await expect(row).toContainText('2.5×');
  await expect(row).toContainText(NAME_A);
  await expect(row.getByText('You proposed this fee; another admin approves it.')).toBeVisible();

  // the gate: Consultation is locked until its fee is active and paid
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('starts after its fee is set and active');
  await expect(page.getByTestId('tk-phase-enquiry')).toHaveAttribute('data-state', 'current');

  // account manager + cover (yesterday → in a week: today is inside the period in every time zone)
  await page.getByTestId('tk-am-select').selectOption({ label: NAME_A });
  await page.getByTestId('tk-am-save').click();
  await expect(page.getByTestId('tk-staff-manager')).toContainText(NAME_A);
  await page.getByTestId('tk-cover-select').selectOption({ label: NAME_B });
  await page.getByTestId('tk-cover-from').fill(isoDay(-1));
  await page.getByTestId('tk-cover-to').fill(isoDay(7));
  await page.getByTestId('tk-cover-save').click();
  await expect(page.getByTestId('tk-manager-msg')).toContainText('Cover saved');
  await expect(page.getByTestId('tk-staff-cover')).toContainText(NAME_B);
  await expect(page.getByTestId('tk-staff-cover')).toContainText('covering now');
  await checkAxe(page, 'staff project (fees + manager)');

  await page.goto('/admin/turnkey/projects?mine=1');
  await expect(page.getByTestId(`tk-staff-row-${code}`)).toBeVisible();
  await expect(page.getByTestId(`tk-staff-row-${code}`)).toContainText(`Cover: ${NAME_B}`);
  await checkAxe(page, 'staff list (My projects)');
});

test('T3 admin B: only the above-2× fee is in Fee approvals; approves it; axe', async ({ page }) => {
  await staffLogin(page, adminB!, '/admin/turnkey/approvals');
  await page.goto('/admin/turnkey/approvals');
  const item = page.getByTestId(`tk-approval-${code}-consultation`);
  await expect(item).toContainText('US$ 250.00');
  await expect(item).toContainText(`Proposed by ${NAME_A}`);
  await expect(item).toContainText('starting fee From $99 · 2.5× the starting fee');
  await expect(item).toContainText(NOTE);
  await expect(page.getByTestId(`tk-approval-${code}-design`)).toHaveCount(0); // within 2×: never queued
  await checkAxe(page, 'fee approvals');
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(item).toContainText('Fee approved');
  await page.reload();
  await expect(page.getByTestId(`tk-approval-${code}-consultation`)).toHaveCount(0);
  await expect(page.getByTestId('tk-approvals-decided')).toContainText(`Approved by ${NAME_B}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  const row = page.getByTestId('tk-staff-fee-consultation-v1');
  await expect(row).toContainText('Active');
  await expect(row).toContainText(NAME_B);
  await expect(row).toContainText('awaiting payment');
});

test('T3 client: sees the active fees and Pay, the cover; paid after the bank transfer; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const fee = page.getByTestId('tk-fee-consultation');
  await expect(fee).toContainText('Consultation');
  await expect(page.getByTestId('tk-fee-amount-consultation')).toHaveText('US$ 250.00');
  await expect(fee).toContainText('To pay');
  await expect(fee.getByRole('button', { name: /Pay US\$ 250\.00 from wallet/ })).toBeVisible();
  await expect(page.getByTestId('tk-fee-amount-design')).toHaveText('US$ 400.00');
  await expect(page.getByTestId('tk-manager')).toContainText(NAME_B);
  await expect(page.getByTestId('tk-manager-cover')).toContainText(`while ${NAME_A} is away`);
  await expect(page.getByTestId('tk-history')).toContainText('Fee set for Consultation');
  // never staff facts: proposer / approver, internal note, starting-fee rule, suppliers, costs
  const main = page.locator('main:visible');
  await expect(main).not.toContainText(NOTE);
  await expect(main).not.toContainText(/approved by|proposed by|starting fee|supplier|margin|our cost/i);
  await checkAxe(page, 'client project (fees to pay)');

  const db = pgClient(); await db.connect();
  let doc: { id: string; amount_cents: string } | null = null;
  try {
    await assertStagingDatabase(db);
    doc = (await db.query(`select d.id, d.amount_cents from tk_project_fees f join documents d on d.id = f.document_id where f.project_id = $1 and f.stage = 'consultation' and f.status = 'active'`, [projectId])).rows[0];
  } finally { await db.end(); }
  expect(Number(doc!.amount_cents)).toBe(25000);
  const paid = await recordBankTransfer(doc!.id, 25000, `E2E-TK3-${stamp}`);
  expect(paid.fully_paid).toBe(true);
  await page.reload();
  await expect(fee).toContainText('Paid');
  await expect(fee.getByRole('button', { name: /from wallet/ })).toHaveCount(0);
  await checkAxe(page, 'client project (paid)');
});

test('T3 staff: the paid fee opens Consultation', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-move-gate')).toContainText('the fee is paid');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');
  await expect(page.getByTestId('tk-phase-consultation')).toHaveAttribute('data-state', 'current');
});
