// Step 4 DB & RLS tests (STAGING ONLY, rolled-back transaction).
// Covers:
//  · Correction 2: company_services dropship status = 'on' | 'paused' | 'off' ONLY (no 'trial'); set_company_service maps 'trial' -> 'on'.
//  · Correction 3: saas_billing_settings is the ONLY one, enabled = false, zero writes allowed until Step 12b (even for admin/service_role).
//  · KYC gate: unverified org refused by request_dropship_access (KYC_NOT_VERIFIED) and by decide_dropship_access_request ('approve').
//  · No auto-approval: request_dropship_access stays 'pending'; staff approve/reject requires reason + audit_log + in-app notification only.
//  · Onboarding & seller profile: save_my_dropship_seller_profile -> 'pending'; create_store_order_shipment blocked (SELLER_PROFILE_NOT_APPROVED)
//    until staff approve; editing return address resets status back to 'pending'.
//  · Correction 4: organizations.kyc_status leaving 'verified' auto-pauses dropship ('KYC no longer verified', audit-logged + in-app notification);
//    re-verifying KYC does NOT auto-reactivate; staff reactivate after re-verification.
//  · Correction 1: BOTH 'paused' AND closed ('off' after started_at) block ONLY new activity with DROPSHIP_PAUSED
//    (dropship_import_list insert, new create_dropship_store_order, mark_store_order_paid on unpaid order, create_dropship_sample_order,
//     create_dropship_product_request, respond_dropship_request_quote 'accept'), while orders already paid keep being fulfilled
//    and paused/closed merchants still see orders in progress, wallet, statements/invoices, support, and data export.
//  · Never-enabled org still gets DROPSHIP_NOT_ENABLED (not DROPSHIP_PAUSED).
import pg from 'pg';
import {
  loadStagingEnvOrExit,
  assertStagingDatabase,
} from '../../scripts/lib-staging-guard.mjs';

loadStagingEnvOrExit();

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failed++;
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const tryq = async (sql, params) => {
  await db.query('savepoint s4');
  try {
    const r = await db.query(sql, params);
    await db.query('release savepoint s4');
    return { err: null, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback to savepoint s4');
    return { err: e.message, rows: [], n: 0 };
  }
};

const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', aal }),
  ]);
  await db.query('set local role authenticated');
};
const owner = async () => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '', true)`);
};

try {
  await db.query('begin');

  const ledgerBefore = await one(`
    select coalesce(sum(debit_cents) - sum(credit_cents), 0)::text diff
      from ledger_entries
  `);
  ok(ledgerBefore.diff === '0', `staging ledger balanced before Step 4 tests (diff=${ledgerBefore.diff})`);

  // Staff actors
  const dsStaff = await one(`
    select dm.user_id
      from division_members dm
      join divisions d on d.id = dm.division_id
     where d.code = 'DS' and dm.role in ('manager', 'staff')
     limit 1
  `);
  const adminStaff = await one(`select user_id from user_roles where role_code = 'admin' limit 1`);
  const supportStaff = await one(`
    select ur.user_id
      from user_roles ur
     where ur.role_code = 'support'
       and not exists (select 1 from user_roles ur2 where ur2.user_id = ur.user_id and ur2.role_code in ('admin', 'finance'))
       and not exists (select 1 from division_members dm join divisions d on d.id = dm.division_id where dm.user_id = ur.user_id and d.code = 'DS')
     limit 1
  `);

  // Create fresh test users/orgs inside rolled-back transaction
  const makeCustomer = async (label, kycStatus) => {
    const u = await one(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
       returning id`,
      [`step4.${label}.${Date.now()}@test.octopus.local`],
    );
    await db.query(
      `insert into profiles (id, email, full_name) values ($1, $2, $3) on conflict (id) do nothing`,
      [u.id, `step4.${label}@test.octopus.local`, `Step4 ${label}`],
    );
    const o = await one(
      `insert into organizations (name, country, kyc_status) values ($1, 'AE', $2::kyc_status) returning id, name`,
      [`TEST – Step 4 ${label}`, kycStatus],
    );
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [
      o.id,
      u.id,
    ]);
    return { uid: u.id, orgId: o.id, orgName: o.name };
  };

  const unverifiedCust = await makeCustomer('unverified', 'not_started');
  const verifiedCust = await makeCustomer('verified', 'verified');
  const rejectedCust = await makeCustomer('rejected', 'verified');
  const neverEnabledCust = await makeCustomer('never', 'verified');

  // Assign dsStaff as account manager for verifiedCust to verify in-app notification on request
  await db.query(
    `insert into account_managers (org_id, staff_user_id, reason) values ($1, $2, 'Step 4 test AM') on conflict (org_id) do update set staff_user_id = excluded.staff_user_id`,
    [verifiedCust.orgId, dsStaff.user_id],
  );

  // ── 1. Correction 2: company_services dropship = 'on' | 'paused' | 'off' ONLY (no 'trial') ──
  const badTrialInsert = await tryq(
    `insert into company_services (org_id, service, status) values ($1, 'dropship', 'trial')`,
    [neverEnabledCust.orgId],
  );
  ok(
    /company_services_dropship_no_trial_check/.test(badTrialInsert.err ?? ''),
    `Correction 2: direct 'trial' status on company_services(dropship) is rejected by check constraint`,
  );

  await as(adminStaff.user_id, 'aal2');
  await db.query(`select public.set_company_service($1, 'dropship', 'trial', null)`, [neverEnabledCust.orgId]);
  await owner();
  const mappedRow = await one(
    `select status from company_services where org_id = $1 and service = 'dropship'`,
    [neverEnabledCust.orgId],
  );
  ok(mappedRow?.status === 'on', `Correction 2: set_company_service maps legacy 'trial' -> 'on' (${mappedRow?.status})`);
  // Clean up neverEnabledCust so it remains never-enabled for subsequent tests
  await db.query(`delete from company_services where org_id = $1 and service = 'dropship'`, [neverEnabledCust.orgId]);

  await as(dsStaff.user_id, 'aal2');
  const badSetStatusTrial = await tryq(
    `select public.set_dropship_merchant_status($1, 'trial', 'Should fail')`,
    [verifiedCust.orgId],
  );
  await owner();
  ok(
    /INVALID_STATUS/.test(badSetStatusTrial.err ?? ''),
    `Correction 2: set_dropship_merchant_status refuses 'trial' (${badSetStatusTrial.err})`,
  );

  // ── 2. Correction 3: saas_billing_settings singleton (ONLY table, zero writes until Step 12b) ──
  const saasTables = await all(`
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_name like '%saas%setting%'
  `);
  const saasRow = await one(`select id, enabled, trial_days, grace_days from public.saas_billing_settings where id = 1`);
  const saasWriteOwner = await tryq(`update public.saas_billing_settings set enabled = true where id = 1`);
  await as(adminStaff.user_id, 'aal2');
  const saasWriteAdmin = await tryq(`update public.saas_billing_settings set enabled = true where id = 1`);
  await as(verifiedCust.uid, 'aal1');
  const saasReadCust = await one(`select enabled, trial_days, grace_days from public.saas_billing_settings where id = 1`);
  const saasHiddenCust = await tryq(`select proposed_by from public.saas_billing_settings where id = 1`);
  await owner();
  ok(
    saasTables.length === 1 &&
      saasTables[0].table_name === 'saas_billing_settings' &&
      saasRow.enabled === false &&
      saasRow.trial_days === 30 &&
      saasRow.grace_days === 7 &&
      /SAAS_BILLING_LOCKED/.test(saasWriteOwner.err ?? '') &&
      /permission denied|SAAS_BILLING_LOCKED/.test(saasWriteAdmin.err ?? '') &&
      saasReadCust.enabled === false &&
      /permission denied/.test(saasHiddenCust.err ?? ''),
    `Correction 3: saas_billing_settings is the ONLY one, enabled=false, readable by merchants, and 100% write-locked until Step 12b`,
  );

  // ── 3. KYC gate & Access Request -> Staff Approve / Reject (no auto-approve, reason required, in-app notification) ──
  await as(unverifiedCust.uid, 'aal1');
  const unvReq = await tryq(
    `select public.request_dropship_access('shopify', 'unv.myshopify.com', 'Under 100', array['AE'])`,
  );
  ok(
    /KYC_NOT_VERIFIED/.test(unvReq.err ?? ''),
    `Unverified org cannot request dropship access (${unvReq.err})`,
  );

  await as(verifiedCust.uid, 'aal1');
  const reqRes = (
    await one(
      `select public.request_dropship_access('shopify', 'verified-home.myshopify.com', '100 to 500', array['AE', 'SA']) as r`,
    )
  ).r;
  // Still NOT auto-approved: merchant catalogue MUST still refuse with DROPSHIP_NOT_ENABLED!
  const catBeforeApprove = await tryq(`select * from public.get_dropship_catalogue('AE', null, null, 1)`);
  await owner();

  const amNotif = await all(
    `select id, link from notifications where user_id = $1 and link = '/office/dropship/merchants'`,
    [dsStaff.user_id],
  );
  ok(
    reqRes.ok === true &&
      reqRes.status === 'pending' &&
      /DROPSHIP_NOT_ENABLED/.test(catBeforeApprove.err ?? '') &&
      amNotif.length >= 1,
    `Access request stays 'pending' (never auto-approves), catalogue still refuses DROPSHIP_NOT_ENABLED, and AM gets in-app notification`,
  );

  // Staff decision without reason fails; approving if KYC becomes unverified fails
  await as(dsStaff.user_id, 'aal2');
  const noReasonApprove = await tryq(
    `select public.decide_dropship_access_request($1, 'approve', '   ')`,
    [reqRes.request_id],
  );
  await owner();
  await db.query(`update organizations set kyc_status = 'in_review' where id = $1`, [verifiedCust.orgId]);
  await as(dsStaff.user_id, 'aal2');
  const unvStaffApprove = await tryq(
    `select public.decide_dropship_access_request($1, 'approve', 'Try approve while unverified')`,
    [reqRes.request_id],
  );
  await owner();
  await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [verifiedCust.orgId]);

  await as(dsStaff.user_id, 'aal2');
  const approveRes = (
    await one(
      `select public.decide_dropship_access_request($1, 'approve', 'KYC & Shopify store verified') as r`,
      [reqRes.request_id],
    )
  ).r;
  await owner();

  const csAfterApprove = await one(
    `select status, status_reason, started_at from company_services where org_id = $1 and service = 'dropship'`,
    [verifiedCust.orgId],
  );
  const mktsAfterApprove = await all(
    `select country::text as c from dropship_markets where org_id = $1 order by country`,
    [verifiedCust.orgId],
  );
  const subCount = await one(
    `select count(*)::int as n from saas_subscriptions where org_id = $1`,
    [verifiedCust.orgId],
  );
  const approveAudit = await one(
    `select action from audit_log where entity = 'dropship_access_requests' and entity_id = $1 and action = 'dropship.access_approved'`,
    [reqRes.request_id],
  );
  const approveNotif = await all(
    `select title, link from notifications where org_id = $1 and link = '/account/dropship/onboarding'`,
    [verifiedCust.orgId],
  );
  ok(
    /REASON_REQUIRED/.test(noReasonApprove.err ?? '') &&
      /KYC_NOT_VERIFIED/.test(unvStaffApprove.err ?? '') &&
      approveRes.service_status === 'on' &&
      csAfterApprove.status === 'on' &&
      csAfterApprove.started_at !== null &&
      JSON.stringify(mktsAfterApprove.map((x) => x.c)) === JSON.stringify(['AE', 'SA']) &&
      subCount.n === 0 &&
      !!approveAudit &&
      approveNotif.length === 1,
    `Staff approval requires reason + verified KYC, sets dropship='on', seeds ['AE','SA'], starts 0 trials ($0), logs audit, and sends in-app notification`,
  );

  // Reject flow on rejectedCust
  await as(rejectedCust.uid, 'aal1');
  const rejReq = (
    await one(
      `select public.request_dropship_access('shopify', 'rej.myshopify.com', 'Under 100', array['AE']) as r`,
    )
  ).r;
  await as(dsStaff.user_id, 'aal2');
  const rejDecide = (
    await one(
      `select public.decide_dropship_access_request($1, 'reject', 'Store domain does not resolve') as r`,
      [rejReq.request_id],
    )
  ).r;
  await as(rejectedCust.uid, 'aal1');
  const rejCat = await tryq(`select * from public.get_dropship_catalogue('AE', null, null, 1)`);
  await owner();
  ok(
    rejDecide.status === 'rejected' &&
      rejDecide.service_status === 'off' &&
      /DROPSHIP_NOT_ENABLED/.test(rejCat.err ?? ''),
    `Rejected org stays 'off' and still gets DROPSHIP_NOT_ENABLED (never DROPSHIP_PAUSED since never enabled)`,
  );

  // ── 4. Onboarding Seller Profile & Label Block (SELLER_PROFILE_NOT_APPROVED) ──
  await as(verifiedCust.uid, 'aal1');
  const onbState = (await one(`select public.get_my_dropship_onboarding_state() as s`)).s;
  const profSave = (
    await one(
      `select public.save_my_dropship_seller_profile(
         'Verified Home Brand',
         'Returns Desk',
         'Warehouse 4, Al Quoz',
         null,
         'Dubai',
         'Dubai',
         '00000',
         'United Arab Emirates'
       ) as r`,
    )
  ).r;
  await owner();
  ok(
    onbState.saas_billing.enabled === false && profSave.status === 'pending',
    `Onboarding state shows saas_billing.enabled=false and save_my_dropship_seller_profile sets status='pending'`,
  );

  // Fund verifiedCust wallet ($200 = 20000¢), ensure 3PL stock for DS-000001, create 2 paid store orders + 1 sample + 1 request + 1 statement!
  await db.query(
    `select post_journal('Step 4 topup $200', jsonb_build_array(
       jsonb_build_object('account', ledger_account(acct_code('bank:clearing', 'USD'), 'Clearing', 'asset', null, 'USD'), 'debit', 20000, 'credit', 0),
       jsonb_build_object('account', wallet_account($1, 'USD'), 'debit', 0, 'credit', 20000, 'org', $1)
     ), 's4_topup_ver', 'topup', 'organization', $1)`,
    [verifiedCust.orgId],
  );

  const prod1 = await one(`select id, model_no from dropship_products where model_no = 'DS-000001'`);
  const var1 = await one(`select id, item_id from dropship_variants where product_id = $1 order by sort limit 1`, [prod1.id]);
  await db.query(
    `select record_warehouse_stock_movement($1, 'inbound', 30, 'Step 4 inbound', 'SZ-01', null)`,
    [var1.item_id],
  );

  await as(verifiedCust.uid, 'aal1');
  const order1 = (
    await one(
      `select public.create_dropship_store_order(
         $1, 'shopify', 'S4-ORD-1', '#4001', 'Buyer One', '+971500000111',
         '{"line1":"1 Palm","city":"Dubai","country":"AE"}'::jsonb,
         'AE', 'USD', null, 'standard', 'DDP',
         $2::jsonb, true
       ) as r`,
      [verifiedCust.orgId, JSON.stringify([{ variant_id: var1.id, qty: 1, buyer_unit_price_cents: 2500 }])],
    )
  ).r;
  await db.query(`select public.mark_store_order_paid($1)`, [order1.store_order_id]);

  const order2 = (
    await one(
      `select public.create_dropship_store_order(
         $1, 'shopify', 'S4-ORD-2', '#4002', 'Buyer Two', '+971500000222',
         '{"line1":"2 Palm","city":"Dubai","country":"AE"}'::jsonb,
         'AE', 'USD', null, 'standard', 'DDP',
         $2::jsonb, true
       ) as r`,
      [verifiedCust.orgId, JSON.stringify([{ variant_id: var1.id, qty: 1, buyer_unit_price_cents: 2500 }])],
    )
  ).r;
  await db.query(`select public.mark_store_order_paid($1)`, [order2.store_order_id]);

  const orderUnpaid = (
    await one(
      `select public.create_dropship_store_order(
         $1, 'shopify', 'S4-ORD-UNPAID', '#4003', 'Buyer Three', '+971500000333',
         '{"line1":"3 Palm","city":"Dubai","country":"AE"}'::jsonb,
         'AE', 'USD', null, 'standard', 'DDP',
         $2::jsonb, true
       ) as r`,
      [verifiedCust.orgId, JSON.stringify([{ variant_id: var1.id, qty: 1, buyer_unit_price_cents: 2500 }])],
    )
  ).r;

  const sample1 = (
    await one(
      `select public.create_dropship_sample_order($1, 1, 'AE', 'standard', 'Founder', '+971500000444', '{"line1":"Office 9","city":"Dubai"}'::jsonb, 's4_sample_1', null, true) as r`,
      [var1.id],
    )
  ).r;

  const reqQuote = (
    await one(
      `select public.create_dropship_product_request('Step 4 Ceramic Mug', null, 'Home', 800, '50 to 200', array['AE'], false, null, '{}'::text[], 's4_req_1') as r`,
    )
  ).r;
  await as(dsStaff.user_id, 'aal2');
  await db.query(`select public.set_dropship_request_landed_quote($1, 950, 'AE')`, [reqQuote.rfq_id]);

  // Try creating shipment label BEFORE seller profile is approved -> MUST fail with SELLER_PROFILE_NOT_APPROVED!
  const blockedLabel = await tryq(
    `select public.create_store_order_shipment($1, 'yunexpress', 'AE-STD', 'YT-S4-BLOCK', 0.5, 420, 'label_ready')`,
    [order1.store_order_id],
  );
  ok(
    /SELLER_PROFILE_NOT_APPROVED/.test(blockedLabel.err ?? ''),
    `Label creation is refused while dropship_seller_profiles.status = 'pending' (${blockedLabel.err})`,
  );

  // Staff approves seller profile (with internal note); verify Support sees review_note = null!
  await db.query(
    `select public.review_dropship_merchant_profile($1, 'approved', 'Return address verified', 'Internal: checked trade licence address')`,
    [verifiedCust.orgId],
  );
  if (supportStaff?.user_id) {
    await as(supportStaff.user_id, 'aal2');
    const supList = (await one(`select public.list_dropship_merchants_staff() as r`)).r;
    const supMerch = (supList.merchants ?? []).find((m) => m.org_id === verifiedCust.orgId);
    ok(
      supMerch?.seller_profile?.review_note === null && supList.can_propose_wallet_adjustment === false,
      `Support sees redacted seller_profile.review_note=null and can_propose_wallet_adjustment=false`,
    );
  }

  // Test profile reset on edit, then re-approve for fulfilment tests
  await as(verifiedCust.uid, 'aal1');
  const editedProf = (
    await one(
      `select public.save_my_dropship_seller_profile(
         'Verified Home Brand',
         'Returns Desk',
         'Warehouse 8, Al Quoz',
         null,
         'Dubai',
         'Dubai',
         '00000',
         'United Arab Emirates'
       ) as r`,
    )
  ).r;
  await as(dsStaff.user_id, 'aal2');
  await db.query(
    `select public.review_dropship_merchant_profile($1, 'approved', 'Updated return address verified', null)`,
    [verifiedCust.orgId],
  );
  await owner();
  ok(editedProf.status === 'pending', `Editing return address resets seller profile back to 'pending' until re-approved`);

  // Generate STMT-DS statement and open a support ticket while active
  const stmt = (
    await one(
      `select public.generate_dropship_weekly_statement($1, now() - interval '1 hour', now() + interval '1 minute') as r`,
      [verifiedCust.orgId],
    )
  ).r;
  await as(verifiedCust.uid, 'aal1');
  const ticketIns = await one(
    `select public.create_ticket('Step 4 order question', 'orders', 'Checking tracking status') as id`,
  );
  await owner();
  const wdIns = await one(
    `insert into wallet_withdrawals (org_id, amount_cents, currency, bank_details, status, created_by)
     values ($1, 1000, 'USD', '{"bank":"Emirates NBD"}'::jsonb, 'requested', $2)
     returning id`,
    [verifiedCust.orgId, verifiedCust.uid],
  );

  // ── 5. Correction 4: KYC leaving 'verified' auto-pauses dropship ('KYC no longer verified', audit + in-app notification) ──
  await db.query(`update organizations set kyc_status = 'more_info' where id = $1`, [verifiedCust.orgId]);
  const csAutoPaused = await one(
    `select status, status_reason from company_services where org_id = $1 and service = 'dropship'`,
    [verifiedCust.orgId],
  );
  const kycPauseAudit = await one(
    `select action, details from audit_log where org_id = $1 and action = 'dropship.auto_paused_kyc' order by id desc limit 1`,
    [verifiedCust.orgId],
  );
  const kycPauseNotif = await all(
    `select title, link from notifications where org_id = $1 and link = '/account/kyc'`,
    [verifiedCust.orgId],
  );

  // Staff cannot reactivate before KYC is re-verified
  await as(dsStaff.user_id, 'aal2');
  const prematureReactivate = await tryq(
    `select public.set_dropship_merchant_status($1, 'on', 'Try reactivate before KYC')`,
    [verifiedCust.orgId],
  );
  await owner();

  // Re-verifying KYC does NOT auto-reactivate; stays 'paused' until staff reactivate!
  await db.query(`update organizations set kyc_status = 'verified' where id = $1`, [verifiedCust.orgId]);
  const csStillPausedAfterKyc = await one(
    `select status from company_services where org_id = $1 and service = 'dropship'`,
    [verifiedCust.orgId],
  );
  ok(
    csAutoPaused.status === 'paused' &&
      csAutoPaused.status_reason === 'KYC no longer verified' &&
      kycPauseAudit?.details?.reason === 'KYC no longer verified' &&
      kycPauseNotif.length >= 1 &&
      /KYC_NOT_VERIFIED/.test(prematureReactivate.err ?? '') &&
      csStillPausedAfterKyc.status === 'paused',
    `Correction 4: KYC leaving 'verified' auto-pauses dropship ('KYC no longer verified', audit + in-app notification), blocks premature reactivation, and waits for staff after re-verification`,
  );

  // ── 6. Correction 1a: Test PAUSED state — blocks new activity with DROPSHIP_PAUSED; allows ongoing orders, fulfilment, wallet, statements, support ──
  await as(verifiedCust.uid, 'aal1');
  const pausedBlocked = [
    [
      'import_list_insert',
      await tryq(`insert into dropship_import_list (org_id, product_id, variant_id) values ($1, $2, $3)`, [
        verifiedCust.orgId,
        prod1.id,
        var1.id,
      ]),
    ],
    [
      'new_store_order',
      await tryq(
        `select public.create_dropship_store_order($1, 'shopify', 'S4-PAUSED-NEW', '#4099', 'B', '+971500000', '{"line1":"1 St","city":"Dubai"}'::jsonb, 'AE', 'USD', null, 'standard', 'DDP', $2::jsonb, true)`,
        [verifiedCust.orgId, JSON.stringify([{ variant_id: var1.id, qty: 1, buyer_unit_price_cents: 2500 }])],
      ),
    ],
    ['charge_unpaid_order', await tryq(`select public.mark_store_order_paid($1)`, [orderUnpaid.store_order_id])],
    [
      'sample_order',
      await tryq(
        `select public.create_dropship_sample_order($1, 1, 'AE', 'standard', 'Founder', '+971500000', '{"line1":"1 St","city":"Dubai"}'::jsonb, 's4_paused_smp')`,
        [var1.id],
      ),
    ],
    [
      'product_request',
      await tryq(
        `select public.create_dropship_product_request('Blocked while paused', null, null, null, null, array['AE'], false, null, '{}'::text[], 's4_paused_req')`,
      ),
    ],
    [
      'accept_request_quote',
      await tryq(`select public.respond_dropship_request_quote($1, 'accept')`, [reqQuote.rfq_id]),
    ],
  ];
  ok(
    pausedBlocked.every(([, r]) => /DROPSHIP_PAUSED/.test(r.err ?? '')),
    `Correction 1 (PAUSED): all ${pausedBlocked.length} new-activity actions fail with DROPSHIP_PAUSED (${pausedBlocked.map(([k]) => k).join(', ')})`,
  );

  // Fulfil order1 while merchant is PAUSED, and verify paused merchant still sees orders, samples, requests, wallet, statement & support!
  await as(dsStaff.user_id, 'aal2');
  const shipWhilePaused = (
    await one(
      `select public.create_store_order_shipment($1, 'yunexpress', 'AE-STD', 'YT-S4-PAUSED-1', 0.5, 420, 'in_transit') as r`,
      [order1.store_order_id],
    )
  ).r;
  await as(verifiedCust.uid, 'aal1');
  const pausedOrders = await all(`select id, merchant_status from store_orders where org_id = $1`, [verifiedCust.orgId]);
  const pausedSamples = await all(`select * from public.list_my_dropship_sample_orders(null)`);
  const pausedRequests = await all(`select * from public.list_my_dropship_requests()`);
  const pausedWallet = (await one(`select my_wallet_summary() as w`)).w;
  const pausedWithdrawals = await all(`select id, status from wallet_withdrawals where id = $1`, [wdIns.id]);
  const pausedStmt = await all(`select id, number from documents where id = $1`, [stmt.statement_id]);
  const pausedTickets = await all(`select id from tickets where id = $1`, [ticketIns.id]);
  const pausedNewTicket = (
    await one(`select public.create_ticket('Question while paused', 'orders', 'Still works') as id`)
  ).id;
  const pausedExport = (await one(`select public.export_my_dropship_data() as d`)).d;
  ok(
    !!shipWhilePaused.shipment_id &&
      pausedOrders.some((o) => o.id === order1.store_order_id && o.merchant_status === 'shipped') &&
      pausedSamples.some((s) => s.store_order_id === sample1.store_order_id) &&
      pausedRequests.some((r) => r.rfq_id === reqQuote.rfq_id) &&
      Number(pausedWallet.available_cents) > 0 &&
      pausedWithdrawals.length === 1 &&
      pausedStmt.length === 1 &&
      pausedTickets.length === 1 &&
      !!pausedNewTicket &&
      pausedExport?.service?.status === 'paused' &&
      Array.isArray(pausedExport?.store_orders) &&
      pausedExport.store_orders.length >= 2,
    `Correction 1 (PAUSED): order1 ships while merchant is paused, and paused merchant still accesses orders (${pausedOrders.length}), samples, requests, wallet (${pausedWallet.available_cents}¢), withdrawals, statement (${stmt.number}), support, and data export`,
  );

  // Staff reactivates after KYC re-verification, then CLOSES ('off') to test CLOSED state!
  await as(dsStaff.user_id, 'aal2');
  const reactivated = (
    await one(`select public.set_dropship_merchant_status($1, 'on', 'KYC re-verified by compliance') as r`, [
      verifiedCust.orgId,
    ])
  ).r;
  const closed = (
    await one(`select public.set_dropship_merchant_status($1, 'off', 'Merchant requested account closure') as r`, [
      verifiedCust.orgId,
    ])
  ).r;
  ok(reactivated.status === 'on' && closed.status === 'off', `Staff reactivates merchant ('on') and closes merchant ('off') with required reasons`);

  // ── 7. Correction 1b: Test CLOSED ('off' after started_at) state — blocks new activity with DROPSHIP_PAUSED; allows ongoing orders, fulfilment, wallet, statements, support ──
  await as(verifiedCust.uid, 'aal1');
  const closedBlocked = [
    [
      'import_list_insert',
      await tryq(`insert into dropship_import_list (org_id, product_id, variant_id) values ($1, $2, $3)`, [
        verifiedCust.orgId,
        prod1.id,
        var1.id,
      ]),
    ],
    [
      'new_store_order',
      await tryq(
        `select public.create_dropship_store_order($1, 'shopify', 'S4-CLOSED-NEW', '#4100', 'B', '+971500000', '{"line1":"1 St","city":"Dubai"}'::jsonb, 'AE', 'USD', null, 'standard', 'DDP', $2::jsonb, true)`,
        [verifiedCust.orgId, JSON.stringify([{ variant_id: var1.id, qty: 1, buyer_unit_price_cents: 2500 }])],
      ),
    ],
    ['charge_unpaid_order', await tryq(`select public.mark_store_order_paid($1)`, [orderUnpaid.store_order_id])],
    [
      'sample_order',
      await tryq(
        `select public.create_dropship_sample_order($1, 1, 'AE', 'standard', 'Founder', '+971500000', '{"line1":"1 St","city":"Dubai"}'::jsonb, 's4_closed_smp')`,
        [var1.id],
      ),
    ],
    [
      'product_request',
      await tryq(
        `select public.create_dropship_product_request('Blocked while closed', null, null, null, null, array['AE'], false, null, '{}'::text[], 's4_closed_req')`,
      ),
    ],
    [
      'accept_request_quote',
      await tryq(`select public.respond_dropship_request_quote($1, 'accept')`, [reqQuote.rfq_id]),
    ],
  ];
  ok(
    closedBlocked.every(([, r]) => /DROPSHIP_PAUSED/.test(r.err ?? '')),
    `Correction 1 (CLOSED): all ${closedBlocked.length} new-activity actions fail with DROPSHIP_PAUSED (${closedBlocked.map(([k]) => k).join(', ')})`,
  );

  // Fulfil order2 while merchant is CLOSED ('off'), and verify closed merchant still sees orders, samples, requests, wallet, statement & support!
  await as(dsStaff.user_id, 'aal2');
  const shipWhileClosed = (
    await one(
      `select public.create_store_order_shipment($1, 'yunexpress', 'AE-STD', 'YT-S4-CLOSED-2', 0.5, 420, 'in_transit') as r`,
      [order2.store_order_id],
    )
  ).r;
  await as(verifiedCust.uid, 'aal1');
  const closedOrders = await all(`select id, merchant_status from store_orders where org_id = $1`, [verifiedCust.orgId]);
  const closedSamples = await all(`select * from public.list_my_dropship_sample_orders(null)`);
  const closedRequests = await all(`select * from public.list_my_dropship_requests()`);
  const closedWallet = (await one(`select my_wallet_summary() as w`)).w;
  const closedWithdrawals = await all(`select id, status from wallet_withdrawals where id = $1`, [wdIns.id]);
  const closedStmt = await all(`select id, number from documents where id = $1`, [stmt.statement_id]);
  const closedTickets = await all(`select id from tickets where id = $1`, [ticketIns.id]);
  const closedNewTicket = (
    await one(`select public.create_ticket('Question while closed', 'orders', 'Still works') as id`)
  ).id;
  const closedExport = (await one(`select public.export_my_dropship_data() as d`)).d;
  ok(
    !!shipWhileClosed.shipment_id &&
      closedOrders.some((o) => o.id === order2.store_order_id && o.merchant_status === 'shipped') &&
      closedSamples.length >= 1 &&
      closedRequests.length >= 1 &&
      Number(closedWallet.available_cents) > 0 &&
      closedWithdrawals.length === 1 &&
      closedStmt.length === 1 &&
      closedTickets.length === 1 &&
      !!closedNewTicket &&
      closedExport?.service?.status === 'off' &&
      Array.isArray(closedExport?.store_orders) &&
      closedExport.store_orders.length >= 2,
    `Correction 1 (CLOSED): order2 ships while merchant is closed, and closed merchant still accesses orders (${closedOrders.length}), samples, requests, wallet, withdrawals, statement, support, and data export`,
  );

  // Verify never-enabled org still gets DROPSHIP_NOT_ENABLED (NOT DROPSHIP_PAUSED)
  await as(neverEnabledCust.uid, 'aal1');
  const neverSmp = await tryq(
    `select public.create_dropship_sample_order($1, 1, 'AE', 'standard', 'No DS', '+971500', '{"line1":"1 St","city":"Dubai"}'::jsonb, 's4_never')`,
    [var1.id],
  );
  ok(
    /DROPSHIP_NOT_ENABLED/.test(neverSmp.err ?? '') && !/DROPSHIP_PAUSED/.test(neverSmp.err ?? ''),
    `Never-enabled org still gets DROPSHIP_NOT_ENABLED (${neverSmp.err})`,
  );

  await owner();
  await db.query('set constraints all immediate');
  const ledgerAfter = await one(`
    select coalesce(sum(debit_cents) - sum(credit_cents), 0)::text diff
      from ledger_entries
  `);
  ok(ledgerAfter.diff === '0', `double-entry ledger remains strictly balanced (diff=${ledgerAfter.diff})`);

  await db.query('rollback');
} finally {
  await db.end();
}

if (failed > 0) {
  console.error(`\n✘ ${failed} Step 4 test(s) failed`);
  process.exit(1);
}
console.log('\nstep4 db tests: all passed');
