// Octopus Dropship · Release 5 · Steps 12 (plans, non-Shopify billing), 12b (Finance plan-fee switch) and 13 (dashboard,
// reports, settings, staff health) — DB checks for migration *_ds12_billing_reports_health. STAGING ONLY, one rolled-back
// transaction, acting as merchants / Finance / admin / the service role through JWT claims (what PostgREST does).
//  0. Structure: 9 new tables with RLS; staff tables have no grant for signed-in users; merchant tables SELECT only; every
//     function search_path=public, revoked from public/anon (except the public tracking brand), internals not callable by
//     signed-in users; merchant-readable columns don't look internal (customer-columns rule); the replaced write lock still
//     refuses a direct write to saas_billing_settings.
//  1. Plans: two-person proposals (proposer ≠ approver, Finance / admin only, merchants refused); no price → can't be offered.
//  2. Billing OFF (default): everyone free, no limits (a push over the plan limit is queued), nothing charged, no invoice.
//  3. Switch: two-person on (proposer can't approve, one proposal at a time, reject needs a reason, only the proposer withdraws),
//     every Dropship merchant gets ONE 30-day trial; free_forever only for credit_eligible (database refuses others).
//  4. Limits only when ON: live products (push job BLOCKED with PLAN_LIMIT; re-push of a live product never limited), stores.
//  5. Billing run: trial end with an approved plan → OCT-DS invoice (paid, legal entity, one line) + balanced journal wallet →
//     plan revenue, on the STMT-DS statement; idempotent; not enough funds → grace → paused (new pushes PLAN_PAUSED), then
//     paid on approval; trial end without a plan → grace notice. Switch OFF → all free, trial days kept, no charge; ON again →
//     the trial resumes with the days left, no second trial.
//  6. Team roles enforced in the database (support can't change order settings; owner manages roles; last owner kept; invite
//     accepted only by the invited confirmed email).
//  7. Settings: white-label text check, logo needed before showing it, notification choices honoured by ds_notify.
//  8. Reports vs seeded orders: USD sales at the locked FX, unknown price kept unknown, cost lines, refunds, refund rate,
//     delivery days, 12 weeks, top products, CSV rows; dashboard counts; feature list off → refused.
//  9. Close Dropshipping: confirmation, service closed, pushes cancelled, plan cancelled, history / wallet / export kept,
//     new activity refused.
// 10. Staff health: readers (merchant refused, Finance reads but can't act), retry and dead-letter on events / outbox.
// 11. RLS cross-org + anon; audit rows; every journal balanced; wallet total consistent.
// 12. down → up → down → up: identical schema (later migrations unwound / re-applied).
// Run: node supabase/tests/ds12-dropship.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runDs12Checks(db, ctx) {
  let failed = 0;
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const service = async () => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    await db.query('set local role service_role');
  };
  const tryq = async (q, p) => {
    await db.query('savepoint sp');
    try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
    catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
  };
  const err = async (q, p) => (await tryq(q, p)).err ?? '';
  const rpc = async (q, p) => (await one(q, p)).r;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const TABLES = ['dropship_plans', 'dropship_plan_changes', 'saas_billing_overrides', 'dropship_plan_subscriptions', 'dropship_plan_charges',
    'dropship_merchant_settings', 'dropship_notification_prefs', 'dropship_team_roles', 'dropship_team_invites'];
  const STAFF_TABLES = ['dropship_plans', 'dropship_plan_changes', 'saas_billing_overrides', 'dropship_team_invites'];
  const MERCHANT_TABLES = TABLES.filter((t) => !STAFF_TABLES.includes(t));
  const RPC_FNS = ['ds_billing_page', 'ds_billing_choose_plan', 'saas_switch_propose', 'saas_switch_decide', 'saas_switch_withdraw', 'saas_override_set',
    'saas_override_remove', 'ds_plan_propose', 'ds_plan_decide', 'saas_billing_page', 'ds_reports_page', 'ds_reports_csv', 'ds_dashboard', 'ds_settings_page',
    'ds_settings_save', 'ds_branding_set_logo', 'ds_notification_prefs_save', 'ds_team_set_role', 'ds_team_remove', 'ds_team_invite', 'ds_team_invite_cancel',
    'ds_team_invites_for_me', 'ds_team_invite_accept', 'ds_export_rows', 'ds_close_dropshipping', 'ds_brand_for_org', 'ds_health_page', 'ds_health_retry',
    'ds_health_dead_letter', 'ds_health_notify_merchant'];
  // service role only (the tracking page reads it on the server): never granted to anon or signed-in users
  const SERVICE_FNS = ['ds_public_brand'];
  const INTERNAL_FNS = ['ds12_claims_role', 'saas_finance_can', 'ds12_usd', 'ds_team_role', 'ds_role_allows', 'ds_assert_role', 'ds_notify', 'ds12_text_problem',
    'ds_plan_live_products', 'ds_plan_state', 'ds_plan_push_guard', 'ds_plan_store_guard', 'saas_override_guard', 'ds_role_guard', 'ds_billing_ensure',
    'ds_billing_charge', 'ds_billing_start_trials', 'ds_billing_stop_all', 'ds_billing_jobs', 'ds_report_orders', 'ds12_period_summary', 'ds12_settings_org',
    'ds12_brand_json', 'ds12_health_can_view'];
  const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;
  const journalsBalanced = async (ids) => {
    if (!ids.length) return true;
    const bad = await all(`select journal_id from ledger_entries where journal_id = any($1::uuid[]) group by journal_id having sum(debit_cents) <> sum(credit_cents)`, [ids]);
    return bad.length === 0;
  };

  await owner();
  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity r from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === TABLES.length && rls.every((x) => x.r), `all ${TABLES.length} new tables exist with RLS on`);
  const grants = await all(`select table_name t, grantee g, privilege_type p from information_schema.table_privileges
     where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [TABLES]);
  ok(grants.every((g) => g.g === 'authenticated' && g.p === 'SELECT' && MERCHANT_TABLES.includes(g.t)) && MERCHANT_TABLES.every((t) => grants.some((g) => g.t === t)),
    `signed-in users: SELECT only on the ${MERCHANT_TABLES.length} merchant tables, nothing on staff tables, anon nothing${grants.filter((g) => g.p !== 'SELECT' || !MERCHANT_TABLES.includes(g.t)).map((g) => ' ' + g.t + ':' + g.p).join('')}`);
  const pols = await all(`select tablename, cmd, qual from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(MERCHANT_TABLES.every((t) => pols.some((p) => p.tablename === t && p.cmd === 'SELECT' && /my_org_ids\(\)/.test(p.qual))), 'merchant tables: own-organisation SELECT policy (my_org_ids())');
  const fns = await all(`select p.proname n, p.prosecdef d, p.proconfig::text c, p.proacl::text a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS, ...SERVICE_FNS]]);
  const names = new Set(fns.map((f) => f.n));
  const missing = [...RPC_FNS, ...INTERNAL_FNS, ...SERVICE_FNS].filter((n) => !names.has(n));
  ok(missing.length === 0, `every DS12 function exists${missing.length ? ' — missing ' + missing.join(',') : ''}`);
  const noPath = fns.filter((f) => !/search_path=public/.test(f.c ?? ''));
  const notDefiner = fns.filter((f) => [...RPC_FNS, ...SERVICE_FNS].includes(f.n) && !f.d);
  const anonOpen = fns.filter((f) => /(^\{|,)=X\//.test(f.a ?? '') || /anon=X/.test(f.a ?? ''));
  const internalOpen = fns.filter((f) => [...INTERNAL_FNS, ...SERVICE_FNS].includes(f.n) && /authenticated=X/.test(f.a ?? ''));
  const rpcClosed = fns.filter((f) => RPC_FNS.includes(f.n) && !/authenticated=X/.test(f.a ?? ''));
  ok(noPath.length === 0 && notDefiner.length === 0 && anonOpen.length === 0, `functions: search_path=public, RPCs are definers, none for public/anon${[...noPath, ...notDefiner, ...anonOpen].map((f) => ' ' + f.n).join('')}`);
  ok(internalOpen.length === 0 && rpcClosed.length === 0, `internals, jobs and the tracking brand (service role) not callable by signed-in users; the ${RPC_FNS.length} RPCs are${[...internalOpen, ...rpcClosed].map((f) => ' ' + f.n).join('')}`);
  const cols = await all(`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and table_name = any($1)`, [MERCHANT_TABLES]);
  const looksInternal = cols.filter((c) => INTERNAL_NAME.test(c.c));
  ok(looksInternal.length === 0, `no merchant-readable column looks internal (customer-columns rule)${looksInternal.length ? ' — ' + looksInternal.map((c) => `${c.t}.${c.c}`).join(', ') : ''}`);
  ok(/SAAS_BILLING_LOCKED/.test(await err(`update saas_billing_settings set enabled = true where id = 1`)), 'saas_billing_settings: a direct write is still refused (only the two-person switch writes it)');
  ok(/SAAS_BILLING_LOCKED/.test(await err(`delete from saas_billing_settings`)), 'saas_billing_settings: delete refused');
  ok(!(await tryq(`update saas_billing_settings set proposed_by = null, approved_by = null where id = 1`)).err, 'saas_billing_settings: a staff user can still be deleted (FK sets proposer / approver to null)');
  ok(/SAAS_BILLING_LOCKED/.test(await err(`update saas_billing_settings set approved_by = null, trial_days = 31 where id = 1`)), 'saas_billing_settings: nulling a person can\'t carry another change');

  // ── fixtures ──
  const settingsBefore = await one(`select * from saas_billing_settings where id = 1`);
  if (settingsBefore.enabled || settingsBefore.pending_enabled !== null) {
    // the checks start from the decided state "plan fees off"; staging must be off (owner decision D1)
    ok(false, `fixture: plan fees are expected OFF with nothing pending on staging (enabled=${settingsBefore.enabled}, pending=${settingsBefore.pending_enabled})`);
    return failed;
  }
  const mkUser = async (tag, role = null, email = null) => {
    await owner();
    const mail = email ?? `ds12-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `DS12 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkMerchant = async (tag, credit = false) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [`TEST – DS12 ${tag} ${stamp}`])).id;
    if (credit) {
      // Pay-later / free-forever eligibility only through the sanctioned admin function
      await as(creditAdmin, 'aal2');
      await db.query(`select set_org_credit_eligible($1, true, 'DS12 test: Octopus group company')`, [org]);
      await owner();
    }
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now())
                    on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
    return { uid, org };
  };
  const journalsMade = [];
  const fund = async (org, cents, tag) => {
    await owner();
    const j = (await one(`select post_journal($1, jsonb_build_array(
        jsonb_build_object('account', cash_account('USD'), 'debit', $2::bigint, 'credit', 0),
        jsonb_build_object('account', wallet_account($3, 'USD'), 'debit', 0, 'credit', $2::bigint, 'org', $3)), $4, 'topup', 'organization', $3) j`,
      [`DS12 test top-up ${tag}`, cents, org, `ds12-topup-${tag}-${stamp}`])).j;
    journalsMade.push(j);
  };
  const walletOf = async (org) => { await owner(); return Number((await one(`select wallet_balance($1, 'USD') b`, [org])).b); };
  const subOf = async (org) => { await owner(); return one(`select * from dropship_plan_subscriptions where org_id = $1`, [org]); };
  const state = async (org) => { await owner(); return rpc(`select ds_plan_state($1) r`, [org]); };
  const runJobs = async () => { await service(); return rpc(`select ds_billing_jobs() r`); };
  const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
    'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
  const feats = (await one(`select value from site_settings where key = 'dropship_features'`))?.value ?? null;
  await db.query(`insert into site_settings (key, value) values ('dropship_features', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(ALL_ON)]);

  const creditAdmin = await mkUser('credit-admin', 'admin');
  const A = await mkMerchant('a');
  const B = await mkMerchant('b');
  const C = await mkMerchant('credit', true);
  const D = await mkMerchant('d');
  const E = await mkMerchant('e');
  const L = await mkMerchant('limits');
  const R = await mkMerchant('reports');
  const F1 = await mkUser('fin1', 'finance');
  const F2 = await mkUser('fin2', 'finance');
  const admin = await mkUser('admin', 'admin');
  const prods = await all(`select p.id product_id, v.id variant_id, v.item_id, v.model_no, p.title from dropship_products p join dropship_variants v on v.product_id = p.id
     where p.status = 'active' order by v.model_no limit 6`);
  const P = [...new Map(prods.map((x) => [x.product_id, x])).values()];
  ok(P.length >= 3, `fixture: 3 active Dropship products (${P.length})`);
  if (P.length < 3) return failed + 1;
  const ledgerBefore = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  const docsBefore = Number((await one(`select count(*) n from documents where doc_type = 'commercial_invoice' and org_id = any($1::uuid[])`, [[A.org, B.org, C.org, D.org, E.org, L.org, R.org]])).n);

  // L: one active store with one live product (the limit fixtures)
  await service();
  const conn = (await one(`insert into store_connections (org_id, shop_domain, status, connected_at) values ($1, $2, 'active', now()) returning id`, [L.org, `ds12-l-${stamp.replace(/[^a-z0-9]/g, '')}.myshopify.com`])).id;
  await db.query(`insert into dropship_product_links (org_id, store_connection_id, product_id, product_gid, status) values ($1, $2, $3, 'gid://shopify/Product/1', 'linked')`, [L.org, conn, P[0].product_id]);
  const batch = (await one(`insert into dropship_push_batches (org_id, store_connection_id, kind, request_key) values ($1, $2, 'push', gen_random_uuid()) returning id`, [L.org, conn])).id;
  const pushJob = async (org, productId, connId = null, batchId = null) => {
    await owner();
    let b = batchId;
    if (!b) b = (await one(`insert into dropship_push_batches (org_id, store_connection_id, kind, request_key) values ($1, $2, 'push', gen_random_uuid()) returning id`, [org, connId])).id;
    return one(`insert into dropship_push_jobs (batch_id, org_id, store_connection_id, product_id, kind, status) values ($1, $2, $3, $4, 'push', 'queued') returning id, status, error_code, error_message`, [b, org, connId, productId]);
  };

  // ── 1. plans: two-person proposals ──
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_plan_propose('growth', '{"name":"Growth","price_cents":4900}'::jsonb, 'owner price')`)), 'plans: a merchant can\'t propose a plan');
  await as(F1, 'aal2');
  ok(/PRICE_REQUIRED/.test(await err(`select ds_plan_propose('growth', '{"name":"Growth","active":true}'::jsonb, 'no price yet')`)), 'plans: a plan without a price can\'t be offered (D1: prices stay unset until the owner gives them)');
  const growthValues = { name: 'Growth', price_cents: 4900, live_products_limit: 1, stores_limit: 1, orders_month_limit: 2, features: ['import_push', 'order_sync', 'auto_sync'], active: true, sort_order: 20 };
  const prop = await rpc(`select ds_plan_propose('growth', $1::jsonb, 'owner numbers for the test') r`, [JSON.stringify(growthValues)]);
  ok(prop.ok === true, 'plans: Finance proposes Growth');
  ok(/PROPOSAL_PENDING/.test(await err(`select ds_plan_propose('growth', $1::jsonb, 'again')`, [JSON.stringify(growthValues)])), 'plans: one open proposal per plan');
  ok(/SECOND_PERSON_REQUIRED/.test(await err(`select ds_plan_decide($1, true, null)`, [prop.change_id])), 'plans: the proposer can\'t approve their own change');
  await as(F2, 'aal2');
  ok((await rpc(`select ds_plan_decide($1, true, 'checked') r`, [prop.change_id])).approved === true, 'plans: a second Finance user approves');
  await owner();
  const growth = await one(`select * from dropship_plans where code = 'growth'`);
  ok(growth && Number(growth.price_cents) === 4900 && growth.live_products_limit === 1 && growth.active === true, 'plans: the approved values are live (price, limits, offered)');
  ok(/dropship_plan_changes_two_person/.test(await err(`update dropship_plan_changes set decided_by = proposed_by where id = $1`, [prop.change_id])), 'plans: database check — approver ≠ proposer');

  // ── 2. billing OFF: free, no limits, nothing charged ──
  await as(B.uid);
  const bp0 = await rpc(`select ds_billing_page() r`);
  ok(bp0.billing_enabled === false && bp0.status === 'free' && bp0.limits_apply === false && bp0.plans.some((p) => p.code === 'growth'), 'billing off: "Plans are free for now", no limits, plans listed');
  ok(/BILLING_OFF/.test(await err(`select ds_billing_choose_plan('growth')`)), 'billing off: nothing to choose (no billing call)');
  await owner();
  await db.query(`insert into dropship_plan_subscriptions (org_id, plan_code, status) values ($1, 'growth', 'free')`, [L.org]);
  const jOff = await pushJob(L.org, P[1].product_id, conn, batch);
  ok(jOff.status === 'queued', 'billing off: a push over the plan limit is queued (limits only when billing is on)');
  await db.query(`update dropship_push_jobs set status = 'cancelled' where id = $1`, [jOff.id]);
  ok((await runJobs()).enabled === false, 'billing off: the billing job does nothing');

  // ── 3. switch: two-person on ──
  await as(A.uid);
  ok(/FORBIDDEN/.test(await err(`select saas_switch_propose(true, null, 'start')`)), 'switch: a merchant can\'t propose');
  await as(admin, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select saas_switch_propose(true, null, 'start')`)), 'switch: staff without 2FA (aal1) refused');
  await as(F1, 'aal2');
  ok(/REASON_REQUIRED/.test(await err(`select saas_switch_propose(true, null, '')`)), 'switch: a reason is required');
  ok((await rpc(`select saas_switch_propose(true, null, 'launch plan fees') r`)).ok === true, 'switch: Finance user 1 proposes switching on');
  ok(/PROPOSAL_PENDING/.test(await err(`select saas_switch_propose(false, null, 'other')`)), 'switch: one proposal at a time');
  ok(/SECOND_PERSON_REQUIRED/.test(await err(`select saas_switch_decide(true, null)`)), 'switch: the proposer can\'t approve');
  await owner();
  const pend = await one(`select enabled, pending_enabled, proposed_by from saas_billing_settings where id = 1`);
  ok(pend.enabled === false && pend.pending_enabled === true && pend.proposed_by === F1, 'switch: waiting for approval, still off');
  ok(/saas_billing_two_person_check|SAAS_BILLING_LOCKED/.test(await err(`update saas_billing_settings set approved_by = proposed_by where id = 1`)), 'switch: approver = proposer refused by the database');
  await as(F2, 'aal2');
  const dec = await rpc(`select saas_switch_decide(true, 'approved') r`);
  ok(dec.approved === true && dec.enabled === true && dec.merchants >= 7, `switch: Finance user 2 approves → on, trials started (${dec.merchants})`);
  const sA = await subOf(A.org);
  const days = (t) => (new Date(t).getTime() - Date.now()) / 86400000;
  ok(sA && sA.status === 'trial' && sA.trial_used === true && days(sA.trial_ends_at) > 29.9 && days(sA.trial_ends_at) <= 30.01, `trial: 30 days, one per organisation (${sA?.status}, ${sA ? days(sA.trial_ends_at).toFixed(2) : ''} days)`);
  ok((await subOf(L.org)).status === 'trial', 'trial: the existing free row starts its trial too');
  await owner();
  ok(Number((await one(`select count(*) n from notifications where org_id = $1 and title like 'Free trial started%'`, [A.org])).n) === 1, 'trial: the merchant is told in the app');

  // reject + withdraw paths
  await as(F1, 'aal2');
  await rpc(`select saas_switch_propose(false, null, 'test reject') r`);
  await as(F2, 'aal2');
  ok(/REASON_REQUIRED/.test(await err(`select saas_switch_decide(false, null)`)), 'switch: rejecting needs a reason');
  ok(/FORBIDDEN/.test(await err(`select saas_switch_withdraw()`)), 'switch: only the proposer withdraws');
  ok((await rpc(`select saas_switch_decide(false, 'not now') r`)).approved === false, 'switch: second person rejects');
  await as(F1, 'aal2');
  await rpc(`select saas_switch_propose(false, null, 'test withdraw') r`);
  ok((await rpc(`select saas_switch_withdraw() r`)).ok === true, 'switch: the proposer withdraws');
  await owner();
  ok((await one(`select enabled, pending_enabled from saas_billing_settings where id = 1`)).enabled === true, 'switch: still on after reject / withdraw');

  // free_forever only for credit_eligible
  await as(F2, 'aal2');
  ok(/NOT_ELIGIBLE/.test(await err(`select saas_override_set($1, 'free_forever', null, 'friend')`, [A.org])), 'override: free forever refused for a normal merchant');
  ok((await rpc(`select saas_override_set($1, 'free_forever', null, 'Octopus group company') r`, [C.org])).ok === true, 'override: free forever for a credit_eligible company');
  ok((await rpc(`select saas_override_set($1, 'extra_trial', 30, 'launch partner') r`, [E.org])).ok === true, 'override: a longer trial (+30 days)');
  await owner();
  ok(/NOT_ELIGIBLE/.test(await err(`insert into saas_billing_overrides (org_id, kind, reason) values ($1, 'free_forever', 'direct')`, [A.org])), 'override: the database refuses free forever for others (trigger)');
  const sC = await state(C.org);
  ok(sC.status === 'free_forever' && sC.limits_apply === false, 'override: free forever → no plan fee, no limits');
  ok(days((await subOf(E.org)).trial_ends_at) > 59.9, 'override: the trial is extended by 30 days');

  // ── 4. limits only when ON ──
  const jOn = await pushJob(L.org, P[1].product_id, conn, batch);
  ok(jOn.status === 'blocked' && jOn.error_code === 'PLAN_LIMIT' && /allows 1 live products/.test(jOn.error_message), `limits on: a new product over the plan limit is blocked (${jOn.status} ${jOn.error_code})`);
  const jRe = await pushJob(L.org, P[0].product_id, conn, batch);
  ok(jRe.status === 'queued', 'limits on: re-pushing a product that is already live is never limited');
  await owner();
  await db.query(`update dropship_push_jobs set status = 'cancelled' where id = $1`, [jRe.id]);
  await service();
  ok(/PLAN_LIMIT/.test(await err(`insert into store_connections (org_id, shop_domain, status) values ($1, $2, 'active')`, [L.org, `ds12-l2-${stamp.replace(/[^a-z0-9]/g, '')}.myshopify.com`])), 'limits on: a second store over the plan limit is refused');
  await owner();
  await db.query(`insert into dropship_plan_subscriptions (org_id, plan_code, status) values ($1, 'growth', 'free_forever') on conflict (org_id) do update set plan_code = 'growth'`, [C.org]);
  ok((await pushJob(C.org, P[1].product_id)).status === 'queued', 'limits on: a free-forever company is not limited');
  const sL = await state(L.org);
  ok(sL.channel === 'shopify' && sL.live_products_limit === 1, 'plan state: store connected → Shopify channel (billed through Shopify, stub)');
  await as(L.uid);
  ok(/SHOPIFY_BILLING/.test(await err(`select ds_billing_choose_plan('growth')`)), 'Shopify channel: plan approval is in Shopify once connected (honest stub, nothing charged)');

  // ── 5. billing run (wallet channel) ──
  await fund(B.org, 10000, 'b');
  await as(B.uid);
  const ch = await rpc(`select ds_billing_choose_plan('growth') r`);
  ok(ch.ok === true && ch.status === 'trial' && ch.charge === null, 'choose plan in the trial: approved, nothing charged before the trial ends');
  await owner();
  await db.query(`update dropship_plan_subscriptions set trial_ends_at = now() - interval '1 hour' where org_id = $1`, [B.org]);
  const run1 = await runJobs();
  const sB = await subOf(B.org);
  ok(run1.charged >= 1 && sB.status === 'active' && sB.current_period_end && days(sB.current_period_end) > 27, `trial end with an approved plan → charged, active for a month (${JSON.stringify(run1)})`);
  await owner();
  const chg = await one(`select * from dropship_plan_charges where org_id = $1`, [B.org]);
  const inv = chg?.invoice_id ? await one(`select * from documents where id = $1`, [chg.invoice_id]) : null;
  const legal = (await one(`select current_legal_entity_id(now()) e`)).e;
  ok(inv && /^OCT-DS-\d{4}-\d{6}$/.test(inv.number) && inv.doc_type === 'commercial_invoice' && Number(inv.amount_cents) === 4900 && inv.status === 'paid'
     && inv.legal_entity_id === legal && inv.data?.kind === 'plan_fee', `OCT-DS tax invoice for the plan (${inv?.number}), paid, current legal entity`);
  const lines = inv ? await all(`select description, amount_cents from invoice_lines where document_id = $1`, [inv.id]) : [];
  ok(lines.length === 1 && Number(lines[0].amount_cents) === 4900 && /Octopus Dropship plan · Growth/.test(lines[0].description), 'invoice line: "Octopus Dropship plan · Growth · period"');
  const jl = chg?.journal_id ? await all(`select le.debit_cents, le.credit_cents, la.code from ledger_entries le join ledger_accounts la on la.id = le.account_id where le.journal_id = $1`, [chg.journal_id]) : [];
  ok(jl.length === 2 && jl.some((e) => e.code === `wallet:${B.org}` && Number(e.debit_cents) === 4900) && jl.some((e) => e.code === 'rev:service_fees' && Number(e.credit_cents) === 4900),
    'balanced journal: wallet debit = plan revenue credit');
  if (chg?.journal_id) journalsMade.push(chg.journal_id);
  ok((await walletOf(B.org)) === 10000 - 4900, 'wallet: 100.00 − 49.00 = 51.00');
  const run2 = await runJobs();
  ok(Number((await one(`select count(*) n from dropship_plan_charges where org_id = $1`, [B.org])).n) === 1 && run2.charged === 0, 'billing run is idempotent (no second charge in the same period)');
  await owner();
  const stmt = await tryq(`select generate_dropship_weekly_statement($1, now() - interval '1 day', now() + interval '1 day') r`, [B.org]);
  const stmtDoc = stmt.err ? null : await one(`select number, data from documents where org_id = $1 and doc_type = 'statement' order by created_at desc limit 1`, [B.org]);
  ok(!stmt.err && stmtDoc && (stmtDoc.data?.invoices ?? []).some((x) => x.number === inv?.number), `the plan invoice is on the STMT-DS weekly statement (${stmtDoc?.number ?? stmt.err})`);

  // not enough funds → grace → paused → paid on approval
  await as(D.uid);
  await rpc(`select ds_billing_choose_plan('growth') r`);
  await owner();
  await db.query(`update dropship_plan_subscriptions set trial_ends_at = now() - interval '1 hour' where org_id = $1`, [D.org]);
  await runJobs();
  let sD = await subOf(D.org);
  ok(sD.status === 'grace' && sD.last_charge_error === 'WALLET_INSUFFICIENT' && days(sD.grace_ends_at) > 6.9, `not enough in the wallet → 7-day grace, nothing charged (${sD.status})`);
  ok(Number((await one(`select count(*) n from documents where org_id = $1`, [D.org])).n) === 0, 'grace: no invoice without a payment');
  await db.query(`update dropship_plan_subscriptions set grace_ends_at = now() - interval '1 minute' where org_id = $1`, [D.org]);
  await runJobs();
  sD = await subOf(D.org);
  ok(sD.status === 'paused' && sD.paused_at, 'grace ended → new pushes paused');
  const jP = await pushJob(D.org, P[2].product_id);
  ok(jP.status === 'blocked' && jP.error_code === 'PLAN_PAUSED' && /Paid orders keep shipping/.test(jP.error_message), 'paused: a new push is blocked with the reason (paid orders keep shipping)');
  await fund(D.org, 5000, 'd');
  await as(D.uid);
  const chD = await rpc(`select ds_billing_choose_plan('growth') r`);
  ok(chD.charge?.ok === true && chD.status === 'active', 'paused: approving with funds charges at once and resumes');
  if (chD.charge?.invoice_id) { await owner(); journalsMade.push((await one(`select journal_id from dropship_plan_charges where invoice_id = $1`, [chD.charge.invoice_id])).journal_id); }

  // trial end without a plan → grace notice (E has +30 days; A is used for the no-plan case)
  await owner();
  await db.query(`update dropship_plan_subscriptions set trial_ends_at = now() - interval '1 hour' where org_id = $1`, [A.org]);
  await runJobs();
  ok((await subOf(A.org)).status === 'grace', 'trial ended without an approved plan → grace');
  await owner();
  ok(Number((await one(`select count(*) n from notifications where org_id = $1 and title = 'Approve your plan to keep pushing'`, [A.org])).n) === 1, 'grace: "Approve your plan to keep pushing" in the app');

  // switch OFF → free, trial days kept; ON again → the trial resumes, no second trial
  await as(F1, 'aal2');
  await rpc(`select saas_switch_propose(false, null, 'pause fees') r`);
  await as(F2, 'aal2');
  await rpc(`select saas_switch_decide(true, 'ok') r`);
  const sE = await subOf(E.org);
  const sAoff = await subOf(A.org);
  ok(sE.status === 'free' && sE.trial_days_left_at_stop >= 59 && sAoff.status === 'free' && (await state(L.org)).limits_apply === false,
    `switch off: every plan free again, a running trial keeps its days left (${sE.trial_days_left_at_stop}), limits off`);
  const charges0 = Number((await one(`select count(*) n from dropship_plan_charges`)).n);
  await owner();
  await db.query(`update dropship_plan_subscriptions set current_period_end = now() - interval '1 hour' where org_id = $1`, [B.org]);
  await runJobs();
  ok(Number((await one(`select count(*) n from dropship_plan_charges`)).n) === charges0, 'switch off: nothing is charged (even when a period ended)');
  ok((await pushJob(L.org, P[2].product_id, conn, batch)).status === 'queued', 'switch off: limits are not enforced');
  await as(F1, 'aal2');
  await rpc(`select saas_switch_propose(true, null, 'resume fees') r`);
  await as(F2, 'aal2');
  await rpc(`select saas_switch_decide(true, 'ok') r`);
  const sE2 = await subOf(E.org);
  const sA2 = await subOf(A.org);
  ok(sE2.status === 'trial' && days(sE2.trial_ends_at) > 58 && days(sE2.trial_ends_at) < 61, 'switch on again: the trial resumes with the days that were left');
  ok(sA2.status === 'grace', 'switch on again: no second trial for a company that used its trial (grace)');
  // a date in the future: approved now, starts on the date (by the job)
  await as(F1, 'aal2');
  await rpc(`select saas_switch_propose(false, null, 'off for the date test') r`);
  await as(F2, 'aal2');
  await rpc(`select saas_switch_decide(true, 'ok') r`);
  await as(F1, 'aal2');
  ok(/INVALID_DATE/.test(await err(`select saas_switch_propose(true, now() + interval '5 minutes', 'too soon')`)), 'switch on a date: at least one hour ahead');
  await rpc(`select saas_switch_propose(true, now() + interval '2 days', 'start on a date') r`);
  await as(F2, 'aal2');
  const decDate = await rpc(`select saas_switch_decide(true, 'ok') r`);
  await owner();
  const sd = await one(`select enabled, scheduled_start from saas_billing_settings where id = 1`);
  ok(decDate.approved && sd.enabled === false && sd.scheduled_start, 'switch on a date: approved, still off until the date');
  await db.query(`select set_config('octopus.saas_switch', 'on', true)`);
  await db.query(`update saas_billing_settings set scheduled_start = now() - interval '1 minute' where id = 1`);
  await db.query(`select set_config('octopus.saas_switch', '', true)`);
  await runJobs();
  await owner();
  ok((await one(`select enabled from saas_billing_settings where id = 1`)).enabled === true, 'switch on a date: the job switches on when the date comes');

  // ── 6. team roles ──
  const S = await mkUser('support');
  await owner();
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'viewer')`, [A.org, S]);
  ok((await one(`select ds_team_role($1, $2) r`, [A.org, S])).r === 'support', 'team: a viewer member is Support');
  await as(S);
  ok(/ROLE_FORBIDDEN/.test(await err(`select ds_order_settings_save('wallet', true)`)), 'team: Support can\'t change how orders are paid (checked in the database)');
  ok(/ROLE_FORBIDDEN/.test(await err(`select ds_team_set_role($1, 'manager')`, [S])), 'team: only the owner manages roles');
  await as(A.uid);
  ok(!(await tryq(`select ds_order_settings_save('wallet', true)`)).err, 'team: the owner can');
  ok((await rpc(`select ds_team_set_role($1, 'manager') r`, [S])).ok === true, 'team: owner makes Support a Manager');
  ok(/LAST_OWNER/.test(await err(`select ds_team_set_role($1, 'manager')`, [A.uid])), 'team: the last owner stays an owner');
  await as(S);
  ok(!(await tryq(`select ds_order_settings_save('wallet', true)`)).err, 'team: a Manager can change order settings');
  const inviteMail = `ds12-invitee-${stamp}@test.local`;
  await as(A.uid);
  const inv1 = await rpc(`select ds_team_invite($1, 'support') r`, [inviteMail]);
  ok(inv1.ok === true && /ALREADY_INVITED/.test(await err(`select ds_team_invite($1, 'support')`, [inviteMail])), 'team: invite once per email');
  const I = await mkUser('invitee', null, inviteMail);
  const W = await mkUser('wrong');
  await as(W);
  ok(/NOT_FOUND/.test(await err(`select ds_team_invite_accept($1)`, [inv1.invite_id])), 'team: another login can\'t accept the invitation');
  await as(I);
  ok((await rpc(`select ds_team_invites_for_me() r`)).length === 1, 'team: the invited person sees the invitation');
  ok((await rpc(`select ds_team_invite_accept($1) r`, [inv1.invite_id])).ok === true, 'team: accepted with the invited, confirmed email');
  await owner();
  ok((await one(`select ds_team_role($1, $2) r`, [A.org, I])).r === 'support', 'team: joined with the invited role');

  // ── 7. settings ──
  await as(A.uid);
  ok(/TEXT_CHECK/.test(await err(`select ds_settings_save('{"returns_policy":"Shipped by Octopus from Shenzhen"}'::jsonb)`)), 'branding: buyer-facing text can\'t name Octopus / Shenzhen');
  ok(/LOGO_REQUIRED/.test(await err(`select ds_settings_save('{"show_logo_tracking":true}'::jsonb)`)), 'branding: a logo is needed before showing it');
  ok(/INVALID_INPUT/.test(await err(`select ds_settings_save('{"support_email":"not-an-email"}'::jsonb)`)), 'branding: support email checked');
  await rpc(`select ds_branding_set_logo('logos/0123456789abcdef0123456789abcdef.png') r`);
  ok((await rpc(`select ds_settings_save('{"time_zone":"Asia/Dubai","returns_policy":"Contact us within 14 days.","support_email":"help@anna.example","show_logo_tracking":true}'::jsonb) r`)).ok === true, 'settings saved (time zone, returns policy, support email, logo on tracking)');
  await owner();
  const brand = await rpc(`select ds12_brand_json($1, 'tracking') r`, [A.org]);
  const brandSlip = await rpc(`select ds12_brand_json($1, 'slip') r`, [A.org]);
  ok(brand.logo_path && brand.returns_policy === 'Contact us within 14 days.' && brand.support_email === 'help@anna.example' && brandSlip.logo_path === null,
    'white-label brand: logo only where the merchant chose (tracking yes, slip no), policy and support email');
  await as(null, 'aal1', 'anon');
  ok(/permission denied/.test(await err(`select ds_public_brand('nope')`)), 'tracking brand: not callable by anon (read on the server)');
  await as(A.uid);
  ok(/permission denied/.test(await err(`select ds_public_brand('nope')`)), 'tracking brand: not callable by signed-in users');
  await service();
  ok((await tryq(`select ds_public_brand('nope') r`)).rows[0]?.r === null, 'tracking brand: the service role reads it; an unknown token returns nothing');
  await as(A.uid);
  await rpc(`select ds_notification_prefs_save('[{"event":"new_order","email":false,"in_app":false}]'::jsonb) r`);
  await owner();
  await db.query(`select ds_notify($1, 'new_order', 'New order #1', 'test', null, $2)`, [A.org, `ds12-dk-${stamp}`]);
  const nRows = await all(`select user_id from notifications where dedupe_key like $1`, [`ds12-dk-${stamp}%`]);
  ok(nRows.length >= 2 && !nRows.some((r) => r.user_id === A.uid), 'notifications: a member who switched "New order" off in the app gets none; the others do');
  const pg = await (async () => { await as(A.uid); return rpc(`select ds_settings_page() r`); })();
  ok(pg.my_role === 'owner' && pg.team.length >= 3 && pg.prefs.length === 8 && pg.prefs.find((p) => p.event === 'new_order').in_app === false, 'settings page: team, roles and my notification choices');

  // ── 8. reports vs seeded orders ──
  await owner();
  const mkOrder = async (o) => {
    const so = (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency,
        fx_rate_to_usd, shipping_method, incoterm, product_cents, processing_cents, shipping_cents, duties_cents, total_cents, payment_state, staff_stage, created_at, delivered_at, cancelled_at)
      values ($1, 'csv', $2, $3, 'Omar Saleh', '{"city":"Dubai","country":"AE"}'::jsonb, 'AE', $4, $5, 'standard', $6, $7, 120, $8, $9, $10, $11, $12, now() - interval '3 days', $13, $14)
      returning id, total_cents`,
      [R.org, `R-${stamp}-${o.n}`, `#${o.n}`, o.cur, o.fx, o.inc, o.prod, o.ship, o.duty, o.total, o.paid ? 'paid' : 'unpaid', o.paid ? 'packing' : 'unpaid', o.delivered, o.cancelled])).id;
    await db.query(`insert into store_order_items (store_order_id, product_id, variant_id, item_id, model_no, title_snapshot, fulfilment_type, qty, unit_product_cents, line_product_cents, buyer_unit_price_cents, declared_usd_cents)
      values ($1, $2, $3, $4, $5, 'Test product', 'fast_ship', $6, $7, $8, $9, 0)`,
      [so, o.p.product_id, o.p.variant_id, o.p.item_id, o.p.model_no, o.qty, o.prod / o.qty, o.prod, o.buyer]);
    await db.query(`insert into dropship_order_intake (store_order_id, org_id, channel, charged_cents, charged_at, refunded_cents, payment_option)
      values ($1, $2, 'csv', $3, $4, $5, case when $3::bigint is null then null else 'wallet' end)`,
      [so, R.org, o.paid ? o.total : null, o.paid ? new Date(Date.now() - 3 * 86400000).toISOString() : null, o.refunded ?? 0]);
    return so;
  };
  const in6days = new Date(Date.now() + 3 * 86400000).toISOString();
  await mkOrder({ n: 1001, cur: 'USD', fx: null, inc: 'DDP', prod: 1000, ship: 500, duty: 200, total: 1820, paid: true, qty: 2, buyer: 3999, p: P[0], delivered: in6days });
  await mkOrder({ n: 1002, cur: 'AED', fx: 0.2723, inc: 'DAP', prod: 800, ship: 400, duty: null, total: 1320, paid: true, qty: 1, buyer: 10000, p: P[1], refunded: 1320, cancelled: new Date().toISOString() });
  await mkOrder({ n: 1003, cur: 'USD', fx: null, inc: 'DDP', prod: 500, ship: 300, duty: 100, total: 1020, paid: true, qty: 1, buyer: null, p: P[1] });
  await mkOrder({ n: 1004, cur: 'USD', fx: null, inc: 'DDP', prod: 500, ship: 300, duty: 100, total: 1020, paid: false, qty: 1, buyer: 2500, p: P[2] });
  await as(R.uid);
  const rep = await rpc(`select ds_reports_page(now() - interval '30 days', now() + interval '1 hour', null) r`);
  const c = rep.current;
  ok(Number(c.orders) === 3 && Number(c.sales_cents) === 7998 && Number(c.orders_without_price) === 1, `reports: 3 charged orders, sales US$79.98 (2 × 39.99), 1 order without a store price kept unknown (${c.orders}/${c.sales_cents}/${c.orders_without_price})`);
  ok(Number(c.costs_cents) === 2840 && Number(c.product_cents) === 1500 && Number(c.processing_cents) === 240 && Number(c.shipping_cents) === 800 && Number(c.duties_cents) === 300,
    `reports: costs = charged − refunds, split into product / processing / shipping / duties (DAP duties not counted) (${c.costs_cents})`);
  ok(Number(c.profit_cents) === 7998 - 1820, `reports: profit before ads only where the sale is known (${c.profit_cents})`);
  ok(Number(c.refunded_orders) === 1 && Number(c.refund_rate_bp) === 3333, `reports: refund rate 33.3% (${c.refund_rate_bp} bp)`);
  ok(Number(c.avg_delivery_days) === 6 && Number(c.delivered_orders) === 1, `reports: delivery 6.0 days (${c.avg_delivery_days})`);
  ok(rep.weeks.length === 12 && rep.weeks.reduce((s, w) => s + Number(w.profit_cents), 0) === 7998 - 1820, 'reports: 12-week profit adds up');
  const tp = rep.top_products.find((t) => t.product_id === P[0].product_id);
  ok(tp && Number(tp.units) === 2 && Number(tp.sales_cents) === 7998 && Number(tp.costs_cents) === 1820 && !JSON.stringify(rep).match(/supplier|unit_cost/i),
    'reports: top products (units, sales, costs incl. processing / shipping / duties share) without supplier data');
  const csvRows = await rpc(`select ds_reports_csv(now() - interval '30 days', now() + interval '1 hour', null) r`);
  ok(csvRows.length === 3 && csvRows.some((r) => r.buyer_currency === 'AED' && Number(r.fx_rate_to_usd) === 0.2723 && r.full_refund === true), 'reports CSV: one row per charged order with the locked FX');
  const prevQ = await rpc(`select ds_reports_page(now() - interval '30 days', now() + interval '1 hour', 'SA') r`);
  ok(Number(prevQ.current.orders) === 0, 'reports: country filter');
  const dash = await rpc(`select ds_dashboard() r`);
  ok(Number(dash.current.orders) === 3 && dash.recent_orders.length === 4 && dash.plan && dash.wallet, 'dashboard: real counts (orders, recent orders, wallet, plan usage)');
  await owner();
  await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify({ ...ALL_ON, reports: false, billing: false })]);
  await as(R.uid);
  ok(/FEATURE_OFF/.test(await err(`select ds_reports_page(null, null, null)`)) && /FEATURE_OFF/.test(await err(`select ds_billing_page()`)), 'feature list (live early access): Reports and Billing refused');
  await owner();
  await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(ALL_ON)]);

  // ── 9. close Dropshipping ──
  const jR = await pushJob(R.org, P[0].product_id);
  await as(R.uid);
  ok(/CONFIRM_REQUIRED/.test(await err(`select ds_close_dropshipping('yes')`)), 'close: typed confirmation required');
  const cl = await rpc(`select ds_close_dropshipping('CLOSE') r`);
  await owner();
  const cs = await one(`select status, ended_at from company_services where org_id = $1 and service = 'dropship'`, [R.org]);
  ok(cl.ok && cs.status === 'off' && cs.ended_at && (await one(`select status from dropship_push_jobs where id = $1`, [jR.id])).status === 'cancelled'
     && (await subOf(R.org)).status === 'cancelled', 'close: service closed, open pushes cancelled, plan cancelled');
  await as(R.uid);
  ok(!(await tryq(`select ds_wallet_get()`)).err && (await rpc(`select ds_export_rows('orders') r`)).length === 4 && !(await tryq(`select ds_reports_page(null, null, null)`)).err,
    'close: wallet, history, reports and data export stay');
  ok(/DROPSHIP_PAUSED/.test(await err(`select ds_order_settings_save('wallet', true)`)) && /DROPSHIP_CLOSED/.test(await err(`select ds_settings_save('{}'::jsonb)`)), 'close: nothing new can start');
  ok(/ALREADY_CLOSED/.test(await err(`select ds_close_dropshipping('CLOSE')`)), 'close: only once');

  // ── 10. staff health ──
  await owner();
  const ev = (await one(`insert into domain_events (event_type, aggregate_type, aggregate_id, idempotency_key, db_status, attempts, last_error) values ('test.ds12', 'store_order', gen_random_uuid(), $1, 'dead', 5, '3PL timed out') returning id`, [`ds12-${stamp}`])).id;
  const ob = (await one(`insert into outbox_events (event_type, aggregate_type, status, attempts, last_error) values ('test.ds12', 'test', 'failed', 3, 'boom') returning id`)).id;
  await as(R.uid);
  ok(/FORBIDDEN/.test(await err(`select ds_health_page()`)), 'health: merchants refused');
  await as(F1, 'aal2');
  const hF = await rpc(`select ds_health_page() r`);
  ok(hF.can_act === false && /FORBIDDEN/.test(await err(`select ds_health_retry('domain_event', $1)`, [ev])), 'health: Finance reads but can\'t retry');
  await as(admin, 'aal2');
  const h = await rpc(`select ds_health_page() r`);
  ok(h.failed.some((f) => f.id === ev && f.reason === '3PL timed out') && h.failed.some((f) => f.id === ob) && Array.isArray(h.jobs) && Array.isArray(h.token_failures),
    `health: failed jobs with plain reasons, outbox, webhooks, token failures (empty until Shopify), sync errors, cron (${h.cron_readable ? h.jobs.length + ' jobs' : 'cron not readable here'})`);
  ok((await rpc(`select ds_health_retry('domain_event', $1) r`, [ev])).ok === true, 'health: Retry re-queues the same event (same idempotency key)');
  await owner();
  const evAfter = await one(`select db_status, attempts, idempotency_key from domain_events where id = $1`, [ev]);
  ok(evAfter.db_status === 'pending' && evAfter.attempts === 0 && evAfter.idempotency_key === `ds12-${stamp}`, 'health: pending again, attempts reset, key unchanged');
  await as(admin, 'aal2');
  ok(/REASON_REQUIRED/.test(await err(`select ds_health_dead_letter('domain_event', $1, '')`, [ev])), 'health: stopping a job needs a reason');
  ok((await rpc(`select ds_health_dead_letter('domain_event', $1, 'duplicate of another event') r`, [ev])).ok === true, 'health: dead-letter with a reason');
  ok((await rpc(`select ds_health_retry('outbox', $1) r`, [ob])).ok === true, 'health: outbox retry');
  if (ctx.staging) ok(h.cron_readable === true && h.jobs.some((j) => j.name === 'octopus-dropship-billing'), 'health: pg_cron runs readable, billing job scheduled');

  // ── 11. RLS, anon, audit, ledger ──
  await as(B.uid);
  const leak = Number((await one(`select count(*) n from dropship_plan_subscriptions where org_id = $1`, [A.org])).n);
  const own = Number((await one(`select count(*) n from dropship_plan_subscriptions where org_id = $1`, [B.org])).n);
  ok(leak === 0 && own === 1, 'RLS: a merchant reads only their own plan period');
  ok(/permission denied/.test(await err(`select * from dropship_plans`)) && /permission denied/.test(await err(`select * from saas_billing_overrides`)), 'staff tables: no direct read for signed-in users');
  ok(/FORBIDDEN/.test(await err(`select saas_billing_page()`)), 'Finance screen: merchants refused');
  await owner();
  ok(Number((await one(`select count(*) n from dropship_plan_subscriptions where org_id = $1`, [A.org])).n) === 1, 'RLS check counted as owner: the row exists');
  await as(null, 'aal1', 'anon');
  const anonErrs = [];
  for (const t of TABLES) if (!/permission denied/.test(await err(`select 1 from ${t} limit 1`))) anonErrs.push(t);
  ok(anonErrs.length === 0 && /permission denied/.test(await err(`select ds_billing_page()`)) && /permission denied/.test(await err(`select ds_billing_jobs()`)), `anon: no table and no RPC${anonErrs.length ? ' — ' + anonErrs.join(',') : ''}`);
  await as(A.uid);
  ok(/permission denied/.test(await err(`select ds_billing_jobs()`)) && /permission denied/.test(await err(`select ds_billing_charge($1)`, [A.org])), 'merchants can\'t call the billing job or charge');
  await owner();
  const audits = (await all(`select distinct action from audit_log where action like 'saas\\_billing.%' or action like 'ds\\_plan.%' or action like 'ds\\_team.%' or action like 'ds\\_health.%' or action = 'dropship.closed_by_merchant'`)).map((r) => r.action);
  const need = ['saas_billing.proposed', 'saas_billing.approved', 'saas_billing.rejected', 'saas_billing.withdrawn', 'saas_billing.override_set', 'saas_billing.started_on_date',
    'ds_plan.proposed', 'ds_plan.approved', 'ds_plan.chosen', 'ds_plan.charged', 'ds_plan.paused', 'ds_team.role_changed', 'ds_team.invited', 'ds_team.invite_accepted',
    'ds_health.retry', 'ds_health.dead_letter', 'dropship.closed_by_merchant'];
  ok(need.every((a) => audits.includes(a)), `audit rows written${need.filter((a) => !audits.includes(a)).map((a) => ' (missing ' + a + ')').join('')}`);
  const testJournals = (await all(`select distinct j.id from journals j join ledger_entries le on le.journal_id = j.id where le.org_id = any($1::uuid[])`, [[B.org, D.org]])).map((r) => r.id);
  ok(await journalsBalanced([...new Set([...testJournals, ...journalsMade.filter(Boolean)])]), `every journal of the test is balanced (${testJournals.length})`);
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c && BigInt(l.d) >= BigInt(ledgerBefore.d), `ledger debit = credit (${l.d} = ${l.c})`);
  ok((await walletOf(D.org)) === 5000 - 4900 && (await walletOf(B.org)) === 5100, 'wallet totals: top-ups − plan charges = balance');
  const docsAfter = Number((await one(`select count(*) n from documents where doc_type = 'commercial_invoice' and org_id = any($1::uuid[])`, [[A.org, B.org, C.org, D.org, E.org, L.org, R.org]])).n);
  ok(docsAfter - docsBefore === 2, `documents: exactly the two plan invoices (${docsAfter - docsBefore}), none while fees were off`);
  if (feats) await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(feats)]);

  // ── 12. down → up ──
  if (ctx.DOWN && ctx.UP) {
    await owner();
    let skipped = false;
    try { await ctx.unwindLater(db); } catch (e) { if (e.skipRoundTrip) skipped = true; else throw e; }
    if (!skipped) {
      const snap = async () => JSON.stringify(await all(`
        select 'fn' k, p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '') x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') from information_schema.columns where table_schema = 'public'
        union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') from pg_policies where schemaname = 'public'
        union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
        union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
        union all select 'tg', tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
        union all select 'acl', c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace
        order by 1, 2`));
      const withIt = await snap();
      await db.query(ctx.DOWN);
      const without = await snap();
      const gone = await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES]);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS, ...SERVICE_FNS]])).n);
      const guard = (await one(`select pg_get_functiondef('public.guard_saas_billing_settings_locked'::regproc) d`)).d;
      ok(Number(gone.n) === 0 && fnLeft === 0 && !/octopus\.saas_switch/.test(guard), 'down: every DS12 table and function is gone; the original write lock is back');
      await db.query(ctx.UP);
      ok((await snap()) === withIt, 'up again: identical schema (functions + grants, columns, policies, constraints, indexes, triggers, table ACLs)');
      await db.query(ctx.UP);
      ok((await snap()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snap()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      await ctx.reapplyLater(db);
    }
  }
  return failed;
}

// ───────── staging runner ─────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { config } = await import('dotenv');
  const pg = (await import('pg')).default;
  config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
  if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
    console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
    process.exit(1);
  }
  const { assertStagingDatabase } = await import('../../scripts/lib-staging-guard.mjs');
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ds12_billing_reports_health.sql'));
  if (!MIG) { console.error('✘ DS12 migration file not found'); process.exit(1); }
  const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
  const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  let later = [];
  let failed = 0;
  try {
    await db.query('begin');
    failed = await runDs12Checks(db, {
      UP, DOWN, MIG, staging: true,
      unwindLater: async (c) => { later = await appliedAfter(c, MIG); await unwind(c, later, MAX_UNWIND); },
      reapplyLater: async (c) => { await reapply(c, later); },
    });
  } catch (e) {
    console.log('✘ unexpected error: ' + e.message);
    failed++;
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  console.log(failed ? `\nds12-dropship: ${failed} check(s) failed` : '\nds12-dropship: all passed');
  process.exitCode = failed ? 1 : 0;
}
