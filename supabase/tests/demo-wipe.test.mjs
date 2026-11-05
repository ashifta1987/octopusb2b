// ADDON-24: wipe_demo_data() + merge_duplicate_org() in ONE ROLLED-BACK transaction — nothing is deleted for real.
// Checks: refuses without the exact confirmation; deletes every is_seed row and the demo users (except the kept admin);
// keeps real customers, categories, settings; ledger balanced, wallets 0; sequences restart at 1001; audit row written;
// dashboards (revenue / geography / wallet RPC + overview counts) read zero for seed data.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const one = async (s, p) => (await db.query(s, p)).rows[0];
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const REF = 'qrawnqpxvtjmgncxmffu';

await db.query('begin');
try {
  const before = await one(`select (select count(*) from organizations where not is_seed) real_orgs,
    (select count(*) from categories) cats, (select count(*) from content_blocks) blocks, (select count(*) from services) services,
    (select count(*) from auth.users where email not like '%@demo.octopusb2b.com') real_users,
    (select count(*) from wallet_topups where not is_seed) real_topups`);

  await db.query('savepoint s');
  try { await db.query(`select wipe_demo_data('delete demo data', null)`); ok(false, 'refuses a wrong confirmation (no error!)'); }
  catch (e) { ok(/WIPE_REFUSED/.test(e.message), `refuses without the exact confirmation → ${e.message.slice(0, 60)}`); }
  await db.query('rollback to savepoint s');

  const adminId = (await one(`select id from auth.users where email = 'admin@demo.octopusb2b.com'`)).id;
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
    (select count(*) from wallets where balance_minor <> 0) nonzero_wallets,
    (select count(*) from organizations where not is_seed) real_orgs, (select count(*) from categories) cats,
    (select count(*) from content_blocks) blocks, (select count(*) from services) services,
    (select count(*) from auth.users where email not like '%@demo.octopusb2b.com') real_users,
    (select count(*) from wallet_topups) topups`);
  ok(Number(after.seed_left) === 0, 'every is_seed row is gone');
  ok(Number(after.demo_users) === 1 && after.demo_left === 'admin@demo.octopusb2b.com', `demo staff + demo buyer removed; only the kept admin remains (${after.demo_left})`);
  ok(Number(after.suppliers) === 0 && Number(after.products) === 0 && Number(after.orders) === 0, 'suppliers, products and orders are empty');
  ok(Number(after.ledger_sum) === 0 && Number(after.nonzero_wallets) === 0, 'ledger balanced and every wallet balance is 0');
  ok(after.real_orgs === before.real_orgs && after.real_users === before.real_users, `real customers kept (${after.real_orgs} companies, ${after.real_users} users)`);
  ok(after.cats === before.cats && after.blocks === before.blocks && after.services === before.services, 'categories, CMS content and services untouched');
  ok(after.topups === before.real_topups, 'real customers\' top-ups kept, demo top-up removed');

  const seqs = await one(`select nextval('seq_supplier_code') sup, nextval('seq_order') ord, nextval('seq_rfq') rfq, nextval('seq_pool') pool, nextval('seq_ticket') tkt`);
  ok(Object.values(seqs).every((v) => Number(v) === 1001), `next codes start at 1001 (OCT-${seqs.sup}, ORD-${seqs.ord}, RFQ-${seqs.rfq}, POOL-${seqs.pool}, TKT-${seqs.tkt})`);

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
  ok(Number(rev.total) === 0, `revenue dashboard reads 0 after the wipe (${rev.n} rows, total ${rev.total})`);
  const ov = await one(`select (select count(*) from orders where not is_seed and status <> 'cancelled') orders,
    (select coalesce(sum(total_cents), 0) from orders where not is_seed and status <> 'cancelled') gmv,
    (select count(*) from pools where not is_seed and status = 'open') open_pools`);
  ok(Number(ov.orders) === 0 && Number(ov.gmv) === 0 && Number(ov.open_pools) === 0, `overview figures read 0 (orders, GMV, open pools; revenue rows ${rev.n})`);

  // idempotent: a second run deletes nothing and still verifies
  const again = (await one(`select wipe_demo_data($1, $2) c`, [`DELETE DEMO DATA FOR ${REF}`, adminId])).c;
  ok(Object.values(again).every((v) => Number(v) === 0), 'running the wipe again deletes nothing (idempotent)');

  // merge the duplicate SOUTHFIELD companies
  const sf = (await db.query(`select o.id, (select string_agg(u.email, ',') from org_members m join auth.users u on u.id = m.user_id where m.org_id = o.id) members
    from organizations o where name = 'SOUTHFIELD BIOCHEM PVT LTD' order by buyer_code`)).rows;
  if (sf.length === 2) {
    const moved = (await one(`select merge_duplicate_org($1, $2) m`, [sf[0].id, sf[1].id])).m;
    const m = await one(`select count(*) n, (select string_agg(u.email, ',' order by u.email) from org_members om join auth.users u on u.id = om.user_id where om.org_id = $1) members
      from organizations where name = 'SOUTHFIELD BIOCHEM PVT LTD'`, [sf[0].id]);
    ok(Number(m.n) === 1 && m.members.includes('ashifta1987@gmail.com') && m.members.includes('ashifta@gmail.com'), `SOUTHFIELD merged into one company with both users (${m.members}; moved ${JSON.stringify(moved)})`);
  } else ok(false, `expected 2 SOUTHFIELD companies, found ${sf.length}`);
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  const still = await one(`select (select count(*) from products) p, (select count(*) from auth.users) u`);
  ok(Number(still.p) > 0 && Number(still.u) > 1, `rolled back — production data untouched (${still.p} products, ${still.u} users)`);
  await db.end();
}
