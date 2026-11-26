import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createTempCustomer, customerLogin, pgClient, purgeTestOrgs, type TempCustomer } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { readAs, recordBankTransfer } from './helpers/turnkey';
import { assertStagingOrThrow, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

/**
 * Turnkey T7 E2E (STAGING ONLY) — design docs/design/turnkey-v2 (staff "Main (Dashboard) … Reports, Alerts, Settings";
 * "Reports shows fees by service, funnel, unpaid ageing and inspector workload"; Terms and Legal; "[THRESHOLD]").
 *  1. A client sends an enquiry; a Turnkey editor sets a fee above 2×; it waits for an admin.
 *  2. Dashboard: the KPIs on the page are the numbers tk_dashboard() counts from real rows (fees waiting, unpaid, …).
 *  3. Another admin approves the fee → the proforma is issued → the client finds "Proforma ready to pay" in the bell and
 *     on the notifications page; the bank transfer is recorded → "Payment received". Opening an alert goes to the project.
 *  4. Reports: the tables render; the fees CSV and the unpaid CSV download with integer cents and match the database.
 *  5. Settings: an admin changes the passport retention and the account manager threshold (then clears it); a Turnkey
 *     editor who is not an admin only sees the values and the database refuses their change.
 *  6. Terms and legal page (owner texts or "provided on request").
 *  axe clean at 1280 px and 390 px on every screen.
 */
test.describe.configure({ mode: 'serial' });
let adminA: TempStaff | null = null;
let adminB: TempStaff | null = null;
let editor: TempStaff | null = null;
let client: TempCustomer | null = null;
let code = '';
let projectId = '';
let feeId = '';
let documentId = '';
let settingsBefore: { key: string; value: unknown }[] = [];
const stamp = Date.now().toString(36);
const SETTING_KEYS = ['turnkey.passport_retention_days', 'turnkey.am_waiver_threshold_cents'];

async function checkAxe(page: Page, label: string) {
  for (const [w, h] of [[1280, 1000], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${label} @${w} axe: ${JSON.stringify(serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 2).map((n) => n.target) })))}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}
async function sql<T = Record<string, unknown>>(q: string, args: unknown[] = []): Promise<T[]> {
  const db = pgClient();
  await db.connect();
  try { await assertStagingDatabase(db); return (await db.query(q, args)).rows as T[]; } finally { await db.end(); }
}
async function asUser<T>(uid: string, aal: 'aal1' | 'aal2', q: string, args: unknown[]): Promise<T> {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
    await db.query('set local role authenticated');
    const r = (await db.query(q, args)).rows[0]?.r as T;
    await db.query('commit');
    return r;
  } catch (e) { await db.query('rollback').catch(() => {}); throw e; } finally { await db.end(); }
}

test.beforeAll(async () => {
  await assertStagingOrThrow();
  adminA = await createTempStaff('admin');
  adminB = await createTempStaff('admin');
  editor = await createTempStaff('sourcing_agent');
  client = await createTempCustomer('tk7e2e');
  settingsBefore = await sql<{ key: string; value: unknown }>(`select key, value from site_settings where key = any($1)`, [SETTING_KEYS]);
  await sql(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff') on conflict do nothing`, [editor.id]);
  await sql(`update profiles set full_name = $2 where id = $1`, [editor.id, `E2E TK7 Editor ${stamp}`]);
  const r = await asUser<{ id: string; code: string }>(client.id, 'aal1',
    `select tk_submit_enquiry($1, null, $2, 'TR', 'Izmir', null, 150, 3500000, 'A 150 m² gym in Izmir for local members, opening next spring.') r`, [client.orgId, `TK7 E2E gym ${stamp}`]);
  code = r.code; projectId = r.id;
  // a Turnkey editor sets the consultation fee above 2× the starting fee (US$ 99) → it waits for an admin
  const f = await asUser<{ id: string; status: string }>(editor.id, 'aal2', `select tk_propose_fee($1, 'consultation', 'consultation', 30000, 'E2E T7') r`, [projectId]);
  expect(f.status).toBe('pending_approval');
  feeId = f.id;
});

test.afterAll(async () => {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    // staff alerts of this test (the client's own go with its company below)
    if (projectId) await db.query(`delete from notifications where dedupe_key like $1 or dedupe_key like $2 or link = $3`, [`tk:enquiry:${projectId}:%`, `tk:fee-approval:${feeId}:%`, `/admin/turnkey/projects/${code}`]);
    if (client) await db.query(`delete from tk_client_projects where org_id = $1`, [client.orgId]);
    for (const k of SETTING_KEYS) {
      const b = settingsBefore.find((x) => x.key === k);
      if (b) await db.query(`update site_settings set value = $2 where key = $1`, [k, JSON.stringify(b.value)]);
      else await db.query(`delete from site_settings where key = $1`, [k]);
    }
    if (editor) await db.query(`delete from division_members where user_id = $1`, [editor.id]);
  } finally {
    await db.end();
  }
  if (client) await purgeTestOrgs([client.orgId], [client.id]); // proformas, payments, the client's notifications
  await deleteTempStaff(editor);
  await deleteTempStaff(adminB);
  await deleteTempStaff(adminA);
});

test('T7 alerts: the fee waiting for approval reaches the admins (not the proposer)', async () => {
  const rows = await sql<{ user_id: string; link: string }>(`select user_id, link from notifications where dedupe_key like $1`, [`tk:fee-approval:${feeId}:%`]);
  expect(rows.some((r) => r.user_id === adminA!.id)).toBe(true);
  expect(rows.some((r) => r.user_id === adminB!.id)).toBe(true);
  expect(rows.some((r) => r.user_id === editor!.id)).toBe(false);
  expect(rows.every((r) => r.link === '/admin/turnkey/approvals')).toBe(true);
  const enq = await sql<{ user_id: string }>(`select user_id from notifications where dedupe_key like $1`, [`tk:enquiry:${projectId}:%`]);
  expect(enq.some((r) => r.user_id === editor!.id)).toBe(true); // the TK division's Turnkey editor hears about the enquiry
});

test('T7 dashboard: KPIs from real rows; axe', async ({ page }) => {
  await staffLogin(page, adminA!, '/admin/turnkey');
  await page.goto('/admin/turnkey');
  await expect(page.getByTestId('tk-kpis')).toBeVisible();
  const d = await readAs<{ kpi: { waiting_approvals: number; unpaid_count: number; open_total: number; open_by_stage: Record<string, number> } }>(adminA!.id, 'aal2', `select tk_dashboard() r`);
  expect(d.kpi.waiting_approvals).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('tk-kpi-approvals')).toContainText(String(d.kpi.waiting_approvals));
  await expect(page.getByTestId('tk-kpi-unpaid')).toContainText(String(d.kpi.unpaid_count));
  await expect(page.getByTestId('tk-kpi-open')).toContainText(String(d.kpi.open_total));
  await expect(page.getByTestId('tk-dash-phase-enquiry')).toContainText(String(d.kpi.open_by_stage.enquiry ?? 0));
  await expect(page.getByTestId('tk-staff-nav')).toContainText('Reports');
  await checkAxe(page, 'staff dashboard');
  await page.getByTestId('tk-nav-catalogue').click();
  await expect(page).toHaveURL(/tab=catalogue/);
});

test('T7 client: notification when the approved fee is issued, and when it is paid; axe', async ({ page }) => {
  // another admin (not the proposer) approves → the proforma is issued
  const dec = await asUser<{ document_id: string }>(adminB!.id, 'aal2', `select tk_decide_fee($1, 'approve', null) r`, [feeId]);
  documentId = dec.document_id;
  await customerLogin(page, client!, '/account/notifications');
  await page.goto('/account/notifications');
  const issued = page.getByTestId('notification').filter({ hasText: `Proforma ready to pay · ${code}` });
  await expect(issued).toHaveCount(1);
  await expect(issued).toContainText('Consultation: US$ 300.00');
  await checkAxe(page, 'client notifications');
  await recordBankTransfer(documentId, 30000, `E2E-TK7-${stamp}`);
  await page.reload();
  await expect(page.getByTestId('notification').filter({ hasText: `Payment received · ${code}` })).toHaveCount(1);
  await issued.click();
  await expect(page).toHaveURL(new RegExp(`/account/turnkey/${code}$`));
});

test('T7 reports: tables and CSV downloads match the database; axe', async ({ page }) => {
  // an unpaid proforma for the unpaid list: the design fee within 2× (active at once)
  await asUser(editor!.id, 'aal2', `select tk_propose_fee($1, 'design', 'layout_drawing', 29900, null) r`, [projectId]);
  await staffLogin(page, adminA!, '/admin/turnkey/reports?months=1');
  await page.goto('/admin/turnkey/reports?months=1');
  await expect(page.getByTestId('tk-fee-consultation')).toBeVisible();
  await expect(page.getByTestId('tk-ageing')).toContainText('0–30 days');
  await expect(page.getByTestId(`tk-unpaid-${code}`)).toContainText('US$ 299.00');
  await checkAxe(page, 'turnkey reports');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tk-csv-fees').click()]);
  expect(dl.suggestedFilename()).toMatch(/^turnkey-fees-1m-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = fs.readFileSync((await dl.path())!, 'utf8').trim().split(/\r?\n/);
  expect(csv[0]).toBe('month,service_code,service,issued_count,issued_cents,paid_cents,outstanding_cents,void_count');
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const rows = await readAs<{ service_key: string; issued_cents: string; paid_cents: string }[]>(adminA!.id, 'aal2',
    `select coalesce(jsonb_agg(to_jsonb(x)), '[]') r from tk_report_fees_by_service($1, null, false) x`, [from]);
  const cons = rows.find((r) => r.service_key === 'consultation')!;
  const line = csv.find((l) => l.split(',')[1] === 'consultation')!;
  expect(line.split(',')[4]).toBe(String(cons.issued_cents));
  expect(line.split(',')[5]).toBe(String(cons.paid_cents));
  expect(Number(line.split(',')[5])).toBeGreaterThanOrEqual(30000);

  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tk-csv-unpaid').click()]);
  const unpaid = fs.readFileSync((await dl2.path())!, 'utf8');
  expect(unpaid.split(/\r?\n/)[0]).toBe('proforma,project,client,service,amount_cents,paid_cents,outstanding_cents,issued_on,age_days');
  expect(unpaid).toMatch(new RegExp(`${code},[^\\n]*Layout drawing,29900,0,29900,`));
});

test('T7 settings: an admin changes them (audited); a Turnkey editor cannot; axe', async ({ page, browser }) => {
  await staffLogin(page, adminA!, '/admin/turnkey/settings');
  await page.goto('/admin/turnkey/settings');
  await expect(page.getByTestId('tk-settings-threshold')).toContainText('Not set yet');
  await checkAxe(page, 'turnkey settings (admin)');
  await page.getByTestId('tk-set-retention-input').fill('45');
  await page.getByTestId('tk-set-retention-save').click();
  await expect(page.getByTestId('tk-set-retention-msg')).toContainText('kept 45 days');
  await page.getByTestId('tk-set-threshold-input').fill('50000');
  await page.getByTestId('tk-set-threshold-save').click();
  await expect(page.getByTestId('tk-set-threshold-msg')).toContainText('US$ 50,000.00');
  await page.reload();
  await expect(page.getByTestId('tk-settings-changes')).toContainText('Passport copies kept');
  await expect(page.getByTestId('tk-settings-changes')).toContainText('Account manager fee waived above: not set → US$ 50,000.00');
  await page.getByTestId('tk-set-threshold-input').fill('');
  await page.getByTestId('tk-set-threshold-save').click();
  await expect(page.getByTestId('tk-set-threshold-msg')).toContainText('not set');
  const audit = await sql(`select 1 from audit_log where action = 'turnkey.setting' and actor_id = $1`, [adminA!.id]);
  expect(audit.length).toBe(3);
  const pub = await sql<{ is_public: boolean }>(`select is_public from site_settings where key = any($1)`, [SETTING_KEYS]);
  expect(pub.every((r) => r.is_public === false)).toBe(true);

  // a Turnkey editor (not an admin) sees the values but no form, and the database refuses the change
  const ctx = await browser.newContext();
  const ep = await ctx.newPage();
  await staffLogin(ep, editor!, '/admin/turnkey/settings');
  await ep.goto('/admin/turnkey/settings');
  await expect(ep.getByTestId('tk-settings-retention')).toContainText('45 days');
  await expect(ep.getByTestId('tk-set-retention-input')).toHaveCount(0);
  await expect(ep.getByTestId('tk-nav-settings')).toHaveCount(0);
  await checkAxe(ep, 'turnkey settings (read-only)');
  await ctx.close();
  await expect(asUser(editor!.id, 'aal2', `select tk_set_passport_retention_days(10) r`, [])).rejects.toThrow(/FORBIDDEN/);
});

test('T7 terms and legal page; axe', async ({ page }) => {
  await page.goto('/turnkey/terms');
  for (const id of ['china-visit', 'privacy', 'independence', 'passport']) await expect(page.getByTestId(`tk-terms-${id}`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms and legal');
  await checkAxe(page, 'turnkey terms');
  await page.goto('/turnkey');
  await expect(page.getByTestId('tk-terms-link')).toHaveAttribute('href', '/turnkey/terms');
});
