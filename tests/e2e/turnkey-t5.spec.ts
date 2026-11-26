import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { advanceTurnkeyToProductionQc, recordBankTransfer } from './helpers/turnkey';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Turnkey T5 E2E (STAGING ONLY) — design docs/design/turnkey-v2 ("6. Production and QC: factory audit and inspections,
 * each paid before it starts"; QC covers factory audit and pre-shipment inspection; InspectorMobile checklist with
 * Pass / Fail / N/A and photos; supplier details hidden from clients). D6: online inspector screen.
 *  1. Staff plan a pre-shipment inspection (factory: staff only) and set its fee (US$ 249: within 2×, active at once);
 *     scheduling is blocked until the client pays.
 *  2. The client sees the inspection and its fee with Pay — never the factory. Finance records the bank transfer.
 *  3. Staff schedule the inspector (QC coordinator) for today.
 *  4. The inspector, on a 390 px phone, starts, answers the checklist, uploads a photo (private bucket), enters the AQL
 *     numbers, Pass, signs and submits.
 *  5. Staff (not the inspector) publish the report with a client summary; Production and QC can complete → Shipment.
 *  6. The client sees the published report: result, summary, defects, photo through a signed link; no factory name.
 *  axe clean at 1280 px and 390 px on every screen.
 */
test.describe.configure({ mode: 'serial' });
let adminA: TempStaff | null = null;
let inspector: TempStaff | null = null;
let client: TempCustomer | null = null;
let code = '';
let projectId = '';
let depositBefore: unknown = undefined;
let drawingPaths: string[] = [];
const stamp = Date.now().toString(36);
const FACTORY = `E2E Ningbo Fitworks ${stamp}`;
const INSPECTOR_NAME = `E2E TK5 Inspector ${stamp}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function checkAxe(page: Page, label: string, end: 1280 | 390 = 1280) {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${label} @${w} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
  }
  await page.setViewportSize(end === 1280 ? { width: 1280, height: 1000 } : { width: 390, height: 844 });
}
async function noFactoryLeak(page: Page) {
  const main = page.locator('main:visible');
  await expect(main).not.toContainText(FACTORY);
  await expect(main).not.toContainText(/ningbo|fitworks|supplier|factory name|remarks \(staff/i);
  await expect(main).not.toContainText(INSPECTOR_NAME);
}
const today = () => new Date().toISOString().slice(0, 10); // the database compares with current_date (UTC)

test.beforeAll(async () => {
  await assertStagingOrThrow();
  adminA = await createTempStaff('admin');
  inspector = await createTempStaff('qc_coordinator');
  client = await createTempCustomer('tk5e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`update profiles set full_name = $2 where id = $1`, [adminA.id, `E2E TK5 Admin ${stamp}`]);
    await db.query(`update profiles set full_name = $2 where id = $1`, [inspector.id, INSPECTOR_NAME]);
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: client!.id, role: 'authenticated', aal: 'aal1' })]);
    await db.query('set local role authenticated');
    const r = (await db.query(`select tk_submit_enquiry($1, null, $2, 'TR', 'Izmir', null, 150, 3500000, 'A 150 m² gym in Izmir for local members, opening next spring.') r`,
      [client!.orgId, `TK5 E2E gym ${stamp}`])).rows[0].r;
    await db.query('commit');
    code = r.code; projectId = r.id;
  } finally {
    await db.end();
  }
  // every earlier gate through the real functions (fees paid, drawing approved, quote accepted, deposit paid)
  const a = await advanceTurnkeyToProductionQc({ projectId, staff: adminA.id, customer: client.id, stamp });
  depositBefore = a.depositBefore; drawingPaths = a.drawingPaths;
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (projectId) {
      const photos = (await db.query(`select file_path from tk_inspection_photos where project_id = $1`, [projectId])).rows.map((r) => r.file_path as string);
      if (photos.length) await adminClient().storage.from('turnkey-inspections').remove(photos); // files go through the Storage API
      if (drawingPaths.length) await adminClient().storage.from('turnkey-drawings').remove(drawingPaths);
    }
    if (client) await db.query(`delete from tk_client_projects where org_id = $1`, [client.orgId]); // inspections, fees, reports, photos cascade
    if (depositBefore === undefined) await db.query(`delete from site_settings where key = 'turnkey.deposit_pct'`);
    else await db.query(`update site_settings set value = $1 where key = 'turnkey.deposit_pct'`, [JSON.stringify(depositBefore)]);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]); // proformas (fees, deposit, inspection fee) and their lines
  await deleteTempStaff(inspector);
  await deleteTempStaff(adminA);
});

test('T5 staff: plan a pre-shipment inspection, set its fee; scheduling waits for payment; axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-phase-production_qc')).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('tk-move-finish')).toContainText('pre-shipment inspection has passed and its report is published');
  await page.getByTestId('tk-qc-kind').selectOption('pre_shipment');
  await page.getByTestId('tk-qc-factory').fill(FACTORY);
  await page.getByTestId('tk-qc-checklist').fill('Carton marks and labels\nFunction test: belt and motor\nSurface finish');
  await page.getByTestId('tk-qc-create-save').click();
  await expect(page.getByTestId('tk-qc-create-msg')).toContainText('Planned');
  const box = page.getByTestId('tk-staff-inspection-pre_shipment-1');
  await expect(box).toContainText('Planned · fee first');
  await expect(page.getByTestId('tk-qc-fee-amount-pre_shipment-1')).toHaveValue('249');
  await expect(page.getByTestId('tk-qc-fee-rule-pre_shipment-1')).toContainText('Active at once');
  await page.getByTestId('tk-qc-fee-save-pre_shipment-1').click();
  await expect(page.getByTestId('tk-qc-fee-msg-pre_shipment-1')).toContainText('active now');
  await expect(page.getByTestId('tk-qc-fee-pre_shipment-1')).toContainText('awaiting payment');
  await expect(page.getByTestId('tk-qc-schedule-blocked-pre_shipment-1')).toContainText('after the client pays');
  await expect(page.getByTestId('tk-qc-schedule-save-pre_shipment-1')).toBeDisabled();
  await checkAxe(page, 'staff project (QC planned)');
});

test('T5 client: sees the inspection and its fee with Pay — never the factory; Finance records the transfer; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const box = page.getByTestId('tk-inspection-pre_shipment-1');
  await expect(box).toContainText('Pre-shipment inspection');
  await expect(box).toContainText('Being arranged');
  const fee = page.getByTestId('tk-inspection-fee-pre_shipment-1');
  await expect(fee).toContainText('US$ 249.00');
  await expect(fee).toContainText('To pay');
  await expect(fee.getByRole('button', { name: /Pay US\$ 249\.00 from wallet/ })).toBeVisible();
  await noFactoryLeak(page);
  await checkAxe(page, 'client project (inspection fee to pay)');

  const db = pgClient(); await db.connect();
  let doc: { id: string; amount_cents: string } | null = null;
  try {
    await assertStagingDatabase(db);
    doc = (await db.query(`select d.id, d.amount_cents from tk_inspection_fees f join documents d on d.id = f.document_id where f.project_id = $1 and f.status = 'active'`, [projectId])).rows[0];
  } finally { await db.end(); }
  expect(Number(doc!.amount_cents)).toBe(24900);
  expect((await recordBankTransfer(doc!.id, 24900, `E2E-TK5-PSI-${stamp}`)).fully_paid).toBe(true);
  await page.reload();
  await expect(page.getByTestId('tk-inspection-fee-pre_shipment-1')).toContainText('Paid');
});

test('T5 staff: schedule the inspector once paid', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-qc-fee-pre_shipment-1')).toContainText('paid');
  await page.getByTestId('tk-qc-inspector-pre_shipment-1').selectOption({ label: INSPECTOR_NAME });
  await page.getByTestId('tk-qc-date-pre_shipment-1').fill(today());
  await page.getByTestId('tk-qc-schedule-save-pre_shipment-1').click();
  await expect(page.getByTestId('tk-qc-schedule-msg-pre_shipment-1')).toContainText('Scheduled');
  await expect(page.getByTestId('tk-staff-inspection-pre_shipment-1')).toContainText(INSPECTOR_NAME);
});

test('T5 inspector (phone, 390 px): checklist, photo to the private bucket, AQL, Pass, signature, submit; axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await staffLogin(page, inspector!, '/office/turnkey/inspect');
  await page.goto('/office/turnkey/inspect');
  await page.getByTestId(`tk-insp-job-${code}-pre_shipment-1`).click();
  await expect(page.getByTestId('tk-insp-facts')).toContainText(FACTORY); // the inspector needs the factory
  await checkAxe(page, 'inspector (scheduled)', 390);
  await page.getByTestId('tk-insp-start').click();
  await expect(page.getByTestId('tk-insp-msg')).toContainText('Started');
  await page.getByTestId('tk-insp-ans-1-pass').check();
  await page.getByTestId('tk-insp-ans-2-pass').check();
  await page.getByTestId('tk-insp-ans-3-na').check();
  await page.getByTestId('tk-insp-photo').setInputFiles({ name: 'carton.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('tk-insp-msg')).toContainText('Photo added');
  await expect(page.getByTestId('tk-insp-photos').locator('li')).toHaveCount(1);
  await page.getByTestId('tk-insp-lot').fill('500');
  await page.getByTestId('tk-insp-sample').fill('50');
  await page.getByTestId('tk-insp-crit').fill('0');
  await page.getByTestId('tk-insp-major').fill('0');
  await page.getByTestId('tk-insp-minor').fill('2');
  await page.getByTestId('tk-insp-result-pass').check();
  await page.getByTestId('tk-insp-signed').fill(INSPECTOR_NAME);
  await expect(page.getByTestId('tk-insp-problem')).toHaveCount(0);
  await checkAxe(page, 'inspector (filled in)', 390);
  await page.getByTestId('tk-insp-submit').click();
  await expect(page.getByTestId('tk-insp-closed')).toContainText('Report submitted');
});

test('T5 staff: review and publish (not the inspector); Production and QC completes → Shipment; axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  const report = page.getByTestId('tk-qc-report-pre_shipment-1');
  await expect(report).toContainText('Passed');
  await expect(report).toContainText('500 / 50');
  await expect(report).toContainText(INSPECTOR_NAME); // signature (staff only)
  await page.getByTestId('tk-qc-summary-pre_shipment-1').fill('Passed: no critical or major defects; 2 minor marks on cartons.');
  await checkAxe(page, 'staff project (report to review)');
  await page.getByTestId('tk-qc-publish-pre_shipment-1').click();
  await expect(page.getByTestId('tk-staff-inspection-pre_shipment-1')).toContainText('Report ready');
  await expect(page.getByTestId('tk-qc-gate')).toContainText('passed and the report is published');
  await expect(page.getByTestId('tk-move-finish')).toContainText('passed and the report is published');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');
  await expect(page.getByTestId('tk-phase-shipment')).toHaveAttribute('data-state', 'current');
});

test('T5 client: the published report (result, summary, defects, photo by signed link) without the factory; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const rep = page.getByTestId('tk-inspection-report-pre_shipment-1');
  await expect(page.getByTestId('tk-inspection-result-pre_shipment-1')).toHaveText('Passed');
  await expect(rep).toContainText('no critical or major defects');
  await expect(page.getByTestId('tk-inspection-defects-pre_shipment-1')).toHaveText('Critical 0 · major 0 · minor 2');
  await expect(rep).toContainText('Function test: belt and motor: Pass');
  const href = await page.getByTestId('tk-inspection-photo-pre_shipment-1').first().getAttribute('href');
  expect(href).toMatch(/\/storage\/v1\/object\/sign\/turnkey-inspections\//); // short signed link, never a public URL
  await expect(page.getByTestId('tk-history')).toContainText('Pre-shipment inspection report: Passed.');
  await noFactoryLeak(page);
  await checkAxe(page, 'client project (report published)');
});
