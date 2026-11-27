import { type Page } from '@playwright/test';
// dev-server timing: wait for hydration after every goto, 15 s assertions (see helpers/settled.ts)
import { test, expect } from './helpers/settled';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { moveTurnkeyStage, recordBankTransfer, seedPaidTurnkeyFee } from './helpers/turnkey';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Turnkey T4 E2E (STAGING ONLY) — design docs/design/turnkey-v2 (Design: layout drawing versions; Sourcing: quotes from
 * suppliers hidden from the client; Quote and deposit: the client approves the quote and pays the deposit; D5: the
 * deposit % comes from settings).
 *  1. Staff upload a drawing (private bucket) on the project page → version 1 is shared.
 *  2. The client opens it (signed link), approves it → Design is complete.
 *  3. Staff move to Sourcing (its fee seeded as paid), the admin sets the deposit % (Turnkey › Services and fees),
 *     staff add a factory quote (supplier + cost, staff only), build the client quote (margin shown) and send it.
 *  4. Staff move to Quote and deposit. The client sees only Octopus lines, total and deposit — never the factory name, a
 *     cost or a margin — accepts, and the deposit proforma appears with Pay. Finance records the bank transfer → Paid.
 *  5. Staff: the phase can complete (Production and QC after its own T3 fee).
 *  axe clean at 1280 px and 390 px on every screen.
 */
test.describe.configure({ mode: 'serial' });
let adminA: TempStaff | null = null;
let client: TempCustomer | null = null;
let code = '';
let projectId = '';
let depositBefore: unknown = undefined; // the staging setting before this run (restored afterwards)
const stamp = Date.now().toString(36);
const SUPPLIER = `E2E Foshan Works ${stamp}`;
const COST_TEXT = '1,200.00';

async function checkAxe(page: Page, label: string) {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${label} @${w} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}
async function noWhiteLabelLeak(page: Page) {
  const main = page.locator('main:visible');
  await expect(main).not.toContainText(SUPPLIER);
  await expect(main).not.toContainText(/supplier|margin|our cost|factory quote/i);
  await expect(main).not.toContainText(COST_TEXT);
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

test.beforeAll(async () => {
  await assertStagingOrThrow();
  adminA = await createTempStaff('admin');
  client = await createTempCustomer('tk4e2e');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`update profiles set full_name = $2 where id = $1`, [adminA.id, `E2E TK4 Admin ${stamp}`]);
    depositBefore = (await db.query(`select value from site_settings where key = 'turnkey.deposit_pct'`)).rows[0]?.value;
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: client!.id, role: 'authenticated', aal: 'aal1' })]);
    await db.query('set local role authenticated');
    const r = (await db.query(`select tk_submit_enquiry($1, null, $2, 'TR', 'Izmir', null, 150, 3500000, 'A 150 m² gym in Izmir for local members, opening next spring.') r`,
      [client!.orgId, `TK4 E2E gym ${stamp}`])).rows[0].r;
    await db.query('commit');
    code = r.code; projectId = r.id;
  } finally {
    await db.end();
  }
  // Consultation and Design fees (within 2×: active at once) paid by bank transfer, then into Design — the T3 path
  for (const [stage, service, cents] of [['consultation', 'consultation', 9900], ['design', 'layout_drawing', 29900]] as const) {
    await seedPaidTurnkeyFee({ projectId, stage, service, cents, proposer: adminA.id, reference: `E2E-TK4-${stage}-${stamp}` });
    await moveTurnkeyStage(projectId, stage, adminA.id);
  }
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (projectId) {
      const paths = (await db.query(`select file_path from tk_drawing_versions where project_id = $1`, [projectId])).rows.map((r) => r.file_path as string);
      if (paths.length) await adminClient().storage.from('turnkey-drawings').remove(paths); // files go through the Storage API
    }
    if (client) await db.query(`delete from tk_client_projects where org_id = $1`, [client.orgId]); // versions, quotes, costs, fees cascade
    if (depositBefore === undefined) await db.query(`delete from site_settings where key = 'turnkey.deposit_pct'`);
    else await db.query(`update site_settings set value = $1 where key = 'turnkey.deposit_pct'`, [JSON.stringify(depositBefore)]);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]); // proformas (fees, deposit), tax invoices and their lines
  await deleteTempStaff(adminA);
});

test('T4 staff: share layout drawing version 1 (private bucket); axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-staff-drawings')).toContainText('No drawings yet.');
  await expect(page.getByTestId('tk-move-finish')).toContainText('Design is complete when the client approves a drawing version');
  await page.getByTestId('tk-drawing-file').setInputFiles({ name: 'layout-v1.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByTestId('tk-drawing-message').fill('First layout with the reception at the front.');
  await page.getByTestId('tk-drawing-share').click();
  await expect(page.getByTestId('tk-drawing-msg')).toContainText('Version 1 shared');
  await expect(page.getByTestId('tk-staff-drawing-v1')).toContainText('Waiting for the client');
  await expect(page.getByTestId('tk-drawing-blocked')).toContainText('Waiting for the client to review version 1');
  await checkAxe(page, 'staff project (drawings)');
});

test('T4 client: opens version 1 with a signed link and approves it; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const v1 = page.getByTestId('tk-drawing-v1');
  await expect(v1).toContainText('Waiting for your review');
  await expect(page.getByTestId('tk-drawings')).toContainText('3 versions are free');
  const href = await page.getByTestId('tk-drawing-open-v1').getAttribute('href');
  expect(href).toMatch(/\/storage\/v1\/object\/sign\/turnkey-drawings\//); // short signed link, never a public URL
  await expect(page.getByTestId('tk-drawing-next-cost')).toContainText('free');
  await checkAxe(page, 'client project (drawing to review)');
  await page.getByTestId('tk-drawing-approve').click();
  await expect(page.getByTestId('tk-drawing-v1')).toContainText('Approved'); // the page refreshes after the decision
  await expect(page.getByTestId('tk-drawing-review')).toHaveCount(0);
  await expect(page.getByTestId('tk-history')).toContainText('You approved layout drawing version 1');
  await noWhiteLabelLeak(page);
});

test('T4 staff: Sourcing, deposit %, factory quote (staff only), client quote with margin, send; axe', async ({ page }) => {
  await seedPaidTurnkeyFee({ projectId, stage: 'sourcing', service: 'sourcing_quotes', cents: 19900, proposer: adminA!.id, reference: `E2E-TK4-sourcing-${stamp}` });
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-move-finish')).toContainText('the client approved version 1');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');

  // the admin sets the deposit % (settings; the design gives no value)
  await page.goto('/admin/turnkey?tab=services');
  await page.getByTestId('tk-deposit-pct').fill('30');
  await page.getByTestId('tk-deposit-save').click();
  await expect(page.getByTestId('tk-deposit-msg')).toContainText('Deposit set to 30%');
  await checkAxe(page, 'turnkey services + deposit');

  await page.goto(`/admin/turnkey/projects/${code}`);
  await page.getByTestId('tk-factory-supplier').fill(SUPPLIER);
  await page.getByTestId('tk-factory-desc-0').fill('Treadmill T9');
  await page.getByTestId('tk-factory-qty-0').fill('4');
  await page.getByTestId('tk-factory-cost-0').fill('1200');
  await page.getByTestId('tk-factory-save').click();
  await expect(page.getByTestId('tk-factory-msg')).toContainText('Factory quote saved');
  await expect(page.getByTestId('tk-staff-factory-quote')).toContainText(SUPPLIER);

  await page.getByTestId('tk-quote-desc-0').fill('Commercial treadmill');
  await page.getByTestId('tk-quote-qty-0').fill('4');
  await page.getByTestId('tk-quote-price-0').fill('1500');
  await page.getByTestId('tk-quote-source-0').selectOption({ index: 1 });
  await expect(page.getByTestId('tk-quote-margin')).toContainText('US$ 1,200.00'); // 6,000 − 4,800
  await page.getByTestId('tk-quote-message').fill('Delivered to Izmir, installation included.');
  await page.getByTestId('tk-quote-save').click();
  await expect(page.getByTestId('tk-quote-builder-msg')).toContainText('Draft of version 1 saved');
  await expect(page.getByTestId('tk-staff-margin-v1')).toContainText('US$ 1,200.00');
  await page.getByTestId('tk-quote-send').click();
  await expect(page.getByTestId('tk-staff-quote-v1')).toContainText('Sent · waiting for the client');
  await expect(page.getByTestId('tk-staff-quote-v1')).toContainText('30% · US$ 1,800.00');
  await checkAxe(page, 'staff project (quotes)');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');
  await expect(page.getByTestId('tk-move-finish')).toContainText('accepts a quote and pays the deposit');
});

test('T4 client: white-label quote, accept, deposit paid by recorded bank transfer; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const q = page.getByTestId('tk-quote-v1');
  await expect(q).toContainText('Commercial treadmill');
  await expect(page.getByTestId('tk-quote-total-v1')).toHaveText('US$ 6,000.00');
  await expect(page.getByTestId('tk-quote-deposit-v1')).toContainText('30% · US$ 1,800.00');
  await noWhiteLabelLeak(page);
  await checkAxe(page, 'client project (quote)');
  await page.getByTestId('tk-quote-accept').click();
  const dep = page.getByTestId('tk-deposit'); // the page refreshes after the decision
  await expect(q).toContainText('Accepted');
  await expect(dep).toContainText('To pay');
  await expect(dep.getByRole('button', { name: /Pay US\$ 1,800\.00 from wallet/ })).toBeVisible();
  await noWhiteLabelLeak(page);

  const db = pgClient(); await db.connect();
  let doc: { id: string; amount_cents: string } | null = null;
  try {
    await assertStagingDatabase(db);
    doc = (await db.query(`select d.id, d.amount_cents from tk_client_quotes q join documents d on d.id = q.document_id where q.project_id = $1 and q.status = 'accepted'`, [projectId])).rows[0];
  } finally { await db.end(); }
  expect(Number(doc!.amount_cents)).toBe(180000);
  const paid = await recordBankTransfer(doc!.id, 180000, `E2E-TK4-DEP-${stamp}`);
  expect(paid.fully_paid).toBe(true);
  await page.reload();
  await expect(page.getByTestId('tk-deposit')).toContainText('Deposit paid');
  await noWhiteLabelLeak(page);
  await checkAxe(page, 'client project (deposit paid)');
});

test('T4 staff: Quote and deposit can complete', async ({ page }) => {
  await seedPaidTurnkeyFee({ projectId, stage: 'production_qc', service: 'factory_audit', cents: 25000, proposer: adminA!.id, reference: `E2E-TK4-audit-${stamp}` });
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-move-finish')).toContainText('the deposit is paid');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');
  await expect(page.getByTestId('tk-phase-production_qc')).toHaveAttribute('data-state', 'current');
});
