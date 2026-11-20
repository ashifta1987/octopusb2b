import { expect, test, type Page } from '@playwright/test';
import { adminClient, createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
// creates users, commits rows, deletes them and gives document numbers back: refuses unless env + database are staging
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Golden paths 1–2 (SPEC §11.3). STAGING ONLY.
 *  1. New account → email confirmed → profile (onboarding) → KYC submitted with documents.
 *  2. Customer RFQ (fee from wallet) → staff quote → customer approves → PF- proforma (PDF) → Finance records the
 *     deposit → staff confirms the order.
 * Self-contained (20 Nov 2026): it creates its own customers, staff (Operations + Finance, own 2FA) and wallet
 * funding, and removes everything afterwards (purgeTestOrgs gives the document numbers back when they were the newest).
 * It used to skip every case: it needed a shared DEMO_PASSWORD and the demo accounts.
 * The sign-up account is created with the admin API (no confirmation e-mail is sent); the sign-up form itself is
 * covered by tests/e2e/register-flow.mjs.
 */
const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()));
const orgs: string[] = [];
const users: string[] = [];
const kycPaths: string[] = [];
const staff: TempStaff[] = [];

async function guardedDb() {
  await assertStagingOrThrow();
  const db = pgClient(); await db.connect();
  await assertStagingOrThrow(db);
  return db;
}

test.afterAll(async () => {
  const db = await guardedDb();
  try {
    if (kycPaths.length) await adminClient().storage.from('kyc').remove(kycPaths);
    await db.query(`delete from kyc_documents where org_id = any($1)`, [orgs]).catch(() => {});
  } finally { await db.end(); }
  await purgeTestOrgs(orgs, users);
  for (const t of staff) { await t.admin.from('division_members').delete().eq('user_id', t.id); await deleteTempStaff(t); }
});

/** A small valid PDF for the KYC uploads. */
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });

test.describe('Golden path 1 — new account → onboarding → KYC', () => {
  test('a new account completes the profile and submits KYC', async ({ page }) => {
    const admin = adminClient();
    const email = `e2e.golden+${Date.now()}@example.com`;
    const password = `Golden-${Math.random().toString(36).slice(2, 10)}-1!`;
    // sign-up without sending an e-mail: the link is generated, then the address is confirmed as the link would
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'signup', email, password });
    expect(error).toBeNull();
    const uid = link!.user!.id; users.push(uid);
    expect(link!.user!.email_confirmed_at ?? null).toBeNull();
    await admin.auth.admin.updateUserById(uid, { email_confirm: true });

    await customerLogin(page, { id: uid, email, password, orgId: '' }, '/account');
    await page.waitForURL(/\/onboarding/);
    await page.getByLabel('Full name').fill('E2E Golden Buyer');
    await page.getByLabel('Company').fill('E2E Golden Imports BV');
    await page.getByLabel('Country').selectOption('NL');
    await page.getByLabel('City').fill('Rotterdam');
    await page.getByLabel('Phone / WhatsApp').fill('+31 10 000 0001');
    await page.getByLabel('Business type').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL(/\/account(\?|$)/, { timeout: 60_000 });
    const db = await guardedDb();
    try {
      const org = (await db.query(`select org_id from org_members where user_id = $1`, [uid])).rows[0]?.org_id as string;
      expect(org).toBeTruthy(); orgs.push(org);
    } finally { await db.end(); }

    await page.goto('/account/kyc');
    await page.getByLabel(/Legal company name/).fill('E2E Golden Imports BV');
    await page.locator('#kyc-businessType').selectOption({ index: 1 });
    await page.getByLabel(/Company registration number/).fill('NL-KVK-E2E');
    await page.locator('#kyc-country').selectOption('NL');
    await page.getByLabel(/State \/ province \/ region/).fill('Zuid-Holland');
    await page.locator('#kyc-city').fill('Rotterdam');
    await page.getByLabel(/Postal code/).fill('3089 JH');
    await page.getByLabel(/Address line 1/).fill('Waalhaven 1');
    await page.locator('#kyc-contactName').fill('E2E Golden Buyer');
    await page.locator('#kyc-contactEmail').fill(email);
    await page.locator('#kyc-contactPhone').fill('+31 10 000 0001');
    await page.locator('input[type=file]').nth(0).setInputFiles(pdf('registration.pdf'));
    await page.locator('input[type=file]').nth(1).setInputFiles(pdf('tax.pdf'));
    await page.locator('#kyc-consent').check();
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    // the success line can vanish when the page refreshes: check the outcome (status + both documents) instead
    await expect.poll(async () => {
      const db = await guardedDb();
      try { return Number((await db.query(`select count(*) n from kyc_documents where org_id = $1`, [orgs.at(-1)])).rows[0].n); } finally { await db.end(); }
    }, { timeout: 60_000 }).toBe(2);

    const db2 = await guardedDb();
    try {
      const st = (await db2.query(`select kyc_status::text s from organizations where id = $1`, [orgs.at(-1)])).rows[0].s;
      expect(['submitted', 'in_review']).toContain(st);
      const docs = (await db2.query(`select storage_path from kyc_documents where org_id = $1`, [orgs.at(-1)])).rows.map((r) => r.storage_path as string);
      expect(docs.length).toBe(2);
      kycPaths.push(...docs);
    } finally { await db2.end(); }
  });
});

test.describe('Golden path 2 — RFQ → quote → approve → proforma → deposit → confirmed', () => {
  test.describe.configure({ mode: 'serial' });
  let buyer: TempCustomer | null = null;
  let ops: TempStaff | null = null;
  let finance: TempStaff | null = null;
  const rfqTitle = `E2E golden RFQ ${Date.now()}`;
  let rfqId = '';
  let orderId = '';

  test.beforeAll(async () => {
    buyer = await createTempCustomer('golden');
    orgs.push(buyer.orgId); users.push(buyer.id);
    ops = await createTempStaff('operations');
    finance = await createTempStaff('finance');
    // RFQs belong to Product Sourcing (SRC): both staff members work in that division
    const src = (await ops.admin.from('divisions').select('id').eq('code', 'SRC').single()).data!.id as string;
    for (const t of [ops, finance]) {
      const { error } = await ops.admin.from('division_members').insert({ user_id: t.id, division_id: src, role: 'staff' });
      if (error) throw new Error(`division_members: ${error.message}`);
    }
    const db = await guardedDb();
    try {
      await db.query(`update organizations set kyc_status = 'verified', is_seed = true where id = $1`, [buyer.orgId]);
      await db.query('begin');
      await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await db.query(`select post_journal('TEST wallet funding (e2e golden)', jsonb_build_array(jsonb_build_object('account', cash_account('USD'), 'debit', 50000, 'credit', 0),
        jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 50000, 'org', $1::text)), 'test-e2e-golden-' || $1::text, 'topup', 'adjustment', null)`, [buyer.orgId]);
      await db.query('commit');
    } finally { await db.end(); }
  });
  // the staff are deleted in the file-level afterAll, after the orders and quotes that reference them
  test.afterAll(async () => { staff.push(...[ops, finance].filter((t): t is TempStaff => !!t)); });

  async function openRfqAsStaff(page: Page) {
    await staffLogin(page, ops!, `/office/rfqs/${rfqId}`);
    await page.goto(`/office/rfqs/${rfqId}`);
  }

  test('buyer submits an RFQ and pays the fee from the wallet', async ({ page }) => {
    await customerLogin(page, buyer!, '/request/sourcing');
    await page.goto('/request/sourcing');
    await page.locator('#rq-title').fill(rfqTitle);
    await page.locator('#rq-details').fill('Matte black, 300 mm, UV resistant');
    await page.locator('#rq-quantity').fill('1000');
    await page.locator('#rq-destination_country').selectOption('AE');
    await page.getByRole('button', { name: /Pay and submit RFQ|Submit RFQ/ }).click();
    const confirm = page.getByRole('dialog').getByRole('button', { name: /confirm|pay/i });
    if (await confirm.count()) await confirm.first().click();
    await page.waitForURL(/\/account\/sourcing\//, { timeout: 30_000 });
    await expect(page.getByText(rfqTitle).first()).toBeVisible();
    const { data } = await adminClient().from('rfqs').select('id').eq('org_id', buyer!.orgId).eq('title', rfqTitle).single();
    rfqId = data!.id as string;
  });

  test('staff sends a quote', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openRfqAsStaff(page);
    await page.locator('#oq-sup').selectOption({ index: 1 });
    await page.locator('#oq-price').fill('0.61');
    await page.locator('#oq-lead').fill('18');
    await page.getByRole('button', { name: /send quote/i }).click();
    await expect(page.getByText(/QT-\d+/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('buyer approves the quote → PF- proforma issued', async ({ page }) => {
    await customerLogin(page, buyer!, `/account/sourcing/${rfqId}`);
    await page.goto(`/account/sourcing/${rfqId}`);
    await page.getByRole('button', { name: 'Accept quote' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('checkbox').check();
    await dlg.getByRole('button', { name: /Approve & create proforma/ }).click();
    await page.waitForURL(/\/account\/orders\//, { timeout: 30_000 });
    orderId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByText(new RegExp(`PF-${year}-\\d{6}`)).first()).toBeVisible();
    const { data: docs } = await adminClient().from('documents').select('number, doc_type').eq('order_id', orderId);
    expect(docs!.some((d) => new RegExp(`^PF-${year}-\\d{6}$`).test(d.number ?? ''))).toBe(true);
  });

  test('Finance records the deposit and staff confirms the order', async ({ page }) => {
    await staffLogin(page, finance!, `/office/orders/${orderId}`);
    await page.goto(`/office/orders/${orderId}`);
    page.on('dialog', (d) => d.accept());
    await page.locator('#rp-ref').fill('E2E-DEP');
    await page.getByRole('button', { name: 'Record payment' }).click();
    const confirmBtn = page.getByRole('dialog').getByRole('button', { name: /record|confirm/i });
    if (await confirmBtn.count()) await confirmBtn.last().click();
    await expect.poll(async () => (await adminClient().from('orders').select('status').eq('id', orderId).single()).data?.status, { timeout: 20_000 }).toBe('deposit_paid');

    await page.context().clearCookies();
    await staffLogin(page, ops!, `/office/orders/${orderId}`);
    await page.goto(`/office/orders/${orderId}`);
    await page.getByRole('button', { name: '→ Confirmed' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Move' }).click();
    await expect.poll(async () => (await adminClient().from('orders').select('status').eq('id', orderId).single()).data?.status, { timeout: 20_000 }).toBe('confirmed');
  });
});
