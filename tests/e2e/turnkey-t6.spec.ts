import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { advanceTurnkeyToProductionQc, passPreShipmentInspection, readAs, recordBankTransfer } from './helpers/turnkey';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Turnkey T6 E2E (STAGING ONLY) — design docs/design/turnkey-v2 ("7. Shipment: booking, tracking and shipping documents";
 * "8. Handover: final documents, sign-off and optional China visit"; Visit China from $399 per day for up to 2 people,
 * extra traveller $99 per day, extras; secure passport upload; supplier details hidden).
 *  1. Staff issue the balance (quote total − deposit); moving to Shipment is refused until it is paid. The client sees the
 *     balance with Pay; Finance records the bank transfer; staff move to Shipment.
 *  2. Staff book a sea shipment, add a tracking event, upload a bill of lading (shared) and a packing list (draft). The
 *     client sees the carrier, status, event and the shared document through a signed link — never the draft or notes.
 *  3. The client asks for a China visit (3 days, 3 travellers, extras): the estimate is priced from the services list;
 *     staff set the fee (list price, within 2×); Finance records the transfer; staff confirm the itinerary.
 *  4. The client uploads a passport copy to the private bucket: the client and a Turnkey editor can open it; another
 *     company and view-only finance staff cannot. Then the trip is closed and the passport deleted on request.
 *  5. Delivered → Handover; staff add the checklist and share the warranty; the client signs with the typed name → the
 *     project is completed; staff controls no longer offer any status.
 *  axe clean at 1280 px and 390 px on every screen.
 */
test.describe.configure({ mode: 'serial' });
let adminA: TempStaff | null = null;
let inspector: TempStaff | null = null;
let finance: TempStaff | null = null;
let client: TempCustomer | null = null;
let other: TempCustomer | null = null;
let code = '';
let projectId = '';
let depositBefore: unknown = undefined;
let drawingPaths: string[] = [];
const stamp = Date.now().toString(36);
const FACTORY = `E2E Foshan Steelworks ${stamp}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function checkAxe(page: Page, label: string) {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${label} @${w} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}
async function noLeak(page: Page) {
  const main = page.locator('main:visible');
  await expect(main).not.toContainText(FACTORY);
  await expect(main).not.toContainText(/steelworks|forwarder rate|staff only|guide: /i);
}
async function sql<T = Record<string, unknown>>(q: string, args: unknown[] = []): Promise<T[]> {
  const db = pgClient();
  await db.connect();
  try { await assertStagingDatabase(db); return (await db.query(q, args)).rows as T[]; } finally { await db.end(); }
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  adminA = await createTempStaff('admin');
  inspector = await createTempStaff('qc_coordinator');
  finance = await createTempStaff('finance');
  client = await createTempCustomer('tk6e2e');
  other = await createTempCustomer('tk6other');
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query(`update profiles set full_name = $2 where id = $1`, [adminA.id, `E2E TK6 Admin ${stamp}`]);
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: client!.id, role: 'authenticated', aal: 'aal1' })]);
    await db.query('set local role authenticated');
    const r = (await db.query(`select tk_submit_enquiry($1, null, $2, 'TR', 'Izmir', null, 150, 3500000, 'A 150 m² gym in Izmir for local members, opening next spring.') r`,
      [client!.orgId, `TK6 E2E gym ${stamp}`])).rows[0].r;
    await db.query('commit');
    code = r.code; projectId = r.id;
  } finally {
    await db.end();
  }
  // every earlier gate through the real functions; the balance is left to this test
  const a = await advanceTurnkeyToProductionQc({ projectId, staff: adminA.id, customer: client.id, stamp, balance: 'none' });
  depositBefore = a.depositBefore; drawingPaths = a.drawingPaths;
  await passPreShipmentInspection({ projectId, staff: adminA.id, inspector: inspector.id, stamp, factory: FACTORY });
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    if (projectId) {
      const docs = (await db.query(`select file_path from tk_project_documents where project_id = $1`, [projectId])).rows.map((r) => r.file_path as string);
      const pass = (await db.query(`select file_path from tk_trip_travellers where project_id = $1`, [projectId])).rows.map((r) => r.file_path as string);
      const photos = (await db.query(`select file_path from tk_inspection_photos where project_id = $1`, [projectId])).rows.map((r) => r.file_path as string);
      const orphanPass = (await adminClient().storage.from('turnkey-passports').list(projectId)).data ?? [];
      if (docs.length) await adminClient().storage.from('turnkey-documents').remove(docs); // files go through the Storage API
      if (pass.length) await adminClient().storage.from('turnkey-passports').remove(pass);
      for (const f of orphanPass) {
        const inner = (await adminClient().storage.from('turnkey-passports').list(`${projectId}/${f.name}`)).data ?? [];
        if (inner.length) await adminClient().storage.from('turnkey-passports').remove(inner.map((x) => `${projectId}/${f.name}/${x.name}`));
      }
      if (photos.length) await adminClient().storage.from('turnkey-inspections').remove(photos);
      if (drawingPaths.length) await adminClient().storage.from('turnkey-drawings').remove(drawingPaths);
    }
    if (client) await db.query(`delete from tk_client_projects where org_id = $1`, [client.orgId]); // shipments, documents, trips, passports, sign-off cascade
    if (depositBefore === undefined) await db.query(`delete from site_settings where key = 'turnkey.deposit_pct'`);
    else await db.query(`update site_settings set value = $1 where key = 'turnkey.deposit_pct'`, [JSON.stringify(depositBefore)]);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId, ...(other ? [other.orgId] : [])], [client.id, ...(other ? [other.id] : [])]); // proformas (fees, deposit, balance, inspection, trip)
  await deleteTempStaff(finance);
  await deleteTempStaff(inspector);
  await deleteTempStaff(adminA);
});

test('T6 staff: issue the balance; Shipment waits until it is paid; axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-balance-gate')).toContainText('issue the balance invoice');
  await expect(page.getByTestId('tk-move-finish')).toContainText('passed and the report is published');
  await page.getByTestId('tk-balance-issue').click();
  await expect(page.getByTestId('tk-balance-msg')).toContainText('Balance invoice issued');
  await expect(page.getByTestId('tk-staff-balance-state')).toContainText('awaiting payment');
  await expect(page.getByTestId('tk-balance-gate')).toContainText('paid the balance in full');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText(/balance/i);
  await expect(page.getByTestId('tk-phase-production_qc')).toHaveAttribute('data-state', 'current');
  await checkAxe(page, 'staff project (balance issued)');
});

test('T6 client: the balance with Pay; Finance records the bank transfer; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const box = page.getByTestId('tk-balance');
  await expect(page.getByTestId('tk-balance-amount')).toHaveText('US$ 2,100.00'); // US$ 3,000 quote − 30% deposit
  await expect(box).toContainText('To pay');
  await checkAxe(page, 'client project (balance due)');
  const [b] = await sql<{ document_id: string; amount_cents: string }>(`select document_id, amount_cents from tk_quote_balances where project_id = $1`, [projectId]);
  const r = await recordBankTransfer(b.document_id, Number(b.amount_cents), `E2E-TK6-BAL-${stamp}`);
  expect(r.fully_paid).toBe(true);
  await page.reload();
  await expect(page.getByTestId('tk-balance')).toContainText('Balance paid');
});

test('T6 staff: Shipment — book, track, upload and share a document (draft stays hidden); axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-balance-gate')).toContainText('The balance is paid');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-staff-msg')).toContainText('Phase changed');
  await expect(page.getByTestId('tk-phase-shipment')).toHaveAttribute('data-state', 'current');
  await page.getByTestId('tk-sh-carrier').fill('COSCO Shipping');
  await page.getByTestId('tk-sh-bookingRef').fill(`BK-${stamp}`);
  await page.getByTestId('tk-sh-containerNo').fill('mscu1234567');
  await page.getByTestId('tk-sh-origin').fill('Shenzhen (Yantian)');
  await page.getByTestId('tk-sh-destination').fill('Izmir (Alsancak)');
  await page.getByTestId('tk-sh-etd').fill(day(0));
  await page.getByTestId('tk-sh-eta').fill(day(30));
  await page.getByLabel(/Staff note/).fill('Forwarder rate US$ 2,350');
  await page.getByTestId('tk-sh-save').click();
  await expect(page.getByTestId('tk-shipment-create-msg')).toContainText('Shipment booked');
  const sh = page.getByTestId('tk-staff-shipment-1');
  await expect(sh).toContainText('MSCU1234567');
  await page.getByTestId('tk-event-status-1').selectOption('in_transit');
  await page.getByTestId('tk-event-location-1').fill('Yantian port');
  await page.getByTestId('tk-event-desc-1').fill('Loaded on the vessel');
  await page.getByTestId('tk-event-save-1').click();
  await expect(page.getByTestId('tk-event-msg-1')).toContainText('Tracking event added');
  await expect(sh).toContainText('In transit');
  // bill of lading → shared; packing list → stays a draft
  await page.getByTestId('tk-doc-shipment-kind').selectOption('bill_of_lading');
  await page.getByTestId('tk-doc-shipment-file').setInputFiles({ name: 'bill-of-lading.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByTestId('tk-doc-shipment-save').click();
  await expect(page.getByTestId('tk-doc-shipment-msg')).toContainText('draft');
  await page.locator('[data-testid^="tk-doc-release-bill_of_lading"]').first().click();
  await expect(page.getByTestId('tk-staff-doc-bill_of_lading').first()).toContainText('Shared with the client');
  await page.getByTestId('tk-doc-shipment-kind').selectOption('packing_list');
  await page.getByTestId('tk-doc-shipment-file').setInputFiles({ name: 'packing-list.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByTestId('tk-doc-shipment-save').click();
  await expect(page.getByTestId('tk-staff-doc-packing_list')).toContainText('Draft');
  await checkAxe(page, 'staff project (shipment)');
});

test('T6 client: tracking and the shared document by signed link — no draft, no staff note; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  const sh = page.getByTestId('tk-shipment-1');
  await expect(sh).toContainText('COSCO Shipping');
  await expect(sh).toContainText('MSCU1234567');
  await expect(page.getByTestId('tk-shipment-status-1')).toContainText('In transit');
  await expect(page.getByTestId('tk-shipment-events-1')).toContainText('Loaded on the vessel (Yantian port)');
  const href = await page.getByTestId('tk-doc-open-bill_of_lading').getAttribute('href');
  expect(href).toMatch(/\/storage\/v1\/object\/sign\/turnkey-documents\//); // short signed link, never a public URL
  await expect(page.getByTestId('tk-shipment-docs-1')).not.toContainText('Packing list');
  await expect(page.locator('main:visible')).not.toContainText('2,350');
  await noLeak(page);
  await checkAxe(page, 'client project (shipment)');
});

test('T6 client: China visit request priced from the services list; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  await page.getByTestId('tk-trip-start').fill(day(40));
  await page.getByTestId('tk-trip-end').fill(day(42));
  await page.getByTestId('tk-trip-travellers').fill('3');
  await page.getByTestId('tk-trip-visa').fill('3');
  await page.getByTestId('tk-trip-car').fill('2');
  await page.getByTestId('tk-trip-pickups').fill('1');
  await page.getByTestId('tk-trip-hotel').check();
  // 3 × 399 + 3 days × 1 extra traveller × 99 + 3 × 49 + 2 × 100 + 39 + hotel help free = 1,880
  await expect(page.getByTestId('tk-trip-estimate-total')).toHaveText('US$ 1,880.00');
  await checkAxe(page, 'client project (trip request form)');
  await page.getByTestId('tk-trip-submit').click();
  await expect(page.getByTestId('tk-trip-request-msg')).toContainText('Request sent');
  await expect(page.getByTestId('tk-trip-list-1')).toHaveText('US$ 1,880.00');
  await expect(page.getByTestId('tk-trip-status-1')).toContainText('Requested');
});

test('T6 staff: trip fee (list price, within 2×); paid; itinerary confirmed; axe', async ({ page }) => {
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await expect(page.getByTestId('tk-staff-trip-list-1')).toContainText('US$ 1,880.00');
  await expect(page.getByTestId('tk-trip-fee-amount-1')).toHaveValue('1880');
  await expect(page.getByTestId('tk-trip-fee-rule-1')).toContainText('Active at once');
  await page.getByTestId('tk-trip-fee-save-1').click();
  await expect(page.getByTestId('tk-trip-fee-msg-1')).toContainText('active now');
  await expect(page.getByTestId('tk-trip-confirm-blocked-1')).toContainText('after the client pays');
  const [f] = await sql<{ document_id: string }>(`select f.document_id from tk_trip_fees f join tk_trips t on t.id = f.trip_id where t.project_id = $1 and f.status = 'active'`, [projectId]);
  await recordBankTransfer(f.document_id, 188000, `E2E-TK6-TRIP-${stamp}`);
  await page.reload();
  await expect(page.getByTestId('tk-staff-trip-fee-1')).toContainText('paid');
  await page.getByTestId('tk-trip-itinerary-1').fill('Day 1: Guangzhou showroom. Day 2: two factory visits in Foshan. Day 3: QC office and wrap-up.');
  await page.getByLabel(/Guide \(staff only\)/).fill('Lily Chen');
  await page.getByTestId('tk-trip-confirm-save-1').click();
  await expect(page.getByTestId('tk-trip-confirm-msg-1')).toContainText('itinerary');
  await checkAxe(page, 'staff project (trip confirmed)');
});

test('T6 client: passport copy to the private bucket — client and Turnkey editor only; delete on request; axe', async ({ page }) => {
  await customerLogin(page, client!, `/account/turnkey/${code}`);
  await page.goto(`/account/turnkey/${code}`);
  await expect(page.getByTestId('tk-trip-status-1')).toContainText('Confirmed');
  await expect(page.getByTestId('tk-trip-itinerary-1')).toContainText('Day 2');
  await expect(page.locator('main:visible')).not.toContainText('Lily Chen'); // guide is staff-only
  await page.getByTestId('tk-passport-name-1').fill('Ayse Yilmaz');
  await page.getByTestId('tk-passport-file-1').setInputFiles({ name: 'passport.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('tk-passport-save-1').click();
  await expect(page.getByTestId('tk-passport-msg-1')).toContainText('Passport copy saved');
  const href = await page.getByTestId('tk-passport-open-1').getAttribute('href');
  expect(href).toMatch(/\/storage\/v1\/object\/sign\/turnkey-passports\//);
  await checkAxe(page, 'client project (passport uploaded)');
  // who can see it (as PostgREST would, through JWT claims): the client and a Turnkey editor — not another company, not finance
  const [t] = await sql<{ file_path: string }>(`select file_path from tk_trip_travellers where project_id = $1`, [projectId]);
  const sees = (uid: string, aal: 'aal1' | 'aal2') => readAs<number>(uid, aal, `select ((select count(*) from tk_trip_travellers where project_id = $1) + (select count(*) from storage.objects where bucket_id = 'turnkey-passports' and name = $2))::int r`, [projectId, t.file_path]);
  expect(await sees(client!.id, 'aal1')).toBe(2);
  expect(await sees(adminA!.id, 'aal2')).toBe(2);
  expect(await sees(other!.id, 'aal1')).toBe(0);
  expect(await sees(finance!.id, 'aal2')).toBe(0);
  // the staff page shows the copy to the editor
  // a separate browser context, so the staff sign-in doesn't replace the client's session cookie
  const staffCtx = await page.context().browser()!.newContext();
  const staffPage = await staffCtx.newPage();
  await staffLogin(staffPage, adminA!, `/admin/turnkey/projects/${code}`);
  await staffPage.goto(`/admin/turnkey/projects/${code}`);
  await expect(staffPage.getByTestId('tk-staff-passports-1')).toContainText('Ayse Yilmaz');
  await staffCtx.close();
  // delete on request (the record, then the file)
  await page.getByTestId('tk-passport-delete-1').click();
  await expect(page.getByTestId('tk-passport-form-1')).toBeVisible();
  expect((await sql(`select 1 from tk_trip_travellers where project_id = $1`, [projectId])).length).toBe(0);
  expect((await adminClient().storage.from('turnkey-passports').list(t.file_path.split('/').slice(0, 2).join('/'))).data?.length ?? 0).toBe(0);
});

test('T6 staff + client: delivered → Handover; checklist and warranty; client signs → completed; axe', async ({ page, browser }) => {
  // the confirmed visit is closed by staff first (sign-off waits for open visits); its start is in the future, so the
  // set-up records it the way tk_complete_trip would after the visit (rolled into the test data, removed in afterAll)
  await sql(`update tk_trips set status = 'completed', completed_at = now(), updated_at = now() where project_id = $1 and status = 'confirmed'`, [projectId]);
  await staffLogin(page, adminA!, `/admin/turnkey/projects/${code}`);
  await page.goto(`/admin/turnkey/projects/${code}`);
  await page.getByTestId('tk-event-status-1').selectOption('delivered');
  await page.getByTestId('tk-event-desc-1').fill('Delivered to the site and signed for');
  await page.getByTestId('tk-event-save-1').click();
  await expect(page.getByTestId('tk-staff-shipment-1')).toContainText('Delivered');
  await expect(page.getByTestId('tk-move-finish')).toContainText('Every shipment is delivered');
  await page.getByTestId('tk-move-next').click();
  await expect(page.getByTestId('tk-phase-handover')).toHaveAttribute('data-state', 'current');
  await page.getByTestId('tk-ho-label').fill('Warranty certificates');
  await page.getByTestId('tk-ho-add-save').click();
  await expect(page.getByTestId('tk-staff-ho-item-1')).toContainText('Not ready');
  await page.getByTestId('tk-doc-handover-kind').selectOption('warranty');
  await page.getByTestId('tk-doc-handover-file').setInputFiles({ name: 'warranty.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByTestId('tk-doc-handover-save').click();
  await page.locator('[data-testid^="tk-doc-release-warranty"]').first().click();
  await expect(page.getByTestId('tk-staff-doc-warranty')).toContainText('Shared with the client');
  await page.getByTestId('tk-ho-doc-1').selectOption({ label: 'Warranty' });
  await page.getByTestId('tk-ho-done-1').click();
  await expect(page.getByTestId('tk-staff-ho-item-1')).toContainText('Ready');
  await checkAxe(page, 'staff project (handover ready)');

  const ctx = await browser.newContext();
  const cp = await ctx.newPage();
  await customerLogin(cp, client!, `/account/turnkey/${code}`);
  await cp.goto(`/account/turnkey/${code}`);
  await expect(cp.getByTestId('tk-handover-ready')).toContainText('Everything is ready');
  await expect(cp.getByTestId('tk-handover-item-1')).toContainText('Warranty certificates');
  await checkAxe(cp, 'client project (handover sign-off)');
  await cp.getByTestId('tk-handover-agree').check();
  await cp.getByTestId('tk-handover-name').fill('Ayse Yilmaz');
  await cp.getByTestId('tk-handover-submit').click();
  await expect(cp.getByTestId('tk-handover-sign-msg')).toContainText('Handover signed');
  await expect(cp.getByTestId('tk-handover-signed')).toContainText('Signed by Ayse Yilmaz');
  await expect(cp.locator('main:visible')).toContainText('This project is completed');
  await noLeak(cp);
  await checkAxe(cp, 'client project (completed)');
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId('tk-staff-signoff')).toContainText('Signed by Ayse Yilmaz');
  await expect(page.getByTestId('tk-status-select')).toHaveCount(0); // completed: no reopen, no status change
  const [p] = await sql<{ status: string }>(`select status from tk_client_projects where id = $1`, [projectId]);
  expect(p.status).toBe('completed');
  const audit = await sql(`select 1 from audit_log where action = 'turnkey.handover_signed' and entity_id = $1`, [projectId]);
  expect(audit.length).toBe(1);
  const ledger = await sql<{ d: string; c: string }>(`select coalesce(sum(debit_cents),0)::text d, coalesce(sum(credit_cents),0)::text c from ledger_entries`);
  expect(ledger[0].d).toBe(ledger[0].c);
});
