// Step S0-fix + Review Fixes verification suite (STAGING ONLY, rolled-back DB transaction).
// Verifies:
//  1. A1 + Fix 4c: YunExpressAdapter + createShipment fail closed with "Carrier not connected" whenever
//     APP_ENVIRONMENT !== 'staging' without live keys -> 0 new shipments rows, 0 new tracking_events rows,
//     and order status unchanged ('ready_to_ship').
//  2. Fix 1: confirmMockPaymentAction / TestPaymentAdapter allowed ONLY when APP_ENVIRONMENT === 'staging'.
//     (W7, 26 Nov 2026: the staging-only simulateTracking action and the legacy /office/shipping screen are deleted —
//     checked statically below; B2B shipments live in Warehouse OS and show "Carrier not connected" the same way.)
//  3. S1 + Fix 2: organizations authenticated UPDATE grant contains ONLY plain profile fields
//     (business_type, city, country, name, website). An org owner cannot set kyc_status='verified',
//     cannot clear archived_at, cannot set credit_eligible=true, cannot edit registration_no/wallet_reference,
//     and CAN still edit name/city/country/business_type/website.
//  4. Fix 4a: set_org_credit_eligible uses local set_config('octopus.allow_credit_eligible_write','true',true)
//     and resets it immediately after the UPDATE so subsequent direct updates in the same tx still fail.
//  5. S4 + Fix 4b: When credit_eligible=false -> CREDIT_NOT_ELIGIBLE; when credit_eligible=true with no
//     active terms -> NO_CREDIT_TERMS (never "Ask your account manager to set up credit").
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
const all = async (q, p) => (await db.query(q, p)).rows;
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

// Mirror of the YunExpressAdapter.createShipment guards from lib/adapters/index.ts & app/office/actions.ts
function runCarrierCreateShipment(env, input) {
  const hasLiveKeys = Boolean(
    (env.YUNEXPRESS_CUSTOMER_NO || env.YUNEXPRESS_APP_ID) &&
      (env.YUNEXPRESS_API_SECRET || env.YUNEXPRESS_APP_KEY) &&
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
  if (env.APP_ENVIRONMENT !== 'staging') {
    throw new Error('Carrier not connected');
  }
  const trackingNo = 'YT' + (Date.now().toString().slice(-10) + Math.floor(Math.random() * 1e4)).padStart(14, '0');
  return { trackingNo, labelUrl: `/api/labels/${trackingNo}?order=${encodeURIComponent(input.orderCode)}` };
}

async function runCreateShipmentFlow(dbClient, env, orderId, input) {
  const o = (await dbClient.query(`select id, code, org_id, status from orders where id = $1`, [orderId])).rows[0];
  if (!o) return { error: 'Order not found' };
  if (o.status !== 'ready_to_ship') return { error: 'Only orders in “ready to ship” can be shipped.' };
  let res;
  try {
    res = runCarrierCreateShipment(env, { orderCode: o.code, ...input });
  } catch (e) {
    const msg = e.message;
    return { error: msg === 'Carrier not connected' ? 'Carrier not connected' : `YunExpress: ${msg}` };
  }
  await dbClient.query(
    `insert into shipments (order_id, org_id, carrier_code, service_code, tracking_no, label_url, status, weight_kg, parcels, rate_cents, currency)
     values ($1, $2, 'yunexpress', $3, $4, $5, 'label_ready', $6, $7, $8, 'USD')`,
    [o.id, o.org_id, input.service, res.trackingNo, res.labelUrl, input.weightKg, input.parcels, input.rateCents],
  );
  return { ok: true, data: res };
}

// ── 1. Static source verification for Fix 1 & A1 ──
{
  const adapterSrc = fs.readFileSync('lib/adapters/index.ts', 'utf8');
  const actionsSrc = fs.readFileSync('app/office/actions.ts', 'utf8');
  const mockActionSrc = fs.readFileSync('app/(store)/pay/mock/[id]/actions.ts', 'utf8');
  const b2bPageSrc = fs.readFileSync('app/office/warehouse/b2b-shipments/page.tsx', 'utf8');

  ok(
    !actionsSrc.includes('simulateTracking') && !actionsSrc.includes('NEXT_SHIP') && !fs.existsSync('app/office/shipping/page.tsx'),
    'W7: the simulateTracking action and the legacy /office/shipping screen are deleted',
  );
  ok(
    mockActionSrc.includes("return { ok: false, error: 'Not available' };"),
    'Fix 1: confirmMockPaymentAction returns "Not available" whenever APP_ENVIRONMENT !== "staging"',
  );
  ok(
    adapterSrc.includes("if (process.env.APP_ENVIRONMENT !== 'staging') throw new Error('Not available');"),
    'Fix 1: TestPaymentAdapter throws "Not available" whenever APP_ENVIRONMENT !== "staging"',
  );
  ok(
    b2bPageSrc.includes("'Carrier not connected'") && !b2bPageSrc.includes('simulateTracking') && !b2bPageSrc.includes('Simulate event'),
    'Fix 1 / A1 (W7): B2B shipments shows "Carrier not connected" when non-staging without live keys and never offers simulated tracking',
  );
}

try {
  await db.query('begin');

  const ownerUid = await mkUser('s0fix-owner@example.com', null);
  const finMakerUid = await mkUser('s0fix-fin1@example.com', 'finance');
  const finApproverUid = await mkUser('s0fix-fin2@example.com', 'finance');
  const adminUid = await mkUser('s0fix-admin@example.com', 'admin');

  const orgId = (
    await one(
      `insert into organizations(name, country, city, kyc_status, is_seed) values ('TEST · S0-fix Org', 'US', 'New York', 'not_started', true) returning id`,
    )
  ).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [orgId, ownerUid]);

  const archivedOrgId = (
    await one(
      `insert into organizations(name, country, archived_at, is_seed) values ('TEST · Archived S0 Org', 'US', now(), true) returning id`,
    )
  ).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [
    archivedOrgId,
    ownerUid,
  ]);

  const divSRC = (await one(`select id from divisions where code = 'SRC'`)).id;
  const orderId = (
    await one(
      `insert into orders (org_id, division_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, is_seed)
       values ($1, $2, 'deposit_pending', 'TEST · S0-fix Order', 10, 500, 0, 5000, 100, 5000, 0, 'USD', true)
       returning id`,
      [orgId, divSRC],
    )
  ).id;

  const readyOrderId = (
    await one(
      `insert into orders (org_id, division_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, is_seed)
       values ($1, $2, 'ready_to_ship', 'TEST · S0-fix Ready Order', 5, 1000, 0, 5000, 100, 5000, 5000, 'USD', true)
       returning id`,
      [orgId, divSRC],
    )
  ).id;

  // an existing shipment on the order (W7: the simulated-tracking checks that used it are gone with the action)
  await one(
    `insert into shipments (code, order_id, org_id, carrier_code, service_code, tracking_no, status, weight_kg, parcels, rate_cents, currency, is_seed)
     values ('TEST-S0-SHP', $1, $2, 'yunexpress', 'standard', 'TESTS00000001', 'label_ready', 1.5, 1, 900, 'USD', true)
     returning id`,
    [orderId, orgId],
  );

  // ── 2. Fix 4c: createShipment with carrier not connected -> 0 shipments, 0 tracking_events, order status unchanged ──
  {
    const shipCountBefore = Number((await one(`select count(*) n from shipments`)).n);
    const trackCountBefore = Number((await one(`select count(*) n from tracking_events`)).n);
    const statusBefore = (await one(`select status from orders where id = $1`, [readyOrderId])).status;

    for (const nonConnectedEnv of [
      { APP_ENVIRONMENT: 'production' },
      { APP_ENVIRONMENT: '' },
      { APP_ENVIRONMENT: 'production', YUNEXPRESS_CUSTOMER_NO: 'C1', YUNEXPRESS_API_SECRET: 'S1', YUNEXPRESS_MODE: 'live', YUNEXPRESS_SANDBOX: 'true' },
    ]) {
      const res = await runCreateShipmentFlow(db, nonConnectedEnv, readyOrderId, {
        service: 'Global Direct Line (standard)',
        rateCents: 620,
        weightKg: 1,
        parcels: 1,
      });
      ok(
        res.error === 'Carrier not connected',
        `Fix 4c: createShipment returns "Carrier not connected" for env=${JSON.stringify(nonConnectedEnv)}`,
      );
    }

    const shipCountAfter = Number((await one(`select count(*) n from shipments`)).n);
    const trackCountAfter = Number((await one(`select count(*) n from tracking_events`)).n);
    const statusAfter = (await one(`select status from orders where id = $1`, [readyOrderId])).status;

    ok(
      shipCountAfter === shipCountBefore &&
        trackCountAfter === trackCountBefore &&
        statusAfter === 'ready_to_ship' &&
        statusAfter === statusBefore,
      `Fix 4c: 0 new shipments rows (${shipCountBefore} -> ${shipCountAfter}), 0 new tracking_events (${trackCountBefore} -> ${trackCountAfter}), order status unchanged (${statusBefore} -> ${statusAfter})`,
    );
  }

  // ── 4. Fix 2: organizations column UPDATE privileges & org owner restrictions ──
  {
    const authUpdatable = (
      await all(
        `select column_name c
           from information_schema.columns
          where table_schema = 'public' and table_name = 'organizations'
            and has_column_privilege('authenticated', 'public.organizations', column_name, 'UPDATE')
          order by 1`,
      )
    ).map((r) => r.c);
    const anonUpdatable = (
      await all(
        `select column_name c
           from information_schema.columns
          where table_schema = 'public' and table_name = 'organizations'
            and has_column_privilege('anon', 'public.organizations', column_name, 'UPDATE')
          order by 1`,
      )
    ).map((r) => r.c);

    ok(
      JSON.stringify(authUpdatable) === JSON.stringify(['business_type', 'city', 'country', 'name', 'website']),
      `Fix 2: authenticated UPDATE grant on organizations has ONLY plain profile fields: [${authUpdatable.join(', ')}]`,
    );
    ok(anonUpdatable.length === 0, `Fix 2: anon has 0 updatable columns on organizations ([${anonUpdatable.join(', ')}])`);

    await as(ownerUid, 'aal1');
    const tryKyc = await tryq(`update organizations set kyc_status = 'verified' where id = $1`, [orgId]);
    ok(
      /permission denied/.test(tryKyc.err ?? ''),
      `Fix 2: org owner cannot set kyc_status='verified' (${tryKyc.err})`,
    );

    const tryUnarchive = await tryq(`update organizations set archived_at = null where id = $1`, [archivedOrgId]);
    ok(
      /permission denied/.test(tryUnarchive.err ?? ''),
      `Fix 2: org owner cannot clear archived_at (${tryUnarchive.err})`,
    );

    for (const col of ['credit_eligible = true', "registration_no = 'FAKE-123'", "wallet_reference = 'W-99999'", 'is_seed = false']) {
      const r = await tryq(`update organizations set ${col} where id = $1`, [orgId]);
      ok(/permission denied/.test(r.err ?? ''), `Fix 2: org owner cannot update ${col.split(' ')[0]} (${r.err})`);
    }

    const editProfile = await tryq(
      `update organizations set name = 'TEST · S0-fix Org Renamed', city = 'Austin', business_type = 'Brand / retailer', website = 'https://example.com' where id = $1`,
      [orgId],
    );
    ok(!editProfile.err && editProfile.n === 1, 'Fix 2: org owner CAN still edit plain profile fields (name, city, business_type, website)');

    await db.query('reset role');
    const checkOrg = await one(`select name, city, kyc_status, credit_eligible from organizations where id = $1`, [orgId]);
    const checkArch = await one(`select archived_at from organizations where id = $1`, [archivedOrgId]);
    ok(
      checkOrg.name === 'TEST · S0-fix Org Renamed' &&
        checkOrg.city === 'Austin' &&
        checkOrg.kyc_status === 'not_started' &&
        checkOrg.credit_eligible === false &&
        checkArch.archived_at !== null,
      'Fix 2: DB confirms name/city updated while kyc_status, credit_eligible, and archived_at remained untouched',
    );
  }

  // ── 5. S1 + Fix 4a + Fix 4b + S4: Trigger, set_org_credit_eligible flag reset, CREDIT_NOT_ELIGIBLE vs NO_CREDIT_TERMS ──
  {
    await db.query('reset role');
    // Set KYC verified via superuser so we test Pay-later flows cleanly
    await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [orgId]);

    // Direct superuser UPDATE of credit_eligible without session flag is rejected
    const directUpd = await tryq(`update organizations set credit_eligible = true where id = $1`, [orgId]);
    ok(/CREDIT_ELIGIBLE_ADMIN_ONLY/.test(directUpd.err ?? ''), 'S1: direct UPDATE on credit_eligible rejected by trigger');

    // When credit_eligible = false -> CREDIT_NOT_ELIGIBLE
    await as(ownerUid, 'aal1');
    const stFalse = (await one(`select get_customer_credit_status($1, null) as s`, [orgId])).s;
    ok(
      stFalse.eligible === false && stFalse.credit_eligible === false && stFalse.reason === 'CREDIT_NOT_ELIGIBLE',
      `S4: credit_eligible=false returns CREDIT_NOT_ELIGIBLE (${JSON.stringify(stFalse)})`,
    );

    const chkFalse = await tryq(`select checkout_pay_later($1, 'sourcing', 'order', $2, 5000, 'USD', 's0-chk-false')`, [
      orgId,
      orderId,
    ]);
    ok(/CREDIT_NOT_ELIGIBLE/.test(chkFalse.err ?? ''), `S4: checkout_pay_later raises CREDIT_NOT_ELIGIBLE when credit_eligible=false`);

    // Admin enables credit_eligible via set_org_credit_eligible
    await as(adminUid, 'aal2');
    const en = await tryq(`select set_org_credit_eligible($1, true, 'Approved group test org')`, [orgId]);
    ok(!en.err, 'S1: Admin set_org_credit_eligible succeeds');

    // Fix 4a: Verify session flag was reset immediately after UPDATE inside set_org_credit_eligible!
    await db.query('reset role');
    const flagAfter = (await one(`select coalesce(current_setting('octopus.allow_credit_eligible_write', true), '') as f`)).f;
    const piggybackUpd = await tryq(`update organizations set credit_eligible = false where id = $1`, [orgId]);
    ok(
      flagAfter === '' && /CREDIT_ELIGIBLE_ADMIN_ONLY/.test(piggybackUpd.err ?? ''),
      'Fix 4a: set_org_credit_eligible resets octopus.allow_credit_eligible_write after UPDATE so subsequent direct UPDATE in same tx is rejected',
    );

    // Fix 4b: When credit_eligible = true but there are NO active terms -> NO_CREDIT_TERMS (not CREDIT_NOT_ELIGIBLE)
    await as(ownerUid, 'aal1');
    const stNoTerms = (await one(`select get_customer_credit_status($1, null) as s`, [orgId])).s;
    ok(
      stNoTerms.eligible === false &&
        stNoTerms.credit_eligible === true &&
        stNoTerms.reason === 'NO_CREDIT_TERMS' &&
        !JSON.stringify(stNoTerms).includes('Ask your account manager'),
      `Fix 4b: credit_eligible=true with no active terms returns NO_CREDIT_TERMS (${JSON.stringify(stNoTerms)})`,
    );

    const chkNoTerms = await tryq(
      `select checkout_pay_later($1, 'sourcing', 'order', $2, 5000, 'USD', 's0-chk-noterms')`,
      [orgId, orderId],
    );
    ok(/NO_CREDIT_TERMS/.test(chkNoTerms.err ?? ''), `Fix 4b: checkout_pay_later raises NO_CREDIT_TERMS when credit_eligible=true and no active terms`);

    // Propose + two-person approve credit terms -> Pay later works
    await as(finMakerUid, 'aal2');
    const termsId = (
      await one(`select propose_customer_credit_terms($1, 100000, 30, null, 'USD', 'Net 30') as id`, [orgId])
    ).id;
    await as(finApproverUid, 'aal2');
    await db.query(`select decide_customer_credit_terms($1, true, '2nd approver ok')`, [termsId]);

    await as(ownerUid, 'aal1');
    const stOk = (await one(`select get_customer_credit_status($1, null) as s`, [orgId])).s;
    const chkOk = await tryq(`select checkout_pay_later($1, 'sourcing', 'order', $2, 5000, 'USD', 's0-chk-ok')`, [
      orgId,
      orderId,
    ]);
    ok(stOk.eligible === true && !chkOk.err, 'S1/S4: active credit terms on credit_eligible=true org succeeds');
  }
} finally {
  await db.query('rollback');
  await db.end();
}

console.log(failed ? `\ns0-fix: ${failed} check(s) failed` : '\ns0-fix: all checks passed');
process.exitCode = failed ? 1 : 0;
