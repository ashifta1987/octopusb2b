import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { config } from 'dotenv';
// purgeTestOrgs deletes rows and rewinds document counters: staging only
import { assertStagingOrThrow } from '../../../scripts/lib-staging-guard.mjs';

/**
 * Temporary customer for E2E against the live database: auth user (email confirmed) + profile + organisation + membership.
 * purgeTestOrgs() removes everything the test created for those organisations (ledger, orders, documents, requests, quotes,
 * messages, files, notifications, events, audit rows) and deletes the users. Sequences (codes) cannot be rolled back.
 */
config({ path: '.env.local', quiet: true });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export type TempCustomer = { id: string; email: string; password: string; orgId: string };
export const adminClient = (): SupabaseClient => createClient(URL_, SERVICE, { auth: { persistSession: false } });
export const pgClient = () => new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function createTempCustomer(tag: string): Promise<TempCustomer> {
  const admin = adminClient();
  const email = `e2e.buyer.${tag}+${Date.now()}@demo.octopusb2b.com`;
  const password = `E2e-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 1000}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const id = data.user.id;
  await admin.from('profiles').upsert({ id, full_name: `E2E Buyer ${tag}`, email });
  const { data: org, error: oe } = await admin.from('organizations').insert({ name: `E2E Buyer ${tag} LLC`, country: 'AE' }).select('id').single();
  if (oe || !org) throw new Error(`org: ${oe?.message}`);
  const { error: me } = await admin.from('org_members').insert({ org_id: org.id, user_id: id });
  if (me) throw new Error(`member: ${me.message}`);
  return { id, email, password, orgId: org.id as string };
}

export async function customerLogin(page: Page, c: TempCustomer, next = '/account') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  // CH-1: when this browser context is already signed in, the proxy forwards /login to the safe ?next= (or /shop)
  if (!new URL(page.url()).pathname.startsWith('/login')) { await page.context().clearCookies(); await page.goto(`/login?next=${encodeURIComponent(next)}`); }
  const tab = page.getByRole('tab', { name: /log in/i });
  if (await tab.count()) await tab.click();
  await page.getByLabel(/email/i).first().fill(c.email);
  await page.getByLabel(/^password/i).first().fill(c.password);
  // A full suite signs in many times: when the app's own per-network limit answers "Wait N seconds", wait that long
  // and try again (at most 3 tries). Any other error still fails the test.
  for (let attempt = 1; ; attempt++) {
    await page.getByRole('button', { name: /^log in$/i }).click();
    const limited = page.getByText(/Too many attempts from your network\. Wait (\d+) seconds?/);
    const r = await Promise.race([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => 'ok' as const, () => 'timeout' as const),
      limited.waitFor({ timeout: 30_000 }).then(() => 'limited' as const, () => 'timeout' as const),
    ]);
    if (r === 'ok') break;
    if (r === 'timeout') throw new Error('customerLogin: no redirect after signing in');
    if (attempt >= 3) throw new Error('customerLogin: still rate-limited after 3 tries');
    const secs = Number((await limited.innerText()).match(/Wait (\d+)/)?.[1] ?? 30);
    await page.waitForTimeout((secs + 1) * 1000);
    // fresh form, so the old message cannot be mistaken for a new one
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    if (await tab.count()) await tab.click();
    await page.getByLabel(/email/i).first().fill(c.email);
    await page.getByLabel(/^password/i).first().fill(c.password);
  }
  await expect(page).not.toHaveURL(/\/login/);
}

/** Delete everything created for these test organisations (children first), then the users. */
export async function purgeTestOrgs(orgIds: string[], userIds: string[]) {
  if (!orgIds.length && !userIds.length) return;
  await assertStagingOrThrow();
  const db = pgClient(); await db.connect();
  try {
    await assertStagingOrThrow(db);
    // document numbers issued to these organisations (OCT-/CN-/PF-): given back below when they were the newest
    const issued = (await db.query(`select number from documents where org_id = any($1) and number ~ '^(OCT|CN)-[A-Z0-9]+-[0-9]{4}-[0-9]{6}$|^PF-[0-9]{4}-[0-9]{6}$'`, [orgIds])).rows.map((r) => r.number as string);
    const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r) => r.id as string);
    const rfqs = await ids(`select id from rfqs where org_id = any($1)`, [orgIds]);
    const quotes = await ids(`select id from quotes where rfq_id = any($1)`, [rfqs]);
    const orders = await ids(`select id from orders where org_id = any($1)`, [orgIds]);
    const svcs = await ids(`select id from service_requests where org_id = any($1)`, [orgIds]);
    const journals = await ids(`select distinct journal_id id from ledger_entries where org_id = any($1)`, [orgIds]);
    const files = (await db.query(`select storage_path from request_files where rfq_id = any($1) or service_request_id = any($2)`, [rfqs, svcs])).rows.map((r) => r.storage_path as string);
    const all = [...rfqs, ...quotes, ...orders, ...svcs, ...orgIds];
    await db.query('begin');
    await db.query(`update finance_approvals set executed_journal_id = null where executed_journal_id = any($1)`, [journals]).catch(() => {});
    // payment-protection holds point at their hold journal (DS8)
    await db.query(`update escrow_holds set hold_journal_id = null where hold_journal_id = any($1)`, [journals]).catch(() => {});
    await db.query(`delete from ledger_entries where journal_id = any($1)`, [journals]);
    // proforma payments (Turnkey T3 fees, service proformas) point at their journals
    await db.query(`delete from document_payments where journal_id = any($1) or org_id = any($2)`, [journals, orgIds]);
    await db.query(`delete from journals where id = any($1)`, [journals]);
    await db.query(`delete from outbox_events where aggregate_id = any($1) or payload->>'org_id' = any($2)`, [all, orgIds]);
    await db.query(`delete from status_history where entity_id = any($1)`, [all]);
    // audit_log is append-only (ADDON-41): test audit rows stay, like every other audit row
    // every table with an org_id / order_id / rfq_id link, repeated until nothing is left (FK order resolves itself)
    const tables = (await db.query(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'
      and column_name in ('org_id', 'order_id', 'rfq_id', 'quote_id', 'service_request_id') and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
      and table_name not in ('organizations', 'ledger_entries', 'audit_log')`)).rows as { t: string; c: string }[];
    const ref: Record<string, string[]> = { org_id: orgIds, order_id: orders, rfq_id: rfqs, quote_id: quotes, service_request_id: svcs };
    for (let pass = 0; pass < 6; pass++) {
      let left = 0;
      for (const { t, c } of tables) {
        if (!ref[c].length) continue;
        await db.query('savepoint p');
        try { await db.query(`delete from ${t} where ${c} = any($1)`, [ref[c]]); await db.query('release savepoint p'); }
        catch { await db.query('rollback to savepoint p'); left++; }
      }
      for (const [t, list] of [['quotes', quotes], ['orders', orders], ['rfqs', rfqs], ['service_requests', svcs]] as const) {
        if (!list.length) continue;
        await db.query('savepoint p');
        try { await db.query(`delete from ${t} where id = any($1)`, [list]); await db.query('release savepoint p'); }
        catch { await db.query('rollback to savepoint p'); left++; }
      }
      if (!left) break;
    }
    await db.query(`delete from ledger_accounts where org_id = any($1)`, [orgIds]).catch(() => {});
    await db.query(`delete from organizations where id = any($1)`, [orgIds]);
    // give the numbers back only if ours were the newest in that series/year (never leaves a gap, never reuses one)
    const series = new Map<string, number>();
    for (const n of issued) {
      const [, s, y, seq] = n.match(/^(OCT|CN|PF)-(?:[A-Z0-9]+-)?(\d{4})-(\d{6})$/)!;
      const k = `${s}|${y}`; series.set(k, Math.max(series.get(k) ?? 0, Number(seq)));
    }
    for (const [k, ourMax] of series) {
      const [s, y] = k.split('|');
      const like = s === 'PF' ? `PF-${y}-%` : `${s}-%-${y}-%`;
      const left = Number((await db.query(`select coalesce(max(right(number, 6)::int), 0) m from documents where number like $1`, [like])).rows[0].m);
      await db.query(`update document_counters set last_value = $3 where series = $1 and year = $2::int and last_value = $4`, [s, y, left, ourMax]);
    }
    await db.query('commit');
    if (files.length) await adminClient().storage.from('request-files').remove(files);
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
  const admin = adminClient();
  for (const u of userIds) {
    // the stock ledger is append-only and keeps who reserved/moved stock (actor_id): such users are banned, not deleted
    const { count } = await admin.from('warehouse_stock_movements').select('id', { count: 'exact', head: true }).eq('actor_id', u);
    if ((count ?? 0) > 0) await admin.auth.admin.updateUserById(u, { ban_duration: '876000h' });
    else await admin.auth.admin.deleteUser(u);
  }
}

