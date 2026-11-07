import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { config } from 'dotenv';

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
  const tab = page.getByRole('tab', { name: /log in/i });
  if (await tab.count()) await tab.click();
  await page.getByLabel(/email/i).first().fill(c.email);
  await page.getByLabel(/^password/i).first().fill(c.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
}

/** Delete everything created for these test organisations (children first), then the users. */
export async function purgeTestOrgs(orgIds: string[], userIds: string[]) {
  if (!orgIds.length && !userIds.length) return;
  const db = pgClient(); await db.connect();
  try {
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
    await db.query(`delete from ledger_entries where journal_id = any($1)`, [journals]);
    await db.query(`delete from journals where id = any($1)`, [journals]);
    await db.query(`delete from outbox_events where aggregate_id = any($1) or payload->>'org_id' = any($2)`, [all, orgIds]);
    await db.query(`delete from status_history where entity_id = any($1)`, [all]);
    await db.query(`delete from audit_log where entity_id = any($1)`, [all.map(String)]);
    // every table with an org_id / order_id / rfq_id link, repeated until nothing is left (FK order resolves itself)
    const tables = (await db.query(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'
      and column_name in ('org_id', 'order_id', 'rfq_id', 'quote_id', 'service_request_id') and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
      and table_name not in ('organizations', 'ledger_entries')`)).rows as { t: string; c: string }[];
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
    await db.query('commit');
    if (files.length) await adminClient().storage.from('request-files').remove(files);
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
  const admin = adminClient();
  for (const u of userIds) await admin.auth.admin.deleteUser(u);
}

