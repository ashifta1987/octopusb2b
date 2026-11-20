import { test, expect } from '@playwright/test';
import { adminClient, customerLogin, pgClient, type TempCustomer } from './helpers/customer';
// commits rows, deletes them and gives an invoice number back: refuses unless env + database are staging
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Divisions step 5d (20 Nov 2026) — STAGING ONLY. A customer pays a Make My Brand service proforma from the wallet on
 * Invoices and receipts, double-clicking the button: ONE payment, ONE OCT- tax invoice, the proforma "invoiced".
 * Everything is created for this test and removed afterwards (the invoice number is given back to the counter).
 */
let cust: TempCustomer | null = null;
let pfId = '';
let counterBefore = 0;
let pfBefore = 0;
const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()));

test.beforeAll(async () => {
  await assertStagingOrThrow();      // before connecting: the Supabase URL and the DB connection string are the staging project
  const a = adminClient();
  const db = pgClient(); await db.connect();
  try {
    await assertStagingOrThrow(db);   // …and the connected database is marked staging
    counterBefore = Number((await db.query(`select coalesce((select last_value from document_counters where series = 'OCT' and year = $1), 0) v`, [year])).rows[0].v);
    pfBefore = Number((await db.query(`select coalesce((select last_value from document_counters where series = 'PF' and year = $1), 0) v`, [year])).rows[0].v);
    const org = (await db.query(`insert into organizations(name, country, is_seed) values ('TEST · e2e proforma pay', 'AE', true) returning id`)).rows[0].id as string;
    const email = `e2e.pfpay+${Date.now()}@demo.octopusb2b.com`, password = `E2e-${Math.random().toString(36).slice(2, 10)}-7!`;
    const { data: u } = await a.auth.admin.createUser({ email, password, email_confirm: true });
    await db.query(`insert into profiles(id, full_name, email) values ($1, 'E2E proforma payer', $2) on conflict (id) do nothing`, [u.user!.id, email]);
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, u.user!.id]);
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await db.query(`select post_journal('TEST wallet funding (e2e)', jsonb_build_array(jsonb_build_object('account', cash_account('USD'), 'debit', 50000, 'credit', 0),
      jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 50000, 'org', $1::text)), 'test-e2e-pfpay-' || $1::text, 'topup', 'adjustment', null)`, [org]);
    pfId = (await db.query(`select issue_service_proforma($1, 'brand', 'brand_project', 'MB-E2E-PAY', 'TEST · e2e logo run', '[{"description":"TEST e2e sample","qty":10,"unit_cents":1250,"amount_cents":12500}]'::jsonb, 'USD') id`, [org])).rows[0].id as string;
    await db.query('commit');
    cust = { id: u.user!.id, email, password, orgId: org };
  } finally { await db.end(); }
});

test.afterAll(async () => {
  if (!cust) return;
  await assertStagingOrThrow();
  const db = pgClient(); await db.connect();
  try {
    await assertStagingOrThrow(db);
    await db.query('begin');
    const org = cust.orgId;
    const js = (await db.query(`select id from journals where (ref_type = 'document' and ref_id in (select id from documents where org_id = $1)) or idempotency_key = 'test-e2e-pfpay-' || $1::text`, [org])).rows.map((r) => r.id);
    await db.query(`delete from document_payments where org_id = $1`, [org]);
    await db.query(`delete from ledger_entries where journal_id = any($1)`, [js]);
    await db.query(`delete from journals where id = any($1)`, [js]);
    await db.query(`delete from invoice_lines where document_id in (select id from documents where org_id = $1)`, [org]);
    await db.query(`update documents set from_proforma_id = null where org_id = $1`, [org]);
    await db.query(`delete from documents where org_id = $1`, [org]);
    await db.query(`delete from ledger_accounts where org_id = $1`, [org]);
    await db.query(`delete from org_members where org_id = $1`, [org]);
    await db.query(`delete from organizations where id = $1`, [org]);
    await db.query(`update document_counters set last_value = $2 where series = 'OCT' and year = $1 and last_value = $2 + 1`, [year, counterBefore]);
    await db.query(`update document_counters set last_value = $2 where series = 'PF' and year = $1 and last_value = $2 + 1`, [year, pfBefore]);
    await db.query('commit');
  } finally { await db.end(); }
  await adminClient().auth.admin.deleteUser(cust.id);
});

test('pay a service proforma from the wallet (double click) → one payment, one tax invoice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await customerLogin(page, cust!, '/account/invoices');
  await page.goto('/account/invoices');
  page.on('dialog', (d) => d.accept());
  const btn = page.getByTestId(`pay-${pfId}`);
  await expect(btn).toContainText('Pay US$ 125.00 from wallet');
  await btn.dblclick();
  // the list refreshes after the payment: the pay button goes, the tax invoice row appears
  await expect(page.getByTestId(`pay-${pfId}`)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('tbody')).toContainText(/OCT-MMB-\d{4}-\d{6}/, { timeout: 20_000 });
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/proforma-paid-invoice.png` });
  const a = adminClient();
  const { data: pays } = await a.from('document_payments').select('id, invoice_id').eq('document_id', pfId);
  const { data: invs } = await a.from('documents').select('number, amount_cents').eq('from_proforma_id', pfId);
  const { data: pf } = await a.from('documents').select('status, paid_cents').eq('id', pfId).single();
  expect(pays?.length).toBe(1);
  expect(invs?.length).toBe(1);
  expect(invs![0].number).toMatch(new RegExp(`^OCT-MMB-${year}-\\d{6}$`));
  expect(Number(invs![0].amount_cents)).toBe(12500);
  expect(pf).toMatchObject({ status: 'invoiced' });
  await page.reload();
  await expect(page.getByTestId(`pay-${pfId}`)).toHaveCount(0);                       // nothing left to pay
  await expect(page.locator('tbody')).toContainText(invs![0].number as string);
});
