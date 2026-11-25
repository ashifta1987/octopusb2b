// Release 1 · EA-1 (staff half of Step 6b) DB checks — migration 221. STAGING ONLY, one rolled-back transaction.
//  Fees: proposer cannot activate; a second Finance approver activates; reject needs a reason; Support reads history,
//        cannot propose / activate / reject.
//  Rate cards: proposals (CSV / one card) publish only after a second person approves; staff cannot publish directly;
//        preview classifies rows; invalid rows / unticked changes refused; stale proposals refused; test quote with billed
//        weight; deactivate needs a reason. Finance views; Support and customers have no access.
//  Customs value policy: versioned, two-person; data completeness counts.
//  Duty: entries start needs_data with empty rates; confirm needs rates + source; submit refused while any entry is
//        open; publish refused for the same person and before submit; a second person publishes; editing resets submit.
//        Support reads versions but cannot edit. Customers get nothing.
//  EA-1 extras: weighing tolerance on fee versions; fuel surcharge applied to carrier quotes; US has no de minimis.
// Run: node --env-file=.env.staging supabase/tests/step6b.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
const as = async (uid, aal = 'aal2') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
  await db.query('set local role authenticated');
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};

try {
  await db.query('begin');
  const mkUser = async (tag, role = null, divs = []) => {
    const email = `s6b-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `S6B ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    for (const [code, r] of divs) await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of($2), $3)`, [id, code, r]);
    return id;
  };
  const wh = await mkUser('wh', 'warehouse', [['3PL', 'manager']]);
  const fin1 = await mkUser('fin1', 'finance');
  const fin2 = await mkUser('fin2', 'finance');
  const ds = await mkUser('ds', 'operations', [['DS', 'staff']]);
  const support = await mkUser('support', 'support');
  const cust = await mkUser('cust');
  const org = (await one(`insert into organizations(name, country, is_seed) values ('TEST S6B Customer', 'AE', true) returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, cust]);
  await db.query(`insert into carriers(code, name, active) values ('s6btest', 'S6B Test Carrier', true) on conflict (code) do nothing`);
  const auditBefore = Number((await one(`select count(*) n from audit_log where action like 'fee_version.%' or action like 'shipping_rate_card.%' or action like 'duty_rate_%' or action like 'customs_policy.%'`)).n);

  // ── Fees ──
  await as(wh);
  const badTol = await tryq(`select propose_fee_version(130, 45, 20, 0, 0, 'bad', 50, 150, 7)`);
  const fv = (await one(`select propose_fee_version(130, 45, 20, 0, 0, 'S6B proposal', 50, 10, 7, 35) id`)).id;
  await as(wh);
  const selfAct = await tryq(`select activate_fee_version($1)`, [fv]);
  await as(support);
  const supProp = await tryq(`select propose_fee_version(1, 1, 0, 0, 0, 'x')`);
  const supAct = await tryq(`select activate_fee_version($1)`, [fv]);
  const supRej = await tryq(`select reject_fee_version($1, 'no')`, [fv]);
  const supList = await tryq(`select * from list_fee_versions()`);
  await as(cust, 'aal1');
  const custList = await tryq(`select * from list_fee_versions()`);
  await as(fin1);
  const noReason = await tryq(`select reject_fee_version($1, '  ')`, [fv]);
  const act = (await one(`select activate_fee_version($1, 'S6B approved') r`, [fv])).r;
  const fv2 = (await one(`select propose_fee_version(140, 50, 20, 0, 0, 'S6B second') id`)).id;
  await as(fin2);
  const rej = (await one(`select reject_fee_version($1, 'Too high') r`, [fv2])).r;
  const hist = (await all(`select * from list_fee_versions()`)).filter((r) => [fv, fv2].includes(r.id));
  await owner();
  ok(/TWO_PERSON_REQUIRED|FORBIDDEN/.test(selfAct.err ?? ''), `Fees: the proposer cannot activate their own version (${(selfAct.err ?? 'ALLOWED').slice(0, 60)})`);
  ok(act.activated_id === fv && rej.rejected_id === fv2 && /REASON_REQUIRED/.test(noReason.err ?? '') &&
    hist.find((h) => h.id === fv)?.status === 'active' && hist.find((h) => h.id === fv)?.approved_by_name === 'S6B fin1' &&
    hist.find((h) => h.id === fv2)?.status === 'rejected' &&
    hist.find((h) => h.id === fv)?.weigh_tolerance_g === 50 && Number(hist.find((h) => h.id === fv)?.weigh_tolerance_pct) === 10 &&
    hist.find((h) => h.id === fv)?.dispute_window_days === 7 && Number(hist.find((h) => h.id === fv)?.branded_packaging_cents) === 35 &&
    hist.find((h) => h.id === fv2)?.branded_packaging_cents === null && /INVALID_FEE_VERSION/.test(badTol.err ?? ''),
    'Fees: a second Finance approver activates; reject needs a reason; history shows status, names and tolerance (50 g / 10 % / 7 days); bad tolerance refused');
  ok(/FORBIDDEN/.test(supProp.err ?? '') && /FORBIDDEN/.test(supAct.err ?? '') && /FORBIDDEN/.test(supRej.err ?? '') && !supList.err && supList.rows.length > 0 && /FORBIDDEN/.test(custList.err ?? ''),
    'Fees: Support reads the history but cannot propose / activate / reject; customers FORBIDDEN');

  // ── Rate cards (design v2: proposals + second-person approval; staff never publish directly) ──
  const row = (o = {}) => ({ carrier_code: 's6btest', method: 'express', carrier_service_code: 'S6B-EX', service_label: 'S6B Express', country: 'AE',
    base_cents: 500, per_100g_cents: 80, step_g: 100, max_weight_g: 30000, volumetric_divisor: 5000, days_min: 3, days_max: 6,
    allows_battery: false, allows_liquid: false, allows_magnet: false, allows_powder: false, ...o });
  const save = (id, rows, keys = [], submit = true, errors = []) => one(
    `select save_rate_card_import($1, 'csv', 's6b-prices.csv', '{}'::jsonb, $2::jsonb, $3::jsonb, $4::text[], $5, null, $6) r`,
    [id, JSON.stringify(rows), JSON.stringify(errors), keys, rows.length + errors.length, submit]).then((x) => x.r);
  const trySave = (id, rows, keys = [], submit = true) => tryq(
    `select save_rate_card_import($1, 'csv', 's6b-prices.csv', '{}'::jsonb, $2::jsonb, '[]'::jsonb, $3::text[], $4, null, $5) r`,
    [id, JSON.stringify(rows), keys, rows.length, submit]);
  const countCards = async () => { await owner(); return Number((await one(`select count(*) n from shipping_rate_cards where carrier_code = 's6btest'`)).n); };

  await as(wh);
  const imp1 = await save(null, [row(), row({ method: 'standard', carrier_service_code: 'S6B-ST' })]);
  const selfApprove = await tryq(`select approve_rate_card_import($1)`, [imp1.id]);
  const directPublish = await tryq(`select publish_shipping_rate_card('s6btest', 'economy', 'S6B-EC', 'AE', 1, 1, 3, 6)`);
  const cardsWhilePending = await countCards();
  await as(ds);
  const appr1 = (await one(`select approve_rate_card_import($1) r`, [imp1.id])).r;
  await as(wh);
  const prev = await all(`select * from preview_shipping_rate_card_import($1::jsonb)`, [JSON.stringify([
    row(),                                              // unchanged
    row({ method: 'standard', carrier_service_code: 'S6B-ST', base_cents: 650 }), // changed
    row({ country: 'SA', carrier_service_code: 'S6B-EX-SA' }), // new
    row({ country: 'Saudi' }),                          // invalid country
    row({ carrier_code: 'nope' }),                      // unknown carrier
    row({ days_min: 7, days_max: 3, country: 'KW' }),   // bad days
    row({ base_cents: 'abc', country: 'QA' }),          // not a number
  ])]);
  const countBefore = await countCards();
  await as(wh);
  const badSave = await trySave(null, [row({ country: 'Saudi' })]);
  const unticked = await trySave(null, [row({ base_cents: 999 }), row({ country: 'SA', carrier_service_code: 'S6B-EX-SA' })]);
  const draft = await save(null, [row({ base_cents: 999 }), row({ country: 'SA', carrier_service_code: 'S6B-EX-SA' })], [], false,
    [{ row_no: 3, reason: 'Country must be a 2-letter ISO code', raw: { country: 'Saudi' } }]);
  const countAfterRefused = await countCards();
  await as(ds);
  const otherDelete = await tryq(`select delete_rate_card_import($1)`, [draft.id]);
  await as(wh);
  const imp2 = await save(draft.id, [row({ base_cents: 999 }), row({ country: 'SA', carrier_service_code: 'S6B-EX-SA' })], ['s6btest|express|AE'], true);
  await as(ds);
  const rcNoReason = await tryq(`select reject_rate_card_import($1, ' ')`, [imp2.id]);
  const appr2 = (await one(`select approve_rate_card_import($1) r`, [imp2.id])).r;
  const listWh = await all(`select * from list_shipping_rate_cards(true) where carrier_code = 's6btest' and country = 'AE' and method = 'express' order by version`);
  // fuel surcharge 10 % + remote-area fee on a new KW lane, then quote it
  await as(wh);
  const impKw = await save(null, [row({ country: 'KW', carrier_service_code: 'S6B-EX-KW', base_cents: 1000, per_100g_cents: 100, fuel_surcharge_bp: 1000, remote_area_fee_cents: 1500 })]);
  const badFuel = await tryq(`select * from preview_shipping_rate_card_import($1::jsonb)`, [JSON.stringify([row({ country: 'OM', carrier_service_code: 'S6B-EX-OM', fuel_surcharge_bp: 20000 })])]);
  // stale proposal: OM proposed twice; the second is approved first, so the first would now replace an unticked card
  const impOmA = await save(null, [row({ country: 'OM', carrier_service_code: 'S6B-EX-OM', base_cents: 700 })]);
  const impOmB = await save(null, [row({ country: 'OM', carrier_service_code: 'S6B-EX-OM', base_cents: 800 })]);
  await as(ds);
  await db.query(`select approve_rate_card_import($1)`, [impKw.id]);
  await db.query(`select approve_rate_card_import($1)`, [impOmB.id]);
  const stale = await tryq(`select approve_rate_card_import($1)`, [impOmA.id]);
  const rejOm = (await one(`select reject_rate_card_import($1, 'Superseded by the newer price list') r`, [impOmA.id])).r;
  const kwQuote = await tryq(`select price_cents from quote_carrier_rates('s6btest', 'KW', 500, 1)`);
  const kwCard = await tryq(`select fuel_surcharge_bp, remote_area_fee_cents, proposed_by_name, approved_by_name from list_shipping_rate_cards(false) where carrier_code = 's6btest' and country = 'KW'`);
  const omCard = (await all(`select id from list_shipping_rate_cards(false) where carrier_code = 's6btest' and country = 'OM'`))[0];
  const deactNoReason = await tryq(`select deactivate_shipping_rate_card($1, null)`, [omCard?.id]);
  const deact = await tryq(`select deactivate_shipping_rate_card($1, 'Carrier stopped this lane')`, [omCard?.id]);
  await as(fin1);
  const finCards = await tryq(`select count(*)::int n from list_shipping_rate_cards(false)`);
  const finImports = await tryq(`select count(*)::int n from list_rate_card_imports()`);
  const finSave = await trySave(null, [row({ country: 'BH', carrier_service_code: 'S6B-EX-BH' })]);
  // 22×16×11 cm ÷ 5000 = 0.775 kg → billed 800 g (higher than 500 g actual); 1000 + 8 × 100 = 1800; +10 % fuel = 1980
  const tq = await tryq(`select * from test_rate_card_quote('KW', 'express', 500, 22, 16, 11)`);
  await as(support);
  const supCards = await tryq(`select * from list_shipping_rate_cards(false)`);
  const supImports = await tryq(`select * from list_rate_card_imports()`);
  const supSave = await trySave(null, [row({ country: 'BH', carrier_service_code: 'S6B-EX-BH' })]);
  const supQuote = await tryq(`select * from test_rate_card_quote('KW', 'express', 500)`);
  await as(cust, 'aal1');
  const custCards = await tryq(`select * from list_shipping_rate_cards(false)`);
  const custImports = await tryq(`select * from list_rate_card_imports()`);
  await owner();
  const impRows = await all(`select id, status, decided_by, counts, errors from rate_card_imports where id = any($1::uuid[])`, [[imp1.id, imp2.id, impOmA.id]]);
  const actions = prev.map((p) => p.action).join(',');
  ok(imp1.status === 'pending_approval' && /TWO_PERSON_REQUIRED/.test(selfApprove.err ?? '') && /permission denied/.test(directPublish.err ?? '') &&
    cardsWhilePending === 0 && appr1.new === 2,
    `Rate cards: a proposal publishes nothing until a second person approves; the proposer can't approve; staff can't publish directly (${(directPublish.err ?? 'ALLOWED').slice(0, 40)})`);
  ok(actions === 'unchanged,changed,new,invalid,invalid,invalid,invalid' &&
    prev[1].changes.base_cents?.from === 500 && prev[1].changes.base_cents?.to === 650 && prev[1].current_version === 1,
    `Rate cards: preview classifies rows without writing (${actions}) and shows the field change (base 500 → 650, v1)`);
  ok(/IMPORT_INVALID/.test(badSave.err ?? '') && /IMPORT_UNCONFIRMED_CHANGES/.test(unticked.err ?? '') && draft.status === 'draft' &&
    draft.changed === 1 && draft.new === 1 && draft.errors === 1 && draft.rows_in_file === 3 && countAfterRefused === countBefore &&
    /IMPORT_NOT_DRAFT/.test(otherDelete.err ?? ''),
    'Rate cards: invalid rows and unticked changes are refused; a draft keeps counts (1 new, 1 changed, 1 error of 3) and writes no card; only the owner deletes a draft');
  ok(imp2.status === 'pending_approval' && /REASON_REQUIRED/.test(rcNoReason.err ?? '') && appr2.replaced === 1 && appr2.new === 1 &&
    listWh.length === 2 && listWh[0].active === false && listWh[1].active === true && Number(listWh[1].base_cents) === 999 &&
    listWh[1].version === 2 && listWh[1].proposed_by_name === 'S6B wh' && listWh[1].approved_by_name === 'S6B ds',
    'Rate cards: a ticked change replaces the active card with version 2 after approval (old kept inactive; proposer and approver recorded)');
  ok(/IMPORT_STALE/.test(stale.err ?? '') && rejOm.status === 'rejected' && impRows.find((r) => r.id === impOmA.id)?.status === 'rejected',
    `Rate cards: a proposal that would now replace an unticked card is refused at approval (${(stale.err ?? 'ALLOWED').slice(0, 50)}) and can be rejected with a reason`);
  // 500 g, step 100 → 1000 + 5 × 100 = 1500; +10 % fuel = 1650
  ok(!kwQuote.err && Number(kwQuote.rows[0]?.price_cents) === 1650 && kwCard.rows[0]?.fuel_surcharge_bp === 1000 &&
    Number(kwCard.rows[0]?.remote_area_fee_cents) === 1500 && badFuel.rows[0]?.action === 'invalid',
    `Rate cards: fuel surcharge 10 % is added to the carrier quote (US$ 15.00 → ${kwQuote.rows[0]?.price_cents}c); remote-area fee stored; fuel over 100 % refused${kwQuote.err ? ' — ' + kwQuote.err : ''}`);
  ok(!tq.err && tq.rows[0]?.box_weight_g === 775 && tq.rows[0]?.billed_weight_g === 800 && Number(tq.rows[0]?.price_cents) === 1980 &&
    tq.rows[0]?.remote_area_fee_may_apply === true && tq.rows[0]?.over_max === false,
    `Rate cards: test quote uses billed weight = max(actual, box ÷ 5000) rounded up to 100 g (775 g → 800 g → ${tq.rows[0]?.price_cents}c)${tq.err ? ' — ' + tq.err : ''}`);
  ok(/REASON_REQUIRED/.test(deactNoReason.err ?? '') && !deact.err,
    'Rate cards: deactivating needs a reason');
  ok(!finCards.err && !finImports.err && /FORBIDDEN/.test(finSave.err ?? '') &&
    /FORBIDDEN/.test(supCards.err ?? '') && /FORBIDDEN/.test(supImports.err ?? '') && /FORBIDDEN/.test(supSave.err ?? '') && /FORBIDDEN/.test(supQuote.err ?? '') &&
    /FORBIDDEN/.test(custCards.err ?? '') && /FORBIDDEN/.test(custImports.err ?? ''),
    'Rate cards: Finance can view but not propose; Support and customers have no access');

  // ── Duty (design v2: confirmed by a second person who checked the source) ──
  await as(ds);
  const dv = (await one(`select create_duty_rate_version('S6B draft', '[]'::jsonb) id`)).id;
  const e1 = (await one(`select upsert_duty_rate_entry($1, 'AE', null, null, null, 0, 'duty', null, 'needs_data') id`, [dv])).id;
  const confirmNoSource = await tryq(`select upsert_duty_rate_entry($1, 'AE', null, 500, 500, 27000, 'duty', null, 'confirmed')`, [dv]);
  await db.query(`select upsert_duty_rate_entry($1, 'SA', '8516', 1000, 1500, 0, 'duty_and_tax', 'ZATCA tariff 2026', 'verify')`, [dv]);
  const usDeMin = await tryq(`select upsert_duty_rate_entry($1, 'US', null, 0, 0, 80000, 'duty', 'CBP', 'verify')`, [dv]);
  const submitOpen = await tryq(`select submit_duty_rate_version($1)`, [dv]);
  await db.query(`select upsert_duty_rate_entry($1, 'AE', null, 500, 500, 27000, 'duty', 'UAE customs portal, Nov 2026', 'verify')`, [dv]);
  const selfConfirm = await tryq(`select upsert_duty_rate_entry($1, 'AE', null, 500, 500, 27000, 'duty', 'UAE customs portal, Nov 2026', 'confirmed')`, [dv]);
  await as(fin1);
  const editAndConfirm = await tryq(`select upsert_duty_rate_entry($1, 'SA', '8516', 1200, 1500, 0, 'duty_and_tax', 'ZATCA tariff 2026', 'confirmed')`, [dv]);
  await db.query(`select upsert_duty_rate_entry($1, 'AE', null, 500, 500, 27000, 'duty', 'UAE customs portal, Nov 2026', 'confirmed')`, [dv]);
  await db.query(`select upsert_duty_rate_entry($1, 'SA', '8516', 1000, 1500, 0, 'duty_and_tax', 'ZATCA tariff 2026', 'confirmed')`, [dv]);
  await as(ds);
  const sub = (await one(`select submit_duty_rate_version($1) r`, [dv])).r;
  const selfPublish = await tryq(`select activate_duty_rate_version($1)`, [dv]);
  await as(fin2);
  const sentBackNoReason = await tryq(`select reject_duty_rate_version($1, '')`, [dv]);
  const sentBack = (await one(`select reject_duty_rate_version($1, 'Check the SA source date') r`, [dv])).r;
  await as(fin1);
  const afterSendBack = await tryq(`select activate_duty_rate_version($1)`, [dv]);
  // an edit after submit resets the submission and the entry goes back to verify
  await as(ds);
  await db.query(`select submit_duty_rate_version($1)`, [dv]);
  await db.query(`select upsert_duty_rate_entry($1, 'SA', '8516', 1100, 1500, 0, 'duty_and_tax', 'ZATCA tariff 2026', 'verify')`, [dv]);
  await as(fin1);
  const notSubmitted = await tryq(`select activate_duty_rate_version($1)`, [dv]);
  await db.query(`select upsert_duty_rate_entry($1, 'SA', '8516', 1100, 1500, 0, 'duty_and_tax', 'ZATCA tariff 2026', 'confirmed')`, [dv]);
  await as(ds);
  await db.query(`select submit_duty_rate_version($1)`, [dv]);
  await as(support);
  const supEdit = await tryq(`select upsert_duty_rate_entry($1, 'AE', null, 1, 1, 0, 'duty', 'x', 'verify')`, [dv]);
  const supVersions = await tryq(`select * from list_duty_rate_versions()`);
  await as(cust, 'aal1');
  const custVersions = await tryq(`select * from list_duty_rate_versions()`);
  const custEntries = await tryq(`select count(*)::int n from duty_rate_entries`);
  await as(fin1);
  const pub = (await one(`select activate_duty_rate_version($1) r`, [dv])).r;
  const look = (await one(`select lookup_duty_rate('SA', '8516.79') d`)).d;
  const ver = (await all(`select * from list_duty_rate_versions()`)).find((v) => v.id === dv);
  const lockedEdit = await tryq(`select upsert_duty_rate_entry($1, 'AE', null, 1, 1, 0, 'duty', 'x', 'verify')`, [dv]);
  await owner();
  const e1Row = await one(`select status, duty_bp, source, verified_by, edited_by from duty_rate_entries where id = $1`, [e1]);
  ok(/US_NO_DE_MINIMIS/.test(usDeMin.err ?? ''), 'Duty: a US entry with a de minimis amount is refused (the US has no de minimis)');
  ok(/CONFIRM_NEEDS_DATA/.test(confirmNoSource.err ?? '') && /DUTY_ENTRIES_NOT_CONFIRMED/.test(submitOpen.err ?? '') && sub.entries === 2,
    'Duty: an entry with no rate stays needs_data; confirming needs rates + source; submit refused while any entry is open');
  ok(/CONFIRM_NEEDS_SECOND_PERSON/.test(selfConfirm.err ?? '') && /CONFIRM_NEEDS_SECOND_PERSON/.test(editAndConfirm.err ?? '') &&
    e1Row.status === 'confirmed' && e1Row.verified_by === fin1 && e1Row.edited_by === ds,
    'Duty: the person who entered the data cannot confirm it, nor can someone confirm while changing it; a second person confirms');
  ok(/TWO_PERSON_REQUIRED|FORBIDDEN/.test(selfPublish.err ?? '') && /REASON_REQUIRED/.test(sentBackNoReason.err ?? '') &&
    sentBack.version_id === dv && /DUTY_NOT_SUBMITTED/.test(afterSendBack.err ?? '') && /DUTY_NOT_SUBMITTED|DUTY_ENTRIES_NOT_CONFIRMED/.test(notSubmitted.err ?? ''),
    `Duty: the preparer cannot publish (${(selfPublish.err ?? 'ALLOWED').slice(0, 40)}); a submitted version can be sent back with a reason; an edit after submit needs a new submit`);
  ok(pub.activated_id === dv && Number(look?.duty_bp) === 1100 && ver?.status === 'active' && ver?.activated_by_name === 'S6B fin1' &&
    ver?.submitted_by_name === 'S6B ds' && ver?.confirmed === 2 && /DUTY_VERSION_NOT_DRAFT/.test(lockedEdit.err ?? '') &&
    /Sent back: Check the SA source date/.test(ver?.note ?? ''),
    'Duty: a second person (Finance) publishes; lookup uses the new rates; history shows who prepared, who published and why it was sent back; active version is locked');
  ok(/FORBIDDEN/.test(supEdit.err ?? '') && !supVersions.err && supVersions.rows.length > 0 && /FORBIDDEN/.test(custVersions.err ?? '') && !custEntries.err && custEntries.rows[0].n === 0,
    'Duty: Support reads versions but cannot edit; customers get FORBIDDEN / 0 rows');

  // ── Customs value policy (versioned, two-person) + data completeness ──
  await as(ds);
  const badPct = await tryq(`select propose_customs_policy(150, 'follow_destination')`);
  const cp = (await one(`select propose_customs_policy(null, 'follow_destination', 'S6B threshold not set yet') id`)).id;
  const cpSelf = await tryq(`select approve_customs_policy($1)`, [cp]);
  await as(support);
  const cpSup = await tryq(`select propose_customs_policy(80, 'follow_destination')`);
  const cpSupList = await tryq(`select * from list_customs_policy()`);
  const dataSup = await tryq(`select dropship_data_completeness() d`);
  await as(cust, 'aal1');
  const cpCust = await tryq(`select * from list_customs_policy()`);
  const dataCust = await tryq(`select dropship_data_completeness() d`);
  await as(fin1);
  const cpOk = (await one(`select approve_customs_policy($1) r`, [cp])).r;
  const cpList = (await all(`select * from list_customs_policy()`)).find((r) => r.id === cp);
  await owner();
  const d = dataSup.rows[0]?.d ?? {};
  ok(/INVALID_CUSTOMS_POLICY/.test(badPct.err ?? '') && /TWO_PERSON_REQUIRED/.test(cpSelf.err ?? '') && cpOk.activated_id === cp &&
    cpList?.status === 'active' && cpList?.block_below_pct === null && cpList?.approved_by_name === 'S6B fin1',
    'Customs policy: proposed by one person, approved by another; an unset threshold stays empty (not 0); bad % refused');
  ok(/FORBIDDEN/.test(cpSup.err ?? '') && !cpSupList.err && /FORBIDDEN/.test(cpCust.err ?? '') && /FORBIDDEN/.test(dataCust.err ?? '') &&
    !dataSup.err && Number(d.published) >= Number(d.hs_verified) && Number(d.published) >= Number(d.weight_and_box),
    `Customs policy: Support reads but cannot propose; customers FORBIDDEN; data completeness counts (${d.hs_verified}/${d.published} HS, ${d.weight_and_box}/${d.published} size)`);

  const auditAfter = Number((await one(`select count(*) n from audit_log where action like 'fee_version.%' or action like 'shipping_rate_card.%' or action like 'duty_rate_%' or action like 'customs_policy.%'`)).n);
  ok(auditAfter - auditBefore >= 30, `every change is audit-logged (+${auditAfter - auditBefore} audit rows)`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nstep6b: ${failed} check(s) failed` : '\nstep6b: all passed');
process.exitCode = failed ? 1 : 0;
