// ADDON-24: wipe_demo_data() + merge_duplicate_org() in ONE ROLLED-BACK transaction — nothing is deleted for real.
// Checks: refuses without the exact confirmation; deletes every is_seed row and the demo users (except the kept admin);
// keeps real customers, categories, settings; ledger balanced, wallets 0; sequences restart at 1001; audit row written;
// dashboards (revenue / geography / wallet RPC + overview counts) read zero for seed data.
import pg from 'pg';
import { STAGING_PROJECT_REF, loadStagingEnvOrExit, assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';
loadStagingEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);
const one = async (s, p) => (await db.query(s, p)).rows[0];
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const REF = STAGING_PROJECT_REF;

// sequences are NOT transactional (setval/nextval survive a rollback) — snapshot them and put them back afterwards
const seqSnapshot = (await db.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)).rows;
await db.query('begin');
try {
  const before = await one(`select (select count(*) from organizations where not is_seed) real_orgs,
    (select count(*) from categories) cats, (select count(*) from content_blocks) blocks, (select count(*) from services) services,
    (select count(*) from auth.users where email not like '%@demo.octopusb2b.com') real_users,
    (select count(*) from wallet_topups where not is_seed) real_topups,
    (select coalesce(sum(w.balance_minor), 0) from wallets w join organizations o on o.id = w.org_id where not o.is_seed) real_wallet_sum`);

  await db.query('savepoint s');
  try { await db.query(`select wipe_demo_data('delete demo data', null)`); ok(false, 'refuses a wrong confirmation (no error!)'); }
  catch (e) { ok(/WIPE_REFUSED/.test(e.message), `refuses without the exact confirmation → ${e.message.slice(0, 60)}`); }
  await db.query('rollback to savepoint s');

  const adminId = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
  // revenue of real (not demo/test) customers, read as the admin before the wipe with the demo lines removed — the
  // dashboard must show exactly this afterwards (staging has a real test company with revenue; live had none)
  await db.query('savepoint rr');
  await db.query(`delete from ledger_entries where is_seed`);
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminId, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]);
  await db.query('set local role authenticated');
  const realRev = Number((await one(`select coalesce(sum(net_cents), 0) total from admin_revenue_by_stream(null, null)`)).total);
  await db.query('rollback to savepoint rr');
  // real (non-demo) catalogue loaded since launch, e.g. Bowijie OCT-1132 — must survive the wipe
  const real = await one(`select (select count(*) from suppliers where not is_seed) suppliers, (select count(*) from products where not is_seed) products, (select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::int), 1000) from suppliers where not is_seed) max_code`);
  const counts = (await one(`select wipe_demo_data($1, $2) c`, [`DELETE DEMO DATA FOR ${REF}`, adminId])).c;
  console.log('  deleted:', JSON.stringify(counts));

  const after = await one(`select
    (select count(*) from organizations where is_seed) + (select count(*) from suppliers where is_seed) + (select count(*) from products where is_seed)
      + (select count(*) from orders where is_seed) + (select count(*) from journals where is_seed) + (select count(*) from ledger_entries where is_seed)
      + (select count(*) from pools where is_seed) + (select count(*) from ad_campaigns where is_seed) + (select count(*) from rfqs where is_seed) seed_left,
    (select count(*) from auth.users where email like '%@demo.octopusb2b.com') demo_users,
    (select string_agg(email, ',') from auth.users where email like '%@demo.octopusb2b.com') demo_left,
    (select count(*) from suppliers) suppliers, (select count(*) from products) products, (select count(*) from orders) orders,
    (select coalesce(sum(debit_cents - credit_cents), 0) from ledger_entries) ledger_sum,
    (select coalesce(sum(balance_minor), 0) from wallets) wallet_sum,
    (select count(*) from organizations where not is_seed) real_orgs, (select count(*) from categories) cats,
    (select count(*) from content_blocks) blocks, (select count(*) from services) services,
    (select count(*) from auth.users where email not like '%@demo.octopusb2b.com') real_users,
    (select count(*) from wallet_topups) topups`);
  ok(Number(after.seed_left) === 0, 'every is_seed row is gone');
  // migration 219: demo users who proposed/approved a fee schedule are kept (fee_versions is append-only two-person history)
  const keptFee = (await db.query(`select email from auth.users u where email like '%@demo.octopusb2b.com' and email <> 'admin@demo.octopusb2b.com'
    and (exists (select 1 from fee_versions f where f.proposed_by = u.id or f.approved_by = u.id)
      -- migration 236: people in the append-only stock ledger (reserved / picked / moved stock) are kept too
      or exists (select 1 from warehouse_stock_movements m where m.actor_id = u.id)) order by email`)).rows.map((r) => r.email);
  const expectedLeft = ['admin@demo.octopusb2b.com', ...keptFee].sort().join(',');
  const actualLeft = (after.demo_left ?? '').split(',').sort().join(',');
  ok(Number(after.demo_users) === 1 + keptFee.length && actualLeft === expectedLeft,
    `demo staff + demo buyer removed; only the kept admin${keptFee.length ? ` + ${keptFee.length} fee-history approver(s) / stock-ledger actor(s)` : ''} remain (${after.demo_left})`);
  ok(Number(after.suppliers) === Number(real.suppliers) && Number(after.products) === Number(real.products) && Number(after.orders) === 0,
    `only real suppliers/products remain (${after.suppliers} suppliers, ${after.products} products), no orders`);
  ok(Number(after.ledger_sum) === 0 && Number(after.wallet_sum) === Number(before.real_wallet_sum), `ledger balanced; demo wallets gone, real customers' balances unchanged (${after.wallet_sum})`);
  ok(after.real_orgs === before.real_orgs && after.real_users === before.real_users, `real customers kept (${after.real_orgs} companies, ${after.real_users} users)`);
  ok(after.cats === before.cats && after.blocks === before.blocks && after.services === before.services, 'categories, CMS content and services untouched');
  ok(after.topups === before.real_topups, 'real customers\' top-ups kept, demo top-up removed');

  const seqs = await one(`select nextval('seq_supplier_code') sup, nextval('seq_order') ord, nextval('seq_rfq') rfq, nextval('seq_pool') pool, nextval('seq_ticket') tkt`);
  const nextSup = Math.max(1001, Number(real.max_code) + 1);
  ok(Number(seqs.sup) === nextSup && [seqs.ord, seqs.rfq, seqs.pool, seqs.tkt].every((v) => Number(v) === 1001), `next codes: supplier after the real ones, others 1001 (OCT-${seqs.sup}, ORD-${seqs.ord}, RFQ-${seqs.rfq}, POOL-${seqs.pool}, TKT-${seqs.tkt})`);

  const audit = await one(`select count(*) n from audit_log where action = 'demo_data_wiped' and actor_id = $1`, [adminId]);
  ok(Number(audit.n) === 1, 'audit_log "demo_data_wiped" written with the operator');
  const banner = await one(`select value from site_settings where key = 'demo_wipe'`);
  ok(!!banner?.value?.at, 'site_settings.demo_wipe set (drives the /admin banner)');
  const st = await one(`select (select value->>'amount_minor' from site_settings where key='wallet_credit_default') credit,
    (select value from site_settings where key='supplier_portal_enabled') portal, (select value from site_settings where key='pool_enabled') pools,
    (select count(*) from categories where name ~ '^[a-z]') lower_cats`);
  ok(st.credit === '0' && st.portal === false && st.pools === true && Number(st.lower_cats) === 0, 'launch defaults: wallet credit 0, supplier portal off, pools on, category names capitalised');

  // overview / dashboard queries read zero
  // revenue RPC as the (kept) admin, inside a savepoint
  await db.query('savepoint r');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminId, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]);
  await db.query('set local role authenticated');
  const rev = await one(`select count(*) n, coalesce(sum(net_cents), 0) total from admin_revenue_by_stream(null, null)`).catch((e) => ({ n: 'err', total: e.message.slice(0, 40) }));
  await db.query('rollback to savepoint r');
  await db.query('reset role');
  ok(Number(rev.total) === realRev, `revenue dashboard shows only real customers' revenue after the wipe (${rev.n} rows, total ${rev.total}, real ${realRev})`);
  const ov = await one(`select (select count(*) from orders where not is_seed and status <> 'cancelled') orders,
    (select coalesce(sum(total_cents), 0) from orders where not is_seed and status <> 'cancelled') gmv,
    (select count(*) from pools where not is_seed and status = 'open') open_pools`);
  ok(Number(ov.orders) === 0 && Number(ov.gmv) === 0 && Number(ov.open_pools) === 0, `overview figures read 0 (orders, GMV, open pools; revenue rows ${rev.n})`);

  // idempotent: a second run deletes nothing and still verifies
  const again = (await one(`select wipe_demo_data($1, $2) c`, [`DELETE DEMO DATA FOR ${REF}`, adminId])).c;
  ok(Object.entries(again).every(([k, v]) => k === 'demo_users_kept_fee_history' || Number(v) === 0), 'running the wipe again deletes nothing (idempotent)');

  // merge duplicate companies (using SOUTHFIELD if present, otherwise two temporary duplicate orgs inside this rolled-back tx)
  const sf = (await db.query(`select o.id, (select string_agg(u.email, ',') from org_members m join auth.users u on u.id = m.user_id where m.org_id = o.id) members
    from organizations o where name = 'SOUTHFIELD BIOCHEM PVT LTD' order by buyer_code`)).rows;
  if (sf.length === 2) {
    const moved = (await one(`select merge_duplicate_org($1, $2) m`, [sf[0].id, sf[1].id])).m;
    const m = await one(`select count(*) n, (select string_agg(u.email, ',' order by u.email) from org_members om join auth.users u on u.id = om.user_id where om.org_id = $1) members
      from organizations where name = 'SOUTHFIELD BIOCHEM PVT LTD'`, [sf[0].id]);
    ok(Number(m.n) === 1 && m.members.includes('ashifta1987@gmail.com') && m.members.includes('ashifta@gmail.com'), `SOUTHFIELD merged into one company with both users (${m.members}; moved ${JSON.stringify(moved)})`);
  } else {
    // not exactly two SOUTHFIELD rows (staging's duplicates were already merged): use two temporary duplicates
    const o1 = (await one(`insert into organizations(name, country) values ('DUPE TEST ORG', 'AE') returning id`)).id;
    const o2 = (await one(`insert into organizations(name, country) values ('DUPE TEST ORG', 'AE') returning id`)).id;
    const u1 = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'dupe1@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;
    const u2 = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), 'dupe2@example.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`)).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner'), ($3, $4, 'owner')`, [o1, u1, o2, u2]);
    // new orgs get default company_services rows (177) which share (org_id, service) PK; clear o2's defaults so merge_duplicate_org(149) can move org rows
    await db.query(`delete from company_services where org_id = $1`, [o2]);
    const moved = (await one(`select merge_duplicate_org($1, $2) m`, [o1, o2])).m;
    const m = await one(`select count(*) n, (select string_agg(u.email, ',' order by u.email) from org_members om join auth.users u on u.id = om.user_id where om.org_id = $1) members
      from organizations where id in ($1, $2)`, [o1, o2]);
    ok(Number(m.n) === 1 && m.members === 'dupe1@example.com,dupe2@example.com', `duplicate org merged into one company with both users (${m.members}; moved ${JSON.stringify(moved)})`);
  }
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  // sequences are not transactional: put them back even if the connection above dropped (a lost connection once
  // left seq_rfq / seq_journal / seq_service_request reset on staging) — use a fresh connection for the restore
  const fix = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await fix.connect();
  try {
    await assertStagingDatabase(fix);
    for (const r of seqSnapshot) {
      if (r.last_value == null) await fix.query(`select setval($1, 1, false)`, [r.sequencename]);
      else await fix.query(`select setval($1, $2, true)`, [r.sequencename, r.last_value]);
    }
    const still = (await fix.query(`select (select count(*) from products) p, (select count(*) from auth.users) u`)).rows[0];
    ok(Number(still.p) > 0 && Number(still.u) > 1, `rolled back — production data untouched (${still.p} products, ${still.u} users)`);
  } finally {
    await fix.end();
    await db.end().catch(() => {});
  }
}
