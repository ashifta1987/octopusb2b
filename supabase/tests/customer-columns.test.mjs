// Customer-safe reads (migration 195). STAGING ONLY, one rolled-back transaction, acting as the public key (anon) and as
// a signed-in customer through JWT claims — exactly what PostgREST does for an API call.
//  · every hidden column (scripts/hidden-columns.mjs) is refused for anon and for a customer
//  · the column grants hide exactly that list (a new column without a grant, or a hidden one granted, fails)
//  · regression guard: no column readable by anon / a signed-in user looks internal unless it is on the reviewed allowlist
//  · supplier identity, pool participants, carriers, set-up tables, ads, KYC split behave as agreed
//  · staff and suppliers keep working (import_product_row, product costs, the assistant queue)
//  · 195 down → up gives identical grants, policies and views (later applied migrations are unwound and re-applied around it)
// Run: node supabase/tests/customer-columns.test.mjs
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
const { HIDDEN_COLUMNS } = await import('../../scripts/hidden-columns.mjs');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
await assertStagingDatabase(db);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const as = async (uid, aal = 'aal1') => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]); await db.query('set local role authenticated'); };
const asAnon = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]); await db.query('set local role anon'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows, n: r.rowCount }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [], n: 0 }; } };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `T ${email}`, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  return id;
};

// Columns readable by anon / signed-in users whose NAME looks internal but which are customer-facing on purpose.
// Reviewed 19 Nov 2026 — every entry says why. Anything else matching the pattern fails the test.
const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;
const ALLOW = new Set([
  'quotes.notes',                       // the quote's notes to the buyer (shown on the quote)
  'kyc_submissions.contact_name', 'kyc_submissions.contact_phone', 'kyc_submissions.contact_email', // the customer's own entries
  'kyc_documents.storage_path',         // the customer's own uploaded files (own rows only)
  'tickets.created_by', 'ticket_messages.internal', // who opened the customer's own ticket; flag only (internal rows are filtered by RLS)
  'rfqs.created_by', 'service_requests.created_by', 'brand_projects.created_by',
  'wallet_topups.created_by', 'wallet_withdrawals.created_by', 'ai_jobs.created_by', 'api_clients.created_by', 'data_exports.created_by',
  'backups.created_by', 'content_versions.created_by', 'import_jobs.created_by', 'import_runs.created_by', // the signed-in user's own rows
  'brand_projects.note',                // the customer's own note on their brand request
  'assistant_feedback.note',            // the customer's own feedback text
  'company_bank_accounts.notes',        // payment instructions printed on the top-up page (staff write them for customers)
  'company_profile.contact_person',     // public company contact (website / documents) — on purpose
  'branches.phone', 'branches.email',   // public office contacts — on purpose
  'webhook_endpoints.secret',           // the customer's own webhook signing secret (own rows only)
  'api_keys.key_hash',                  // hash only, own rows
  'wallet_topups.reject_reason',
  'request_files.storage_path',         // the customer's own request files (RLS: own requests only); needed to download them
  'account_managers.assigned_at',       // date the account manager was assigned (shown to the customer)        // tells the customer why their top-up was rejected
  'ad_campaigns.rejection_reason', 'ad_campaigns.supplier_id', 'ad_campaigns.created_by', // advertiser's own campaign (public ads come from public_ads)
  'escalations.team', 'assistant_messages.hidden_from_customer', 'profiles.totp_required',
  'turnkey_leads.contact_name',         // the visitor's own lead form (insert only; no rows readable)
  'supplier_applications.contact_name', 'supplier_applications.contact_email', 'supplier_applications.contact_phone', 'supplier_applications.notes', 'supplier_applications.review_note', // applicant's own application (no rows for others)
  'import_jobs.supplier_id', 'import_jobs.cost_flagged_rows', 'import_jobs.cost_confirmed_at', 'import_jobs.cost_confirmed_by', 'import_jobs.zip_path', // supplier portal: a supplier's own import jobs only
]);
// tables whose rows customers and the public key can never see (RLS), so their columns don't count for the guard
const NO_CUSTOMER_ROWS = ['suppliers', 'supplier_contacts', 'supplier_name_variants', 'supplier_product_prices', 'supplier_products', 'supplier_switches',
  'supplier_verifications', 'product_costs', 'payouts', 'source_connections', 'distributor_suppliers', 'finance_approvals', 'import_review_items',
  'dropship_products', 'dropship_variants', 'dropship_routes', 'dropship_rates', 'item_master',
  'shipping_rate_cards', 'fee_versions', 'duty_rate_versions', 'duty_rate_entries', 'warehouse_stock', 'warehouse_stock_movements',
  'status_mappings', 'dropship_handoffs', 'domain_events', 'domain_event_consumptions', 'internal_charge_rules',
  'dropship_price_tiers', 'dropship_import_jobs', 'dropship_product_requests', 'dropship_access_requests',
  'payment_webhook_events', 'payment_settlements', 'payment_reconciliation_alerts', 'escrow_hold_approvals',
  'wh_applications', // W1: 3PL applications are staff-only (policy needs is_staff())
  'tk_client_project_staff', 'wh_dock_slots', 'wh_counts', 'wh_serials']; // W2a: dock slots, count passes and serials are staff-only. T2: Turnkey T2: account manager / creator / old lead per client project — staff-only (is_staff() + can('turnkey','view'))

try {
  await db.query('begin');
  const org = (await one(`select id from organizations where name = 'TEST DATA · Divisions'`))?.id;
  if (!org) throw new Error('staging test data missing — run scripts/seed-division-test-data.mjs');
  const cust = await user('cols-cust@example.com');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  const other = (await one(`insert into organizations(name, country) values ('Cols other buyer', 'DE') returning id`)).id;
  const custB = await user('cols-cust-b@example.com');
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [other, custB]);
  const kyc = (await one(`insert into kyc_submissions(org_id, status, company_name, internal_note, customer_message) values ($1, 'rejected', 'TEST', 'staff only: looks like a shell company', null) returning id`, [org])).id;
  const reviewer = await user('cols-kyc@example.com', 'admin');
  const kyc2 = (await one(`insert into kyc_submissions(org_id, status, company_name) values ($1, 'submitted', 'TEST 2') returning id`, [other])).id;

  // ── 1. every hidden column is refused, for the public key and for a signed-in customer ──
  for (const [who, fn] of [['public key', asAnon], ['customer', () => as(cust)]]) {
    const leaks = [];
    await fn();
    for (const [t, cols] of Object.entries(HIDDEN_COLUMNS)) for (const c of cols) {
      const r = await tryq(`select ${c} from ${t} limit 1`);
      if (!/permission denied/.test(r.err ?? '')) leaks.push(`${t}.${c}`);
    }
    const n = Object.values(HIDDEN_COLUMNS).flat().length;
    ok(leaks.length === 0, `${who}: all ${n} hidden columns refused${leaks.length ? ' — READABLE: ' + leaks.join(', ') : ''}`);
    const star = await tryq(`select * from products limit 1`);
    ok(/permission denied/.test(star.err ?? ''), `${who}: select * on products refused`);
    for (const v of ['public_suppliers', 'product_images']) ok(/permission denied/.test((await tryq(`select 1 from ${v} limit 1`)).err ?? ''), `${who}: ${v} refused`);
  }
  await db.query('reset role');

  // ── 2. the grants hide exactly the agreed list ──
  const drift = [];
  for (const [t, cols] of Object.entries(HIDDEN_COLUMNS)) {
    const notGranted = (await all(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1
      and not has_column_privilege('authenticated', format('public.%I', $1::text), column_name, 'SELECT') order by 1`, [t])).map((r) => r.c);
    const want = [...cols].sort();
    if (JSON.stringify(notGranted) !== JSON.stringify(want)) drift.push(`${t}: hidden ${notGranted.join(',')} ≠ list ${want.join(',')}`);
  }
  ok(drift.length === 0, `grants match scripts/hidden-columns.mjs exactly${drift.length ? ' — ' + drift.join(' | ') : ''}`);

  // ── 3. regression guard: nothing readable looks internal unless reviewed ──
  const readable = await all(`
    select c.table_name t, c.column_name col, c.table_name in (select table_name from information_schema.views where table_schema = 'public') is_view,
           has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'SELECT') anon,
           has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'SELECT') auth
      from information_schema.columns c where c.table_schema = 'public'`);
  // which tables can a customer or the public key get ROWS from at all? (a SELECT policy with a non-staff branch)
  const STAFF_ONLY = /can\('[^']*'::text, '[^']*'::text\)|is_staff\(\)|is_admin\(\)|assistant_staff_can\([^()]*\)|has_role\([^()]*\)|staff_sees_org\([^()]*\)|is_my_customer\([^()]*\)|mfa_fresh\(\)|staff_aal_ok\(\)|in_division\((?:[^()]|\([^()]*(?:\([^()]*\))?[^()]*\))*\)|is_my_supplier\([^()]*(?:\([^()]*\))?[^()]*\)|product_is_my_supplier\([^()]*\)|distributor_restricted\(\)/g;
  const pols = await all(`select tablename t, qual from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL') and qual is not null`);
  const reachable = new Set();
  for (const p of pols) {
    const rest = p.qual.replace(STAFF_ONLY, 'false').replace(/\(\s*SELECT [^()]*\)/g, 'x');
    // own-staff rows (user_id = auth.uid() on staff tables) are excluded below via NO_CUSTOMER_ROWS / staff tables
    if (!/^[\s()]*(false|NOT|AND|OR|[\s()])*$/i.test(rest.replace(/\bfalse\b/g, ' false '))) reachable.add(p.t);
  }
  for (const v of (await all(`select table_name t from information_schema.views where table_schema = 'public'`))) reachable.add(v.t);
  const STAFF_OWN_ROWS = ['division_members', 'user_roles', 'manager_limits', 'staff_backup_codes', 'restore_requests', 'finance_approvals', 'distributor_suppliers', 'import_jobs', 'import_rows', 'ai_jobs', 'backups'];
  const suspicious = readable.filter((r) => (r.anon || r.auth) && reachable.has(r.t) && INTERNAL_NAME.test(r.col) && !ALLOW.has(`${r.t}.${r.col}`)
    && !NO_CUSTOMER_ROWS.includes(r.t) && !STAFF_OWN_ROWS.includes(r.t) && !['warehouse_shipments', 'assistant_queue_view'].includes(r.t));
  ok(suspicious.length === 0, `no unreviewed internal-looking column is readable${suspicious.length ? ' — ' + suspicious.map((r) => `${r.t}.${r.col}${r.anon ? ' (anon)' : ''}`).join(', ') : ''}`);
  await as(cust);
  const rowsInStaffTables = [];
  for (const t of NO_CUSTOMER_ROWS) { const r = await tryq(`select count(*)::int n from ${t}`); if (!r.err && r.rows[0].n > 0) rowsInStaffTables.push(t); }
  ok(rowsInStaffTables.length === 0, `customer: no rows in supplier / staff tables (${NO_CUSTOMER_ROWS.length} checked)${rowsInStaffTables.length ? ' — ' + rowsInStaffTables.join(',') : ''}`);
  for (const t of ['warehouse_shipments', 'assistant_queue_view']) ok((await tryq(`select 1 from ${t}`)).rows.length === 0, `customer: ${t} — no rows`);

  // ── 4. catalogue + supplier identity ──
  await asAnon();
  const live = Number((await one(`select count(*) n from products`)).n);
  ok(live > 0, `public key: catalogue still readable with customer-safe columns (${live} live products)`);
  const pf = await all(`select * from product_factory limit 3`);
  ok(pf.length > 0 && Object.keys(pf[0]).join(',') === 'product_id,verified,country,province', `public key: product_factory gives verified + country + province only (${Object.keys(pf[0] ?? {}).join(',')})`);
  ok(/permission denied/.test((await tryq(`select 1 from quote_factory`)).err ?? '') && /permission denied/.test((await tryq(`select 1 from order_factory`)).err ?? ''), 'public key: quote / order factory refused');
  ok(/permission denied/.test((await tryq(`select 1 from carriers`)).err ?? '') || (await tryq(`select 1 from carriers`)).rows.length === 0, 'public key: carriers — nothing');
  for (const t of ['roles', 'permission_areas', 'sla_policies']) ok((await tryq(`select 1 from ${t}`)).rows.length === 0, `public key: ${t} — nothing`);
  const ads = await tryq(`select * from public_ads limit 1`);
  ok(!ads.err && !Object.keys(ads.rows[0] ?? { id: 1 }).some((k) => /budget|cpc|spent|org|supplier|created/.test(k)), 'public key: public_ads has no budgets / bids / advertiser');
  ok(/permission denied/.test((await tryq(`insert into public_ads(headline) values ('x')`)).err ?? ''), 'public key: cannot write through public_ads');
  ok((await tryq(`select 1 from ad_campaigns`)).rows.length === 0, 'public key: ad_campaigns base table — no rows');
  ok(/permission denied/.test((await tryq(`select 1 from portal_products()`)).err ?? ''), 'public key: portal_products() refused');

  await as(cust);
  const qf = await all(`select * from quote_factory`);
  const myQuotes = Number((await one(`select count(*) n from quotes`)).n);
  ok(qf.length === myQuotes && myQuotes > 0 && Object.keys(qf[0]).join(',') === 'quote_id,verified,country,province', `customer: factory label for own quotes only (${qf.length}/${myQuotes})`);
  const of = await all(`select * from order_factory`);
  ok(of.every((r) => Object.keys(r).join(',') === 'order_id,verified,country,province'), `customer: order factory labels without supplier (${of.length})`);
  for (const t of ['carriers', 'roles', 'permission_areas', 'sla_policies', 'role_permissions']) ok((await tryq(`select 1 from ${t}`)).rows.length === 0, `customer: ${t} — nothing (staff only)`);
  ok(Number((await one(`select count(*) n from portal_products()`)).n) === 0, 'customer: portal_products() (whole product rows for staff / suppliers) — no rows');
  const mn = await tryq(`select * from my_notifications() limit 1`);
  ok(!mn.err && !mn.rows.some((r) => 'trace_id' in r || 'dedupe_key' in r), 'customer: my_notifications() has no trace_id / dedupe_key');
  await as(custB);
  ok((await all(`select 1 from quote_factory`)).length === 0, 'another customer: no factory labels of the test company\'s quotes');

  // ── 5. pool participants ──
  await db.query('reset role');
  const pool = (await one(`select pl.pool_id from pool_pledges pl where pl.org_id = $1 limit 1`, [org]))?.pool_id;
  await asAnon();
  const pv = await all(`select * from pool_public_view where pool_id = $1`, [pool]);
  ok(pv.length > 0 && pv.every((r) => r.buyer_code === null && r.is_mine === false) && !('deposit_minor' in pv[0]), `public key: pool participants show country + quantity only (${pv.length})`);
  await as(cust);
  const mine = await all(`select * from pool_public_view where pool_id = $1`, [pool]);
  const myCode = (await one(`select buyer_code from organizations where id = $1`, [org])).buyer_code;
  ok(mine.some((r) => r.is_mine && r.buyer_code === myCode) && mine.filter((r) => !r.is_mine).every((r) => r.buyer_code === null), 'customer: own Customer ID only on own pledge');

  await db.query('reset role');
  await db.query(`insert into pool_events(pool_id, kind, title, body, qty) values ($1, 'joined', 'BUYER-0042 joined', 'BUYER-0042 pledged 300', 300), ($1, 'note', 'Update', 'Thanks BUYER-0042 and BUYER-7', null)`, [pool]);
  await asAnon();
  const evs = await all(`select title, body from pool_public_events where pool_id = $1`, [pool]);
  ok(evs.length >= 2 && !JSON.stringify(evs).match(/BUYER-\d+/i) && evs.some((e) => e.body === 'A buyer pledged 300'), `public key: pool timeline without Customer IDs (${evs.length} events)`);
  ok(/permission denied/.test((await tryq(`select body from pool_events limit 1`)).err ?? ''), 'public key: raw pool event texts refused');

  // ── 6. KYC ──
  await as(cust);
  ok(/permission denied/.test((await tryq(`select internal_note from kyc_submissions where id = $1`, [kyc])).err ?? ''), 'customer: KYC internal note refused');
  ok(!(await tryq(`select customer_message from kyc_submissions where id = $1`, [kyc])).err, 'customer: KYC message to customer readable');
  await as(reviewer, 'aal2');
  const noMsg = await tryq(`select review_kyc($1, 'rejected', 'internal only', null)`, [kyc2]);
  ok(/KYC_MESSAGE_REQUIRED/.test(noMsg.err ?? ''), 'reviewer: rejecting without a message to the customer is refused');
  ok(!(await tryq(`select review_kyc($1, 'rejected', 'internal only', 'Please upload a clearer licence.')`, [kyc2])).err, 'reviewer: reject with message + internal note');
  await db.query('reset role');
  const k2 = await one(`select internal_note, customer_message from kyc_submissions where id = $1`, [kyc2]);
  ok(k2.internal_note === 'internal only' && k2.customer_message === 'Please upload a clearer licence.', 'stored in two fields');
  ok(!(await one(`select count(*)::int n from information_schema.columns where table_name = 'kyc_submissions' and column_name = 'review_note'`)).n, 'old review_note column is gone (moved to internal_note)');

  // ── 7. staff / supplier paths that read hidden columns still work ──
  const supUser = await user('cols-distributor@example.com', 'distributor');
  const sup = await one(`insert into suppliers(code, legal_name, country, verified) values ('COLS-TEST-SUP', 'Cols Test Factory', 'CN', true) returning id, $1::uuid as user_id`, [supUser]);
  await db.query(`insert into distributor_suppliers(distributor_id, supplier_id) values ($1, $2)`, [supUser, sup.id]);
  {
    await as(sup.user_id, 'aal2');
    const r = await tryq(`select import_product_row($1::jsonb)`, [JSON.stringify({ mode: 'insert', sku: 'COLS-TEST-1', slug: 'cols-test-1-' + Date.now(), title: 'Cols test', supplier_id: sup.id, tiers: [{ min_qty: 1, unit_price_cents: 100 }], images: [{ url: 'https://x/1.jpg', position: 1, sha256: 'a'.repeat(64) }] })]);
    ok(!r.err, `distributor: import_product_row works with hidden columns (${(r.err ?? 'ok').slice(0, 80)})`);
    const pid = r.rows[0]?.import_product_row;
    const u = await tryq(`select import_product_row($1::jsonb)`, [JSON.stringify({ mode: 'update', product_id: pid, title: 'Cols test 2', supplier_id: sup.id, tiers: [{ min_qty: 1, unit_price_cents: 90 }], images: [{ url: 'https://x/2.jpg', position: 2, sha256: 'a'.repeat(64) }] })]);
    ok(!u.err, `distributor: update + replace image by sha256 works (${(u.err ?? 'ok').slice(0, 80)})`);
    await db.query('reset role');
    ok(Number((await one(`select count(*) n from product_media where product_id = $1`, [pid])).n) === 1, 'image with the same sha256 replaced (1 image)');
  }
  await db.query('reset role');
  const fin = await user('cols-fin@example.com', 'finance');
  await as(fin, 'aal2');
  ok(!(await tryq(`select count(*) from product_costs`)).err, 'finance: product costs readable (policy no longer reads products.supplier_id as the caller)');
  await db.query('reset role');
  const adm = await user('cols-admin@example.com', 'admin');
  await as(adm, 'aal2');
  ok(!(await tryq(`select reason, assigned_to from assistant_queue_view limit 1`)).err, 'admin: assistant queue view readable');
  await db.query('reset role');
  await db.query('rollback');

  // ── 8. down → up identical ──
  await db.query('begin');
  const snap = async () => JSON.stringify({
    pol: await all(`select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`),
    tg: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`),
    cg: await all(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3, 4`),
    fn: await all(`select p.oid::regprocedure::text f, p.proacl::text a, md5(p.prosrc) s from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
    vw: await all(`select c.relname, c.reloptions::text, md5(pg_get_viewdef(c.oid)) d, c.relacl::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' order by 1`),
    kyc: await all(`select column_name from information_schema.columns where table_name = 'kyc_submissions' order by 1`),
  });
  const after = await snap();
  // later migrations that are applied (e.g. 196 replaces review_kyc) are unwound first and re-applied afterwards
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, '20261101000195_customer_safe_reads.sql');
  await unwind(db, later);
  await db.query(fs.readFileSync('supabase/migrations/down/20261101000195_customer_safe_reads.down.sql', 'utf8'));
  const down = await snap();
  ok(down.includes('review_note') && !down.includes('product_factory'), 'down: review note back, factory views removed');
  await db.query(fs.readFileSync('supabase/migrations/20261101000195_customer_safe_reads.sql', 'utf8'));
  await reapply(db, later);
  const again = await snap();
  if (again !== after) { const a = JSON.parse(after), b = JSON.parse(again); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { const sa = new Set(a[k].map((x) => JSON.stringify(x))); console.log('  diff in', k, b[k].filter((x) => !sa.has(JSON.stringify(x))).slice(0, 5)); } }
  ok(again === after, 'up again: identical grants, policies, functions and views');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'cols-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\ncustomer columns: ${failed} check(s) failed` : '\ncustomer columns: all passed');
process.exitCode = failed ? 1 : 0;
