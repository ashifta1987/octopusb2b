// Customer-safe reads, over the real API (STAGING ONLY). Signs in for real as a temporary customer (email + password
// through Supabase Auth with the public key), then calls the REST API directly — the same requests anyone with the
// public key could make from a browser or curl — and proves that none of the hidden columns can be read:
//  · with the public key only (logged out)
//  · with the signed-in customer's token
// It also checks the customer still gets their own rows through the allowed columns, and that the views that replace
// the supplier identity / pool participants / ads give nothing internal.
// The temporary customer is deleted at the end (also on failure).
// Run: node tests/api/customer-columns.api.mjs
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'node:crypto';
import { loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
import { HIDDEN_COLUMNS } from '../../scripts/hidden-columns.mjs';

loadStagingEnvOrExit();                                 // stops unless the Supabase URL + database are the staging project
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const rest = async (path, token, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  let body = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
};
const refused = (r) => r.status >= 400 && (r.body?.code === '42501' || /permission denied/i.test(r.body?.message ?? ''));

const email = `api-cols-${crypto.randomBytes(4).toString('hex')}@demo.octopusb2b.com`;
const password = crypto.randomBytes(18).toString('base64url');
let uid = null;
try {
  const org = (await db.query(`select id from organizations where name = 'TEST DATA · Divisions'`)).rows[0]?.id;
  if (!org) throw new Error('staging test data missing — run scripts/seed-division-test-data.mjs');
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw ce;
  uid = created.user.id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, 'TEST · API column check', $2) on conflict (id) do update set full_name = excluded.full_name`, [uid, email]);
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  ok(!se && !!s?.session?.access_token, `signed in as a customer through Supabase Auth with the public key (${se?.message ?? 'ok'})`);
  const token = s.session.access_token;

  const total = Object.values(HIDDEN_COLUMNS).flat().length;
  for (const [who, tok] of [['public key (logged out)', null], ['signed-in customer', token]]) {
    const leaks = [];
    for (const [t, cols] of Object.entries(HIDDEN_COLUMNS)) for (const c of cols) {
      const r = await rest(`${t}?select=${c}&limit=1`, tok);
      if (!refused(r)) leaks.push(`${t}.${c} (${r.status})`);
      const f = await rest(`${t}?select=id&${c}=not.is.null&limit=1`, tok);          // filtering on it must be refused too
      if (f.status < 400 && Array.isArray(f.body) && f.body.length && !refused(f)) leaks.push(`${t}.${c} via filter`);
    }
    ok(leaks.length === 0, `API, ${who}: all ${total} hidden columns refused (select and filter)${leaks.length ? ' — READABLE: ' + leaks.join(', ') : ''}`);
    ok(refused(await rest('products?select=*&limit=1', tok)), `API, ${who}: products?select=* refused`);
    for (const v of ['public_suppliers', 'product_images']) ok(refused(await rest(`${v}?select=*&limit=1`, tok)), `API, ${who}: ${v} refused`);
    for (const t of ['carriers', 'roles', 'permission_areas', 'sla_policies', 'role_permissions', 'suppliers', 'supplier_contacts', 'product_costs']) {
      const r = await rest(`${t}?select=*&limit=5`, tok);
      ok(refused(r) || (Array.isArray(r.body) && r.body.length === 0), `API, ${who}: ${t} — nothing (${r.status}, ${Array.isArray(r.body) ? r.body.length + ' rows' : r.body?.code})`);
    }
    const pf = await rest('product_factory?select=*&limit=2', tok);
    ok(pf.status === 200 && pf.body.length > 0 && Object.keys(pf.body[0]).join(',') === 'product_id,verified,country,province', `API, ${who}: product_factory → verified + country + province only`);
    const ads = await rest('public_ads?select=*&limit=1', tok);
    ok(ads.status === 200 && !Object.keys(ads.body[0] ?? {}).some((k) => /budget|cpc|spent|org|supplier|created/.test(k)), `API, ${who}: public_ads has no budgets / bids / advertiser`);
    ok((await rest('public_ads', tok, { method: 'POST', body: JSON.stringify({ headline: 'x' }) })).status >= 400, `API, ${who}: cannot write through public_ads`);
    const pv = await rest('pool_public_view?select=*', tok);
    ok(pv.status === 200 && pv.body.every((r) => !('deposit_minor' in r) && (r.is_mine || r.buyer_code === null)), `API, ${who}: pool participants — no other buyer's Customer ID (${pv.body.length})`);
    for (const fn of ['delete_supplier', 'archive_supplier']) {
      const r = await rest(`rpc/${fn}`, tok, { method: 'POST', body: JSON.stringify({ p_supplier: crypto.randomUUID(), p_reason: 'x' }) });
      ok(r.status >= 400, `API, ${who}: rpc/${fn} refused (${r.status})`);
    }
  }

  const pp = await rest('rpc/portal_products?select=id,supplier_id', token);
  ok(pp.status === 200 && pp.body.length === 0, `API, customer: rpc/portal_products — no rows (${pp.status})`);
  ok((await rest('rpc/portal_products?select=id', null)).status >= 400, 'API, public key: rpc/portal_products refused');
  const mn = await rest('rpc/my_notifications?select=*', token);
  ok(mn.status === 200 && !(mn.body ?? []).some((r) => 'trace_id' in r || 'dedupe_key' in r), 'API, customer: my_notifications without trace_id / dedupe_key');
  ok(refused(await rest('rpc/my_notifications?select=trace_id', token)) || (await rest('rpc/my_notifications?select=trace_id', token)).status >= 400, 'API, customer: my_notifications?select=trace_id refused');
  // the customer still gets their own data through the allowed columns
  const orders = await rest('orders?select=id,code,status,total_cents,currency', token);
  ok(orders.status === 200 && orders.body.length > 0, `API, customer: own orders readable with customer-safe columns (${orders.body?.length})`);
  const of = await rest('order_factory?select=*', token);
  ok(of.status === 200 && of.body.every((r) => Object.keys(r).join(',') === 'order_id,verified,country,province'), `API, customer: order factory labels only (${of.body?.length})`);
  const qf = await rest('quote_factory?select=*', token);
  ok(qf.status === 200 && qf.body.length > 0, `API, customer: quote factory labels for own quotes (${qf.body?.length})`);
  const mine = await rest('pool_public_view?select=*&is_mine=is.true', token);
  ok(mine.status === 200 && mine.body.length > 0 && mine.body.every((r) => typeof r.buyer_code === 'string'), 'API, customer: own Customer ID on own pledge');
  ok((await rest('orders?select=id,code', null)).body?.length === 0, 'API, public key: no orders');
} catch (e) {
  ok(false, 'unexpected: ' + (e.message ?? e));
} finally {
  if (uid) {
    await db.query(`delete from org_members where user_id = $1`, [uid]);
    await db.query(`delete from profiles where id = $1`, [uid]).catch(() => {});
    await admin.auth.admin.deleteUser(uid);
  }
  ok(!(await db.query(`select 1 from auth.users where email = $1`, [email])).rowCount, 'temporary customer deleted');
  await db.end();
}
console.log(failed ? `\nAPI customer columns: ${failed} check(s) failed` : '\nAPI customer columns: all passed');
process.exitCode = failed ? 1 : 0;
