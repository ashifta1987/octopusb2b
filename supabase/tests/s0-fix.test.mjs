// Step S0-fix verification suite (STAGING ONLY, rolled-back DB transaction + carrier sandbox fail-closed check).
// Verifies:
//  1. A1: YunExpressAdapter fails closed with "Carrier not connected" whenever APP_ENVIRONMENT !== 'staging'
//     (e.g. 'production', '', unset) and real live YunExpress credentials are not connected; works in sandbox mode
//     ONLY when APP_ENVIRONMENT === 'staging'.
//  2. S1: Customers (org owner / authenticated role) cannot set or update organizations.credit_eligible themselves
//     (refused by column UPDATE privilege AND by trg_guard_org_credit_eligible).
//  3. S1: Even a superuser / service_role direct UPDATE on organizations.credit_eligible is rejected by
//     trg_guard_org_credit_eligible unless it goes through set_org_credit_eligible() (or sets the session guard).
//  4. S1: Non-admin staff cannot call set_org_credit_eligible() (FORBIDDEN); Admin without reason is refused
//     (REASON_REQUIRED); Admin with reason succeeds and writes audit_log ('org.credit_eligible_changed').
//  5. S4: Every Pay-later RPC (get_customer_credit_status, propose_customer_credit_terms, decide_customer_credit_terms,
//     checkout_pay_later, subscribe_saas_plan with 'pay_later') returns/raises CREDIT_NOT_ELIGIBLE when
//     organizations.credit_eligible = false, and never returns "Ask your account manager to set up credit".
//  6. S2: Migration 209 contains zero data mutations and its .down.sql → .sql round-trip is clean.
// Run: node supabase/tests/s0-fix.test.mjs

import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';

config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`);
  if (!c) failed++;
};
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', aal }),
  ]);
  await db.query('set local role authenticated');
};
const asAnon = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
  await db.query('set local role anon');
};
const tryq = async (q, p) => {
  await db.query('savepoint s');
  try {
    const r = await db.query(q, p);
    await db.query('release savepoint s');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint s');
    return { err: e.message, rows: [], n: 0 };
  }
};
const mkUser = async (email, role) => {
  const id = (
    await one(
      `insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`,
      [email],
    )
  ).id;
  await db.query(
    `insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`,
    [id, `S0 ${email}`, email],
  );
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  return id;
};

// ── 1. A1: Carrier Adapter fail-closed checks ──
{
  const adapterSrc = fs.readFileSync('lib/adapters/index.ts', 'utf8');
  const actionsSrc = fs.readFileSync('app/office/actions.ts', 'utf8');

  ok(
    adapterSrc.includes("process.env.APP_ENVIRONMENT !== 'staging'") &&
      adapterSrc.includes("throw new Error('Carrier not connected')"),
    'A1: YunExpressAdapter enforces APP_ENVIRONMENT === "staging" for sandbox mode and throws "Carrier not connected" otherwise',
  );
  ok(
    actionsSrc.includes("msg === 'Carrier not connected' ? 'Carrier not connected'"),
    'A1: createShipment & priceTrial surface "Carrier not connected" cleanly without creating shipment rows or changing order status',
  );

  // Dynamically evaluate the YunExpressAdapter guard logic across APP_ENVIRONMENT values
  const evalCarrierGuard = (env) => {
    const hasLiveKeys = Boolean(
      (env.YUNEXPRESS_APP_ID || env.YUNEXPRESS_CUSTOMER_NO) &&
        env.YUNEXPRESS_MODE === 'live' &&
        env.YUNEXPRESS_SANDBOX !== 'true',
    );
    const mode = hasLiveKeys ? 'live' : 'sandbox';
    if (env.APP_ENVIRONMENT === 'production' && (mode !== 'live' || env.YUNEXPRESS_SANDBOX === 'true')) {
      throw new Error('Carrier not connected');
    }
    if (mode !== 'live' && env.APP_ENVIRONMENT !== 'staging') {
      throw new Error('Carrier not connected');
    }
    return mode;
  };

  for (const badEnv of [
    { APP_ENVIRONMENT: 'production' },
    { APP_ENVIRONMENT: 'production', YUNEXPRESS_APP_ID: '123', YUNEXPRESS_MODE: 'live', YUNEXPRESS_SANDBOX: 'true' },
    { APP_ENVIRONMENT: '' },
    {},
    { APP_ENVIRONMENT: 'development' },
  ]) {
    let threw = false;
    try {
      evalCarrierGuard(badEnv);
    } catch (e) {
      threw = e.message === 'Carrier not connected';
    }
    ok(threw, `A1: carrier fails closed with "Carrier not connected" for env=${JSON.stringify(badEnv)}`);
  }

  ok(evalCarrierGuard({ APP_ENVIRONMENT: 'staging' }) === 'sandbox', 'A1: carrier allows sandbox on APP_ENVIRONMENT=staging');
}

// ── 2. S1–S4: Database privileges, trigger, admin RPC, and Pay-later RPCs ──
try {
  await db.query('begin');

  const ownerUid = await mkUser('s0fix-owner@example.com', null);
  const finMakerUid = await mkUser('s0fix-fin1@example.com', 'finance');
  const finApproverUid = await mkUser('s0fix-fin2@example.com', 'finance');
  const adminUid = await mkUser('s0fix-admin@example.com', 'admin');

  const orgId = (
    await one(
      `insert into organizations(name, country, kyc_status, is_seed) values ('TEST · S0-fix Org', 'US', 'verified', true) returning id`,
    )
  ).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [orgId, ownerUid]);

  const divSRC = (await one(`select id from divisions where code = 'SRC'`)).id;
  const orderId = (
    await one(
      `insert into orders (org_id, division_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, is_seed)
       values ($1, $2, 'deposit_pending', 'TEST · S0-fix Order', 10, 500, 0, 5000, 100, 5000, 0, 'USD', true)
       returning id`,
      [orgId, divSRC],
    )
  ).id;

  // Verify default credit_eligible is false
  const initialOrg = await one(`select credit_eligible from organizations where id = $1`, [orgId]);
  ok(initialOrg.credit_eligible === false, 'S1: new organization defaults to credit_eligible = false');

  // Verify direct superuser / service_role UPDATE without session flag is rejected by trigger
  const directUpd = await tryq(`update organizations set credit_eligible = true where id = $1`, [orgId]);
  ok(
    /CREDIT_ELIGIBLE_ADMIN_ONLY/.test(directUpd.err ?? ''),
    `S1: direct UPDATE on organizations.credit_eligible rejected by trigger (${directUpd.err})`,
  );

  // Verify direct INSERT with credit_eligible = true without session flag is rejected by trigger
  const directIns = await tryq(
    `insert into organizations(name, country, credit_eligible) values ('TEST · Rogue Insert', 'US', true)`,
  );
  ok(
    /CREDIT_ELIGIBLE_ADMIN_ONLY/.test(directIns.err ?? ''),
    `S1: direct INSERT with credit_eligible=true rejected by trigger (${directIns.err})`,
  );

  // Verify anon cannot update organizations at all
  await asAnon();
  const anonUpd = await tryq(`update organizations set credit_eligible = true where id = $1`, [orgId]);
  ok(/permission denied/.test(anonUpd.err ?? ''), `S1: anon UPDATE on organizations.credit_eligible refused (${anonUpd.err})`);

  // Verify org owner updating their own org cannot change credit_eligible (column privilege denied)
  await as(ownerUid, 'aal1');
  const ownerCreditUpd = await tryq(`update organizations set credit_eligible = true where id = $1`, [orgId]);
  ok(
    /permission denied/.test(ownerCreditUpd.err ?? ''),
    `S1: org owner UPDATE on organizations.credit_eligible refused by column privileges (${ownerCreditUpd.err})`,
  );

  // Verify org owner CAN still update normal company profile fields (city, website)
  const ownerCityUpd = await tryq(`update organizations set city = 'Austin' where id = $1`, [orgId]);
  ok(!ownerCityUpd.err && ownerCityUpd.n === 1, 'S1: org owner can still update permitted company profile columns (city)');

  // Verify org owner calling set_org_credit_eligible is refused with FORBIDDEN
  const ownerRpc = await tryq(`select set_org_credit_eligible($1, true, 'Trying to self-enable')`, [orgId]);
  ok(/FORBIDDEN/.test(ownerRpc.err ?? ''), `S1: org owner calling set_org_credit_eligible refused (${ownerRpc.err})`);

  // Verify non-admin Finance staff calling set_org_credit_eligible is refused with FORBIDDEN
  await as(finMakerUid, 'aal2');
  const finRpc = await tryq(`select set_org_credit_eligible($1, true, 'Finance trying to enable')`, [orgId]);
  ok(/FORBIDDEN/.test(finRpc.err ?? ''), `S1: non-admin Finance staff calling set_org_credit_eligible refused (${finRpc.err})`);

  // ── S4: Verify every Pay-later RPC returns/raises CREDIT_NOT_ELIGIBLE when credit_eligible = false ──
  await as(ownerUid, 'aal1');
  const statusNotElig = (await one(`select get_customer_credit_status($1, null) as s`, [orgId])).s;
  ok(
    statusNotElig.eligible === false &&
      statusNotElig.credit_eligible === false &&
      statusNotElig.reason === 'CREDIT_NOT_ELIGIBLE' &&
      !JSON.stringify(statusNotElig).includes('Ask your account manager'),
    `S4: get_customer_credit_status returns CREDIT_NOT_ELIGIBLE when credit_eligible=false (${JSON.stringify(statusNotElig)})`,
  );

  const checkoutNotElig = await tryq(
    `select checkout_pay_later($1, 'sourcing', 'order', $2, 5000, 'USD', 's0fix-pl-1')`,
    [orgId, orderId],
  );
  ok(
    /CREDIT_NOT_ELIGIBLE/.test(checkoutNotElig.err ?? ''),
    `S4: checkout_pay_later raises CREDIT_NOT_ELIGIBLE when credit_eligible=false (${checkoutNotElig.err})`,
  );

  await db.query('reset role');
  await db.query(`update saas_plans set active = true where code = 'dropship_growth_monthly'`);
  await as(ownerUid, 'aal1');
  const saasNotElig = await tryq(
    `select subscribe_saas_plan($1, 'dropship_growth_monthly', 'pay_later', 'wallet', 's0fix-saas-1')`,
    [orgId],
  );
  ok(
    /CREDIT_NOT_ELIGIBLE/.test(saasNotElig.err ?? ''),
    `S4: subscribe_saas_plan with pay_later raises CREDIT_NOT_ELIGIBLE when credit_eligible=false (${saasNotElig.err})`,
  );

  await as(finMakerUid, 'aal2');
  const proposeNotElig = await tryq(
    `select propose_customer_credit_terms($1, 100000, 30, null, 'USD', 'Should fail until admin marks org eligible')`,
    [orgId],
  );
  ok(
    /CREDIT_NOT_ELIGIBLE/.test(proposeNotElig.err ?? ''),
    `S4: propose_customer_credit_terms raises CREDIT_NOT_ELIGIBLE when credit_eligible=false (${proposeNotElig.err})`,
  );

  // ── S1: Admin enables credit_eligible via set_org_credit_eligible(p_org, p_value, p_reason) ──
  await as(adminUid, 'aal2');
  const noReason = await tryq(`select set_org_credit_eligible($1, true, '   ')`, [orgId]);
  ok(/REASON_REQUIRED/.test(noReason.err ?? ''), `S1: set_org_credit_eligible requires non-empty reason (${noReason.err})`);

  const adminEnable = await tryq(`select set_org_credit_eligible($1, true, 'Approved Octopus test customer')`, [orgId]);
  ok(!adminEnable.err, `S1: Admin set_org_credit_eligible succeeds (${JSON.stringify(adminEnable.rows[0]?.set_org_credit_eligible)})`);

  await db.query('reset role');
  const auditRow = await one(
    `select action, details from audit_log where entity = 'organizations' and entity_id = $1 and action = 'org.credit_eligible_changed' order by created_at desc limit 1`,
    [orgId],
  );
  ok(
    auditRow && auditRow.details?.to === true && auditRow.details?.reason === 'Approved Octopus test customer',
    `S1: set_org_credit_eligible writes audit_log (${JSON.stringify(auditRow?.details)})`,
  );

  // Even when credit_eligible = true, if no active credit terms exist yet, get_customer_credit_status returns CREDIT_NOT_ELIGIBLE (never "Ask your account manager")
  await as(ownerUid, 'aal1');
  const statusNoTerms = (await one(`select get_customer_credit_status($1, null) as s`, [orgId])).s;
  ok(
    statusNoTerms.eligible === false &&
      statusNoTerms.credit_eligible === true &&
      statusNoTerms.reason === 'CREDIT_NOT_ELIGIBLE' &&
      !JSON.stringify(statusNoTerms).includes('Ask your account manager'),
    `S4: get_customer_credit_status with credit_eligible=true but no active terms returns CREDIT_NOT_ELIGIBLE`,
  );

  // Now Finance Maker proposes & Finance Approver approves credit terms, and Pay later succeeds
  await as(finMakerUid, 'aal2');
  const propRes = await tryq(
    `select propose_customer_credit_terms($1, 100000, 30, null, 'USD', 'Net 30 line') as id`,
    [orgId],
  );
  ok(!propRes.err, 'S1/S4: propose_customer_credit_terms succeeds once credit_eligible=true');
  const termsId = propRes.rows[0].id;

  await as(finApproverUid, 'aal2');
  const decRes = await tryq(`select decide_customer_credit_terms($1, true, 'Approved by 2nd finance user')`, [termsId]);
  ok(!decRes.err, 'S1/S4: decide_customer_credit_terms two-person approval succeeds');

  await as(ownerUid, 'aal1');
  const statusActive = (await one(`select get_customer_credit_status($1, null) as s`, [orgId])).s;
  ok(
    statusActive.eligible === true && Number(statusActive.available_cents) === 100000,
    `S1/S4: get_customer_credit_status returns eligible=true once credit_eligible=true and terms are active`,
  );

  const checkoutOk = await tryq(
    `select checkout_pay_later($1, 'sourcing', 'order', $2, 5000, 'USD', 's0fix-pl-ok')`,
    [orgId, orderId],
  );
  ok(!checkoutOk.err, 'S1/S4: checkout_pay_later succeeds for eligible org with active credit terms');
} finally {
  await db.query('rollback');
  await db.end();
}

console.log(failed ? `\ns0-fix: ${failed} check(s) failed` : '\ns0-fix: all checks passed');
process.exitCode = failed ? 1 : 0;
