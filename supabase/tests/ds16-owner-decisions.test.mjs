// DS16 · Owner decisions of 26 Nov 2026 — DB checks for migration *_ds16_owner_decisions.
// STAGING ONLY, one rolled-back transaction, acting as staff / merchants / suppliers / the service role through JWT claims (what PostgREST does).
//  0. Structure: 3 new tables with RLS and no grant for signed-in users; RPCs revoked from anon; internals not callable; search_path=public.
//  1. Owner values seeded as settings (deposit 30 / 50, markup 10, launch countries, US DDP no de minimis, refund rules, supplier rules).
//  2. Shipping markup: merchant shipping line = rate-card cost × (1 + markup), half-up; staff see the cost, merchants never; two people
//     change it (proposer refused, a second person approves); no other write path (even set_setting by an admin); history for re-weighs.
//  3. Processing fee US$1.20 + US$0.40 as a fee version: proposed by one, the proposer can't activate, a second person activates; quotes use it.
//  4. US = DDP only: a DAP quote is charged DDP, merchants can't save DAP for the US; a country rule's de minimis caps the duty table's.
//  5. Turnkey: standard quote 30 %, custom / branded project 50 % (frozen on the quote); flag needs a reason; admins set the custom %;
//     T6 balance gate present.
//  6. Refund rules: approval limit from the setting; lost only after 15 days without movement; damaged / wrong item within 7 days.
//  7. Release 6: price changes (decrease auto, ≤3 % auto + staff notified, >3 % review, >5 % in 30 days review, no rule → review); rules
//     saves keep other keys; merchant-brand slip (no Octopus, no merchant company, no prices); supplier application and bank details
//     need two different people.
//  8. Audit rows.
//  9. down → up → up → down: identical schema; the down puts the seeded settings back (later migrations unwound / re-applied).
// Run: node supabase/tests/ds16-owner-decisions.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runDs16Checks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal1', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const err = async (q, p) => {
    await db.query('savepoint ds16');
    try { await db.query(q, p); await db.query('release savepoint ds16'); return ''; }
    catch (e) { await db.query('rollback to savepoint ds16'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint ds16r');
    try { const r = (await db.query(q, p)).rows[0]?.r; await db.query('release savepoint ds16r'); return r; }
    catch (e) { await db.query('rollback to savepoint ds16r'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const TABLES = ['dropship_setting_changes', 'supplier_bank_detail_changes', 'ds16_settings_backup'];
  const RPC_FNS = ['tk_set_project_custom', 'tk_set_deposit_pct_custom', 'ds16_markup_page', 'ds16_markup_propose', 'ds16_markup_decide', 'ds16_markup_withdraw',
    'ds16_supplier_bank_page', 'ds16_supplier_bank_propose', 'ds16_supplier_bank_decide', 'ds_staff_rules_save_v2'];
  const INTERNAL_FNS = ['ds16_shipping_markup_pct', 'ds16_markup_pct_at', 'ds16_country_rule', 'ds16_last_movement_at', 'ds16_notify_ds_staff', 'ds16_markup_can',
    'tk_deposit_pct_custom', 'ds16_guard_protected_settings', 'ds16_duty_mode_guard', 'ds16_supplier_application_guard'];
  const setting = async (k) => (await one(`select value from site_settings where key = $1`, [k]))?.value ?? null;
  const ownerSet = async (k, v) => {
    await owner();
    await db.query(`select set_config('octopus.ds16_setting_change', 'on', true)`);
    if (v === null) await db.query(`delete from site_settings where key = $1`, [k]);
    else await db.query(`insert into site_settings (key, value, is_public) values ($1, $2::jsonb, false) on conflict (key) do update set value = excluded.value`, [k, JSON.stringify(v)]);
    await db.query(`select set_config('octopus.ds16_setting_change', '', true)`);
  };

  // ── 0. structure ──
  await owner();
  const rls = await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === 3 && rls.every((r) => r.relrowsecurity), 'three new tables, RLS on');
  const grants = await all(`select table_name, grantee from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [TABLES]);
  ok(grants.length === 0, `no table grant for anon / signed-in users (RPC only)${grants.length ? ' — ' + grants.map((g) => g.table_name + ':' + g.grantee).join(',') : ''}`);
  const fns = await all(`select p.proname, p.proconfig::text cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists with search_path=public');
  ok(fns.every((f) => !f.anon_x), 'anon executes none of them');
  ok(fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x) && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x),
    'signed-in users execute the RPCs only, never the internals / trigger functions');
  const cols = await all(`select table_name || '.' || column_name c from information_schema.columns where table_schema = 'public'
    and ((table_name = 'tk_client_projects' and column_name = 'custom_branded') or (table_name = 'supplier_applications' and column_name in ('first_approved_by', 'first_approved_at')))`);
  ok(cols.length === 3, 'new columns: tk_client_projects.custom_branded, supplier_applications.first_approved_by / _at');
  const trg = await all(`select tgname from pg_trigger where not tgisinternal and tgname in ('trg_ds16_protected_settings', 'trg_ds16_duty_mode_guard', 'trg_ds16_supplier_application_guard')`);
  ok(trg.length === 3, 'three guard triggers installed');

  // ── 1. owner values ──
  const S = {};
  for (const k of ['turnkey.deposit_pct', 'turnkey.deposit_pct_custom', 'dropship.shipping_markup_pct', 'dropship_launch_countries', 'dropship.country_duty_rules',
    'dropship.claim_window_days', 'dropship.lost_after_days', 'dropship.reweigh_dispute_days', 'dropship.claim_second_approver_over_cents', 'dropship_supplier_rules', 'dropship.returns']) S[k] = await setting(k);
  ok(S['turnkey.deposit_pct'] === 30 && S['turnkey.deposit_pct_custom'] === 50, 'Turnkey deposit 30 %, custom / branded 50 % (settings)');
  ok(S['dropship.shipping_markup_pct'] === 10, 'shipping markup 10 % (setting)');
  ok(JSON.stringify(S.dropship_launch_countries) === JSON.stringify(['AE', 'SA', 'GB', 'US']), 'launch countries AE, SA, GB, US');
  ok(S['dropship.country_duty_rules']?.US?.incoterm === 'DDP' && S['dropship.country_duty_rules']?.US?.de_minimis_cents === 0, 'US = DDP, de minimis 0');
  ok(S['dropship.claim_window_days'] === 7 && S['dropship.lost_after_days'] === 15 && S['dropship.reweigh_dispute_days'] === 7 && S['dropship.claim_second_approver_over_cents'] === 100000,
    'refund rules: photos 7 days, lost after 15 days, re-weigh disputes 7 days, second Finance approver above US$1,000');
  ok(S.dropship_supplier_rules?.price_auto_pct === 3 && S.dropship_supplier_rules?.price_cum_30d_pct === 5, 'supplier price rules: auto ≤ 3 %, review above 5 % in 30 days');
  ok(/your own store policy/.test(S['dropship.returns'] ?? '') && /return shipping/.test(S['dropship.returns'] ?? ''), 'buyer remorse text: the merchant\'s policy, the merchant pays return shipping');
  const le = await one(`select legal_name, is_default, status from legal_entities where is_default and status = 'active'`);
  ok(le?.legal_name === 'Shenzhen Octopus Trading Co., Ltd.', 'legal entity: Shenzhen Octopus Trading Co., Ltd. is the active default (unchanged)');
  ok((await one(`select ds16_markup_pct_at(now() - interval '400 days') a, ds16_markup_pct_at(now()) b`)).b == 10, 'markup history: 10 % in force now (seeded row)');
  ok(Number((await one(`select ds16_markup_pct_at('2000-01-01') a`)).a) === 0, 'markup history: none before DS16 (older orders compare at cost)');

  // ── fixtures ──
  const mkUser = async (tag, role = null) => {
    await owner();
    const mail = `ds16-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `DS16 ${tag}`, mail]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const ORG_NAME = `TEST – DS16 merchant ${stamp}`;
  const mkMerchant = async (tag) => {
    const uid = await mkUser(tag);
    const org = (await one(`insert into organizations (name, country, kyc_status, is_seed) values ($1, 'AE', 'verified', true) returning id`, [tag === 'ma' ? ORG_NAME : `TEST – DS16 ${tag} ${stamp}`])).id;
    await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, uid]);
    await db.query(`insert into company_services (org_id, service, status, started_at) values ($1, 'dropship', 'on', now()) on conflict (org_id, service) do update set status = 'on', started_at = excluded.started_at`, [org]);
    return { uid, org };
  };
  const mkSupplier = async (tag) => {
    await owner();
    const uid = await mkUser(`sup-${tag}`, 'supplier');
    const s = await one(`insert into suppliers (legal_name, country, verified, user_id) values ($1, 'CN', true, $2) returning id, code`, [`TEST DS16 supplier ${tag} ${stamp}`, uid]);
    await db.query(`insert into supplier_switches (supplier_id, portal_login, product_upload) values ($1, true, true) on conflict (supplier_id) do update set portal_login = true, product_upload = true`, [s.id]);
    return { uid, id: s.id, code: s.code };
  };
  const adminA = await mkUser('admin-a', 'admin');
  const adminB = await mkUser('admin-b', 'admin');
  const M = await mkMerchant('ma');
  const SUP = await mkSupplier('one');
  const featsBefore = await setting('dropship_features');
  const ALL_ON = Object.fromEntries(['dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support', 'stores', 'import_list',
    'pushed', 'pricing', 'packing', 'orders', 'reports', 'billing', 'samples'].map((k) => [k, true]));
  await db.query(`insert into site_settings (key, value, is_public) values ('dropship_features', $1::jsonb, false) on conflict (key) do update set value = excluded.value`, [JSON.stringify(ALL_ON)]);

  // an active variant with weight + box on a rate-carded destination
  const v = await one(`select v.id, i.hs_code from dropship_variants v join dropship_products p on p.id = v.product_id join item_master i on i.id = v.item_id
     where p.status = 'active' and i.weight_g > 0 and i.box_l_cm > 0 and i.box_w_cm > 0 and i.box_h_cm > 0
       and exists (select 1 from shipping_rate_cards rc where rc.active and rc.country = 'AE' and rc.method = 'standard')
       and exists (select 1 from shipping_rate_cards rc where rc.active and rc.country = 'US' and rc.method = 'standard')
     order by v.created_at limit 1`);
  ok(Boolean(v), 'fixture: an active Dropship variant with weight and size, AE + US standard rate cards');

  // ── 2. shipping markup ──
  const q = async (country, inc = 'DDP', qty = 1, extra = {}) => rpc(`select get_dropship_order_quote($1::jsonb, $2, 'standard', $3) r`, [JSON.stringify([{ variant_id: v.id, qty, ...extra }]), country, inc]);
  if (v) {
    await as(adminA, 'aal2');
    const qs = await q('AE');
    const halfUp = (c, pct) => Math.round((c * (100 + pct)) / 100);
    ok(qs.ok === true && Number(qs.shipping_cost_cents) > 0 && Number(qs.shipping_cents) === halfUp(Number(qs.shipping_cost_cents), 10) && Number(qs.shipping_markup_pct) === 10,
      `staff quote: shipping ${qs.shipping_cents} = cost ${qs.shipping_cost_cents} × 1.10, whole cents, half up`);
    ok(Number(qs.total_known_cents) === Number(qs.product_cents) + Number(qs.processing_cents) + Number(qs.shipping_cents) + Number(qs.duties_cents ?? 0), 'the total adds the marked-up shipping line (integer cents)');
    const rcCost = await one(`select base_cents, per_100g_cents, step_g, fuel_surcharge_bp from shipping_rate_cards where id = $1`, [qs.version_ids.shipping_rate_card_id]);
    const cost = Number(rcCost.base_cents) + (Number(qs.billed_weight_g) / Number(rcCost.step_g)) * Number(rcCost.per_100g_cents);
    ok(Number(qs.shipping_cost_cents) === cost + Math.round((cost * Number(rcCost.fuel_surcharge_bp)) / 10000), 'the cost behind it is the rate card unchanged (rate cards stay at cost)');
    // a markup with a half cent: 7.5 %
    await ownerSet('dropship.shipping_markup_pct', 7.5);
    await as(adminA, 'aal2');
    const q75 = await q('AE');
    ok(Number(q75.shipping_cents) === halfUp(Number(q75.shipping_cost_cents), 7.5), `7.5 %: ${q75.shipping_cost_cents} → ${q75.shipping_cents} (half up)`);
    await ownerSet('dropship.shipping_markup_pct', null);
    await as(adminA, 'aal2');
    const q0 = await q('AE');
    ok(Number(q0.shipping_cents) === Number(q0.shipping_cost_cents), 'markup not set → shipping at cost (no made-up markup)');
    await ownerSet('dropship.shipping_markup_pct', 10);
    // merchant view: no cost / markup keys (merchant quote path: the market must be enabled)
    await owner();
    await db.query(`insert into dropship_markets (org_id, country) values ($1, 'AE') on conflict do nothing`, [M.org]);
    await as(M.uid);
    const qm = await q('AE');
    ok(!qm.__error && !('shipping_cost_cents' in qm) && !('shipping_markup_pct' in qm) && !JSON.stringify(qm).includes('markup'), 'merchant quote: no carrier cost or markup in the answer');
  }
  // two-person change
  await as(adminA, 'aal2');
  const page0 = await rpc(`select ds16_markup_page() r`);
  ok(Number(page0.pct) === 10 && page0.can_propose && page0.can_approve && page0.pending === null && page0.history.some((h) => h.status === 'seeded'), 'staff card: 10 % in force, history starts with the owner decision');
  ok(/INVALID_INPUT/.test(await err(`select ds16_markup_propose(101, 'too much')`)) && /INVALID_INPUT/.test(await err(`select ds16_markup_propose(10.123, 'three decimals')`)), 'markup outside 0–100 / more than 2 decimals refused');
  ok(/REASON_REQUIRED/.test(await err(`select ds16_markup_propose(12, '')`)), 'a reason is required');
  ok(/NO_CHANGE/.test(await err(`select ds16_markup_propose(10, 'same value')`)), 'proposing the same value refused');
  const prop = await rpc(`select ds16_markup_propose(12, 'Carrier surcharge season') r`);
  ok(prop.status === 'pending', 'proposed: waiting for a second person');
  ok(/PROPOSAL_PENDING/.test(await err(`select ds16_markup_propose(11, 'another')`)), 'one pending proposal at a time');
  ok(/SECOND_PERSON_REQUIRED/.test(await err(`select ds16_markup_decide($1, true, null)`, [prop.id])), 'the proposer cannot approve it');
  ok(Number(await setting('dropship.shipping_markup_pct')) === 10, 'nothing changed before the second person');
  await as(M.uid);
  ok(/FORBIDDEN/.test(await err(`select ds16_markup_page()`)) && /FORBIDDEN/.test(await err(`select ds16_markup_decide($1, true, null)`, [prop.id])), 'a merchant can neither read nor decide the markup');
  await as(null, 'aal1', 'anon');
  ok(/permission denied/.test(await err(`select ds16_markup_page()`)), 'anon: permission denied');
  await as(adminB, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select ds16_markup_decide($1, true, null)`, [prop.id])), 'an approver without 2FA (aal1) is refused');
  await as(adminB, 'aal2');
  ok(/REASON_REQUIRED/.test(await err(`select ds16_markup_decide($1, false, '')`, [prop.id])), 'rejecting needs a reason');
  const dec = await rpc(`select ds16_markup_decide($1, true, 'OK') r`, [prop.id]);
  ok(dec.approved === true && Number(await setting('dropship.shipping_markup_pct')) === 12, 'a second person approves: the setting is 12 %');
  await owner();
  const row = await one(`select status, proposed_by, decided_by from dropship_setting_changes where id = $1`, [prop.id]);
  ok(row.status === 'approved' && row.proposed_by === adminA && row.decided_by === adminB, 'history: proposed by one, approved by another');
  ok(Number((await one(`select ds16_markup_pct_at(now()) p`)).p) === 12, 'the re-weigh check now uses 12 % for orders placed from now on');
  if (v) { await as(adminA, 'aal2'); const q12 = await q('AE'); ok(Number(q12.shipping_cents) === Math.round((Number(q12.shipping_cost_cents) * 112) / 100), 'new quotes use the approved 12 %'); }
  // no other write path
  await owner();
  ok(/TWO_PERSON_SETTING/.test(await err(`update site_settings set value = '50'::jsonb where key = 'dropship.shipping_markup_pct'`)), 'direct table write refused (even the database owner without the flag)');
  ok(/TWO_PERSON_SETTING/.test(await err(`delete from site_settings where key = 'dropship.shipping_markup_pct'`)), 'deleting the setting refused');
  await as(adminA, 'aal2');
  ok(/TWO_PERSON_SETTING/.test(await err(`select set_setting('dropship.shipping_markup_pct', '50'::jsonb)`)), 'an admin\'s generic set_setting refused for the markup');
  ok(/permission denied|TWO_PERSON/.test(await err(`insert into dropship_setting_changes (key, new_value, status, proposed_by, decided_by, decided_at) values ('dropship.shipping_markup_pct', '1'::jsonb, 'approved', $1, $2, now())`, [adminA, adminB])),
    'staff cannot write the history table directly');
  await owner();
  ok(/two_person/.test(await err(`insert into dropship_setting_changes (key, new_value, status, proposed_by, decided_by, decided_at) values ('dropship.shipping_markup_pct', '1'::jsonb, 'approved', $1, $1, now())`, [adminA])),
    'table CHECK: approved needs a different approver');
  // withdraw
  await as(adminA, 'aal2');
  const p2 = await rpc(`select ds16_markup_propose(9, 'Try lower') r`);
  await as(adminB, 'aal2');
  ok(/NOT_YOURS/.test(await err(`select ds16_markup_withdraw($1)`, [p2.id])), 'only the proposer withdraws');
  await as(adminA, 'aal2');
  ok((await rpc(`select ds16_markup_withdraw($1) r`, [p2.id])).ok === true && Number(await setting('dropship.shipping_markup_pct')) === 12, 'withdrawn: the value stays');

  // ── 3. processing fee US$1.20 + US$0.40 ──
  await as(adminA, 'aal2');
  const active = await one(`select packaging_cents, storage_per_cbm_day_cents, return_handling_cents from fee_versions where status = 'active'`);
  const fvId = (await rpc(`select propose_fee_version(120, 40, $1, $2, $3, 'Owner decision 26 Nov: US$1.20 + US$0.40', null, null, 7, null) r`,
    [active?.packaging_cents ?? 0, active?.storage_per_cbm_day_cents ?? 0, active?.return_handling_cents ?? 0]));
  ok(typeof fvId === 'string', 'fee version 1.20 / 0.40 proposed (pending approval)');
  ok(/TWO_PERSON_REQUIRED/.test(await err(`select activate_fee_version($1, null)`, [fvId])), 'the proposer cannot activate it');
  await as(adminB, 'aal2');
  const act = await rpc(`select activate_fee_version($1, 'Second approver') r`, [fvId]);
  await owner();
  const fv = await one(`select status, pick_pack_first_cents f, pick_pack_extra_cents e, packaging_cents p, proposed_by, approved_by from fee_versions where id = $1`, [fvId]);
  ok(!act?.__error && fv.status === 'active' && Number(fv.f) === 120 && Number(fv.e) === 40 && fv.proposed_by === adminA && fv.approved_by === adminB, 'a second person activates it');
  if (v) {
    await as(adminA, 'aal2');
    const q3 = await q('AE', 'DDP', 3);
    ok(Number(q3.processing_cents) === 120 + 2 * 40 + Number(fv.p) && q3.version_ids.fee_version_id === fvId, `quote: processing for 3 items = 1.20 + 2 × 0.40 + packaging = ${q3.processing_cents}`);
  }

  // ── 4. US = DDP, no de minimis ──
  if (v) {
    await as(adminA, 'aal2');
    const qus = await q('US', 'DAP');
    ok(qus.ok === true && qus.incoterm === 'DDP' && qus.ddp_only === true && qus.duties_label !== 'Duties paid by buyer', 'US: a DAP quote is charged DDP (duties always charged)');
    ok(qus.duties_cents === null ? qus.duties_status === 'not_known_yet' && qus.total_cents === null : Number(qus.duties_cents) >= 0, 'US duties unknown stay unknown (null, never 0)');
    const qgb = await q('GB', 'DAP');
    ok(!qgb.ok || qgb.incoterm === 'DAP', 'GB: DAP is still allowed');
    // the country rule's de minimis caps the duty table's (checked on AE where the active duty table has a de minimis)
    await owner();
    const dl = await one(`select lookup_duty_rate('AE', $1) d`, [v.hs_code]);
    if (dl?.d && Number(dl.d.de_minimis_cents) > 0) {
      await as(adminA, 'aal2');
      const base = await q('AE');
      await ownerSet('dropship.country_duty_rules', { US: { incoterm: 'DDP', de_minimis_cents: 0 }, AE: { de_minimis_cents: 0 } });
      await as(adminA, 'aal2');
      const capped = await q('AE');
      const decl = Number(base.declared_value_usd_cents);
      const full = Math.round((decl * (Number(dl.d.duty_bp) + Number(dl.d.tax_bp))) / 10000);
      ok(decl <= Number(dl.d.de_minimis_cents) && Number(capped.duties_cents) === full && Number(capped.duties_cents) >= Number(base.duties_cents),
        `de minimis 0 in the country rule: full duty + tax charged (${base.duties_cents} → ${capped.duties_cents})`);
      await ownerSet('dropship.country_duty_rules', { US: { incoterm: 'DDP', de_minimis_cents: 0 } });
    } else ok(true, 'de minimis cap: no active duty row with a de minimis for this item (nothing to compare)');
  }
  await owner();
  ok(/DDP_ONLY/.test(await err(`insert into dropship_duty_modes (org_id, country, mode) values ($1, 'US', 'DAP')`, [M.org])), 'merchants cannot save DAP for the US');
  ok(!(await err(`insert into dropship_duty_modes (org_id, country, mode) values ($1, 'GB', 'DAP')`, [M.org])), 'DAP for GB still saves');

  // ── 5. Turnkey ──
  await owner();
  const mkProject = async (title) => {
    const p = await one(`insert into tk_client_projects (title, stage, status, org_id) values ($1, 'sourcing', 'open', $2) returning id, code`, [title, M.org]);
    const qv = await one(`insert into tk_client_quotes (project_id, version, status, total_cents, created_by) values ($1, 1, 'draft', 1000001, $2) returning id`, [p.id, adminA]);
    await db.query(`insert into tk_client_quote_lines (project_id, quote_id, line_no, description, qty, unit_price_cents, total_cents) values ($1, $2, 1, 'Shop fit-out', 1, 1000001, 1000001)`, [p.id, qv.id]);
    return { ...p, quote: qv.id };
  };
  const P1 = await mkProject(`DS16 standard ${stamp}`);
  const P2 = await mkProject(`DS16 branded ${stamp}`);
  await as(adminA, 'aal2');
  const s1 = await rpc(`select tk_send_client_quote($1) r`, [P1.quote]);
  ok(s1.deposit_pct === 30 && Number(s1.deposit_cents) === Math.floor((1000001 * 30 + 50) / 100) && s1.custom_branded === false, `standard project: 30 % deposit (${s1.deposit_cents} cents, half up)`);
  ok(/REASON_REQUIRED/.test(await err(`select tk_set_project_custom($1, true, '')`, [P2.id])), 'marking custom / branded needs a reason');
  await as(M.uid);
  ok(/FORBIDDEN/.test(await err(`select tk_set_project_custom($1, true, 'client asks')`, [P2.id])), 'a client cannot mark it');
  await as(adminA, 'aal2');
  const c2 = await rpc(`select tk_set_project_custom($1, true, 'Branded packaging and custom moulds') r`, [P2.id]);
  ok(c2.custom_branded === true && c2.deposit_pct === 50, 'project marked custom / branded → next quote 50 %');
  ok(/NO_CHANGE/.test(await err(`select tk_set_project_custom($1, true, 'again please')`, [P2.id])), 'marking it twice refused');
  const sq = await rpc(`select tk_staff_quotes($1) r`, [P2.id]);
  ok(sq.deposit_pct === 50 && sq.custom_branded === true && sq.deposit_pct_standard === 30 && sq.deposit_pct_custom === 50, 'staff quotes show the % this project will take');
  const s2 = await rpc(`select tk_send_client_quote($1) r`, [P2.quote]);
  ok(s2.deposit_pct === 50 && Number(s2.deposit_cents) === Math.floor((1000001 * 50 + 50) / 100), `custom / branded quote sent with 50 % (${s2.deposit_cents} cents)`);
  await owner();
  ok(Number((await one(`select deposit_pct from tk_client_quotes where id = $1`, [P2.quote])).deposit_pct) === 50, 'the % is frozen on the sent quote');
  await as(adminA, 'aal2');
  await rpc(`select tk_set_project_custom($1, false, 'Back to standard') r`, [P2.id]);
  await owner();
  ok(Number((await one(`select deposit_pct from tk_client_quotes where id = $1`, [P2.quote])).deposit_pct) === 50, 'changing the flag later does not touch the sent quote');
  await ownerSet('turnkey.deposit_pct_custom', null);
  await owner();
  await db.query(`update tk_client_projects set custom_branded = true where id = $1`, [P1.id]);
  const P3q = await one(`insert into tk_client_quotes (project_id, version, status, total_cents, created_by) values ($1, 2, 'draft', 5000, $2) returning id`, [P1.id, adminA]);
  await db.query(`insert into tk_client_quote_lines (project_id, quote_id, line_no, description, qty, unit_price_cents, total_cents) values ($1, $2, 1, 'Extra', 1, 5000, 5000)`, [P1.id, P3q.id]);
  await as(adminA, 'aal2');
  ok(/DEPOSIT_CUSTOM_NOT_SET/.test(await err(`select tk_send_client_quote($1)`, [P3q.id])), 'custom % not set → the quote is not sent (never a made-up deposit)');
  const st = await rpc(`select tk_settings() r`);
  ok(st.deposit_pct === 30 && st.deposit_pct_custom === null, 'Turnkey settings: custom deposit shows as not set');
  await rpc(`select tk_set_deposit_pct_custom(50) r`);
  ok((await rpc(`select tk_settings() r`)).deposit_pct_custom === 50 && /INVALID_DEPOSIT/.test(await err(`select tk_set_deposit_pct_custom(0)`)), 'an admin sets the custom deposit (1–100)');
  const stf = await mkUser('support', 'support');
  await as(stf, 'aal2');
  ok(/FORBIDDEN|permission denied/.test(await err(`select tk_set_deposit_pct_custom(40)`)), 'only admins set the custom deposit');
  await owner();
  const gate = await one(`select coalesce(bool_or(p.proname = 'tk_move_project_stage' and pg_get_functiondef(p.oid) ~ 'BALANCE_NOT_PAID'), false) a,
    coalesce(bool_or(p.proname = 'tk_create_shipment' and pg_get_functiondef(p.oid) ~ 'NOT_IN_SHIPMENT'), false) b
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tk_move_project_stage', 'tk_create_shipment')`);
  ok(gate.a && gate.b, 'T6: the Shipment phase needs the balance paid and shipments are booked only in that phase (unchanged)');

  // ── 6. refund rules ──
  await owner();
  ok(Number((await one(`select ds10_approval_limit_cents() l`)).l) === 100000, 'second Finance approver above US$1,000 (from the setting)');
  await ownerSet('dropship.claim_second_approver_over_cents', 50000);
  ok(Number((await one(`select ds10_approval_limit_cents() l`)).l) === 50000, 'the limit follows the setting');
  await ownerSet('dropship.claim_second_approver_over_cents', 100000);
  const mkOrder = async (o = {}) => { await owner(); return (await one(`insert into store_orders (org_id, channel, external_order_id, external_order_name, buyer_name, shipping_address, destination_country, buyer_currency,
      shipping_method, incoterm, product_cents, processing_cents, shipping_cents, total_cents, payment_state, staff_stage, merchant_status, delivered_at)
    values ($1, 'shopify', $2, $3, 'Ben Meyer', '{"line1":"5 Rue Test","city":"Paris","postcode":"75001","country":"FR"}'::jsonb, 'FR', 'USD', 'standard', 'DDP', 1000, 100, 200, 1300, 'paid', $4, 'processing', $5) returning id, org_id`,
    [M.org, `X-${stamp}-${Math.random().toString(36).slice(2, 7)}`, `#DS16-${Math.random().toString(36).slice(2, 7)}`, o.stage ?? 'handed_over', o.delivered ?? null])); };
  const o1 = await mkOrder();
  await db.query(`insert into dropship_partner_orders (store_order_id, supplier_id, status, shipped_at, tracking_no, carrier) values ($1, $2, 'shipped', now() - interval '3 days', 'YT1234567890', 'yunexpress')`, [o1.id, SUP.id]);
  await as(M.uid);
  const tooEarly = await err(`select ds10_claim_open($1, 'lost', 'refund', 'Nothing arrived yet, buyer worried.', '{}')`, [o1.id]);
  ok(/TOO_EARLY/.test(tooEarly) && /15 days/.test(tooEarly), 'lost: refused while the parcel moved less than 15 days ago (says from when)');
  await owner();
  await db.query(`update dropship_partner_orders set shipped_at = now() - interval '16 days' where store_order_id = $1`, [o1.id]);
  await as(M.uid);
  const lost = await rpc(`select ds10_claim_open($1, 'lost', 'refund', 'No tracking movement for over two weeks.', '{}') r`, [o1.id]);
  ok(lost?.ok === true, 'lost: allowed after 15 days without movement (reship or wallet refund)');
  const o2 = await mkOrder({ stage: 'delivered', delivered: new Date(Date.now() - 8 * 864e5).toISOString() });
  await as(M.uid);
  const late = await err(`select ds10_claim_open($1, 'damaged', 'refund', 'Arrived broken, see photos.', '{}')`, [o2.id]);
  ok(/TOO_LATE/.test(late) && /7 days/.test(late), 'damaged / wrong item: refused 8 days after delivery (7-day window)');
  const o3 = await mkOrder({ stage: 'delivered', delivered: new Date(Date.now() - 3 * 864e5).toISOString() });
  await as(M.uid);
  ok(/PHOTO_REQUIRED/.test(await err(`select ds10_claim_open($1, 'damaged', 'refund', 'Wrong colour was sent.', '{}')`, [o3.id])), 'damaged / wrong item within 7 days: open, photos required');
  await owner();
  ok(/dropship\.reweigh_dispute_days/.test((await one(`select pg_get_functiondef('public.ds10_reweigh_calc(uuid)'::regprocedure) d`)).d)
     && /ds16_markup_pct_at\(so\.created_at\)/.test((await one(`select pg_get_functiondef('public.ds10_reweigh_calc(uuid)'::regprocedure) d`)).d),
    're-weigh: dispute window from the setting when the fee version has none; shipping compared with the markup of the order date');
  ok(/Packing has started/.test((await one(`select pg_get_functiondef('public.ds_order_cancel_core(uuid,text,text)'::regprocedure) d`)).d), 'cancel before packing = full wallet refund; after packing refused (DS8 rule, unchanged)');

  // ── 7a. supplier price changes ──
  await owner();
  const prodId = (await one(`select id from products order by created_at limit 1`)).id;
  await db.query(`insert into supplier_products (supplier_id, product_id, supplier_model, stock_qty) values ($1, $2, $3, 5) on conflict do nothing`, [SUP.id, prodId, `M-${SUP.code}`]);
  const mkPrice = async (minor, moq) => { await owner(); return (await one(`insert into supplier_product_prices (supplier_id, product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from)
     values ($1, $2, 'EXW', $3, '', $4, 'USD', current_date - 40) returning id`, [SUP.id, prodId, moq, minor])).id; };
  const cur = async (moq) => (await one(`select id, price_minor from supplier_product_prices where supplier_id = $1 and moq_tier_min = $2 and not is_superseded`, [SUP.id, moq]));
  const pA = await mkPrice(1000, 1);
  const pB = await mkPrice(1000, 50);
  await as(SUP.uid);
  const dn = await rpc(`select ds_sup_price_change($1, 900) r`, [pA]);
  ok(dn.status === 'auto_approved' && dn.direction === 'decrease', 'decrease (−10 %): approved at once');
  await owner();
  ok(Number((await cur(1)).price_minor) === 900, 'the decrease is applied');
  await as(SUP.uid);
  const up2 = await rpc(`select ds_sup_price_change($1, 918) r`, [(await (async () => { await owner(); const c = await cur(1); await as(SUP.uid); return c.id; })())]);
  ok(up2.status === 'auto_approved' && Number(up2.pct) === 2, 'increase of 2 % (≤ 3 %): approved at once');
  await owner();
  const notes = await all(`select user_id from notifications where dedupe_key like $1`, [`ds16:price-up:${up2.id}:%`]);
  ok(notes.some((n) => n.user_id === adminA) && notes.some((n) => n.user_id === adminB), 'staff (admins / Dropship division) are notified of the automatic increase');
  const c918 = await cur(1);
  await as(SUP.uid);
  const up4 = await rpc(`select ds_sup_price_change($1, 955) r`, [c918.id]);
  ok(up4.status === 'submitted', 'increase of 4 % (> 3 %): goes to staff review');
  await owner();
  ok(Number((await cur(1)).price_minor) === 918, 'nothing applied while it waits');
  // cumulative: 1000 → 1030 (+3 %, auto) → 1059 (+2.8 %, 5.9 % over 30 days) → review
  await as(SUP.uid);
  const cA = await rpc(`select ds_sup_price_change($1, 1030) r`, [pB]);
  await owner();
  const cB0 = await cur(50);
  await as(SUP.uid);
  const cB = await rpc(`select ds_sup_price_change($1, 1059) r`, [cB0.id]);
  ok(cA.status === 'auto_approved' && cB.status === 'submitted' && Number(cB.cum_pct) > 5, `over 5 % within 30 days (${cB.cum_pct} %): staff review even though this step is ${cB.pct} %`);
  // rules saves keep the other keys; no rule → every increase reviewed, decreases still automatic
  await as(adminA, 'aal2');
  await rpc(`select ds_staff_rules_save(10, 3) r`);
  await owner();
  const r1 = await setting('dropship_supplier_rules');
  ok(r1.price_auto_pct === 10 && r1.ship_within_days === 3 && r1.price_cum_30d_pct === 5, 'the DS14 rules form keeps the 30-day limit');
  await as(adminA, 'aal2');
  ok(/BAD_RULE/.test(await err(`select ds_staff_rules_save_v2(3, null, 101)`)), '30-day limit above 100 % refused');
  const r2 = await rpc(`select ds_staff_rules_save_v2(3, null, 5) r`);
  ok(r2.price_auto_pct === 3 && r2.price_cum_30d_pct === 5 && !('ship_within_days' in r2), 'rules v2 saves all three (empty = off)');
  await as(stf, 'aal2');
  ok(/FORBIDDEN/.test(await err(`select ds_staff_rules_save_v2(3, null, 5)`)), 'non-Dropship staff cannot change the rules');
  await owner();
  await db.query(`delete from site_settings where key = 'dropship_supplier_rules'`);
  const pC = await mkPrice(2000, 100);
  await as(SUP.uid);
  ok((await rpc(`select ds_sup_price_change($1, 2010) r`, [pC])).status === 'submitted', 'no rule set: even a 0.5 % increase is reviewed');
  const pD = await mkPrice(2000, 200);
  await as(SUP.uid);
  ok((await rpc(`select ds_sup_price_change($1, 1990) r`, [pD])).status === 'auto_approved', 'no rule set: a decrease is still applied at once');
  await owner();
  const snap = await one(`select count(*)::int n from information_schema.columns where table_schema = 'public' and ((table_name = 'store_order_items' and column_name = 'unit_product_cents') or (table_name = 'store_orders' and column_name in ('shipping_cents', 'processing_cents', 'fee_version_id', 'shipping_rate_card_id')))`);
  ok(snap.n === 5 && Number((await one(`select count(*)::int n from pg_constraint where confrelid = 'public.supplier_product_prices'::regclass`)).n) === 0,
    'already-quoted prices never change: orders keep their own amounts and versions; nothing points at a supplier price row');

  // ── 7b. merchant-brand slip ──
  const LOGO = `logos/${'ab'.repeat(16)}.png`;
  await owner();
  const o4 = await mkOrder({ stage: 'paid_to_assign' });
  const po = (await one(`insert into dropship_partner_orders (store_order_id, supplier_id, status) values ($1, $2, 'to_ship') returning id`, [o4.id, SUP.id])).id;
  await as(SUP.uid);
  const slip0 = await rpc(`select ds_sup_slip($1) r`, [po]);
  ok(slip0.kind === 'dropship' && slip0.brand && slip0.brand.name === null && slip0.brand.logo_path === null, 'no brand set: the slip has no brand at all (never Octopus)');
  await owner();
  await db.query(`insert into dropship_seller_profiles (org_id, brand_name, return_name, return_line1, return_city, return_country, status) values ($1, 'Acme Pets', 'Acme', '1 Road', 'Dubai', 'AE', 'approved')
    on conflict (org_id) do update set brand_name = excluded.brand_name, status = 'approved'`, [M.org]);
  await db.query(`insert into dropship_merchant_settings (org_id, logo_path, show_logo_slip) values ($1, $2, true) on conflict (org_id) do update set logo_path = excluded.logo_path, show_logo_slip = true`, [M.org, LOGO]);
  await as(SUP.uid);
  const slip = await rpc(`select ds_sup_slip($1) r`, [po]);
  const js = JSON.stringify(slip);
  ok(slip.brand?.name === 'Acme Pets' && slip.brand?.logo_path === LOGO, 'Dropship slip: the merchant\'s approved brand name and slip logo');
  ok(!js.includes(ORG_NAME) && !/octopus/i.test(js) && !/price|cents|total/i.test(JSON.stringify(Object.keys(slip))), 'no merchant company, no Octopus, no prices on the slip data');
  await owner();
  await db.query(`update dropship_merchant_settings set show_logo_slip = false where org_id = $1`, [M.org]);
  await as(SUP.uid);
  ok((await rpc(`select ds_sup_slip($1) r`, [po])).brand.logo_path === null, 'the logo only when the merchant shows it on slips');

  // ── 7c. supplier application: two different people ──
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query('set local role service_role');
  const app = (await one(`select submit_supplier_application($1::jsonb) v`, [JSON.stringify({ company_name: `DS16 Factory ${stamp}`, city: 'Shenzhen', categories: ['Other'], contact_name: 'QA Li', contact_email: `qa-${stamp}@example.com` })])).v;
  await as(adminA, 'aal2');
  await rpc(`select review_supplier_application($1, 'approved', 'factory audit ok') r`, [app.id]);
  await owner();
  let a1 = await one(`select status, first_approved_by, reviewed_by from supplier_applications where id = $1`, [app.id]);
  ok(a1.status === 'in_review' && a1.first_approved_by === adminA && a1.reviewed_by === null, 'first approval recorded: still in review');
  await as(adminA, 'aal2');
  ok(/SECOND_PERSON_REQUIRED/.test(await err(`select review_supplier_application($1, 'approved', null)`, [app.id])), 'the same person cannot give the second approval');
  await owner();
  ok(/SECOND_PERSON_REQUIRED/.test(await err(`update supplier_applications set status = 'approved', reviewed_by = $2 where id = $1`, [app.id, adminA])), 'table trigger: approved needs two different people (any write path)');
  await as(adminB, 'aal2');
  await rpc(`select review_supplier_application($1, 'approved', null) r`, [app.id]);
  await owner();
  a1 = await one(`select status, first_approved_by, reviewed_by, review_note from supplier_applications where id = $1`, [app.id]);
  ok(a1.status === 'approved' && a1.reviewed_by === adminB && a1.first_approved_by === adminA && a1.review_note === 'factory audit ok', 'second, different approver: approved (first note kept)');
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query('set local role service_role');
  const app2 = (await one(`select submit_supplier_application($1::jsonb) v`, [JSON.stringify({ company_name: `DS16 Factory B ${stamp}`, city: 'Ningbo', categories: ['Other'], contact_name: 'QA Wu', contact_email: `qb-${stamp}@example.com` })])).v;
  await as(adminA, 'aal2');
  await rpc(`select review_supplier_application($1, 'approved', null) r`, [app2.id]);
  await rpc(`select review_supplier_application($1, 'rejected', 'documents fake') r`, [app2.id]);
  await owner();
  ok((await one(`select first_approved_by from supplier_applications where id = $1`, [app2.id])).first_approved_by === null, 'a rejection clears the first approval');

  // ── 7d. supplier bank details: two different people ──
  const BANK = { account_name: 'Shenzhen Test Factory', bank_name: 'Bank of China', account_no: '6222 0000 1111 2345', swift: 'BKCHCNBJ', currency: 'USD', bank_country: 'CN' };
  await as(adminA, 'aal2');
  ok(/INVALID_INPUT/.test(await err(`select ds16_supplier_bank_propose($1, $2::jsonb, 'from the supplier')`, [SUP.id, JSON.stringify({ ...BANK, swift: 'BAD' })])), 'a bad SWIFT code is refused');
  const bp = await rpc(`select ds16_supplier_bank_propose($1, $2::jsonb, 'Letter from the supplier, stamped') r`, [SUP.id, JSON.stringify(BANK)]);
  ok(bp.status === 'pending', 'bank details proposed: pending');
  ok(/PROPOSAL_PENDING/.test(await err(`select ds16_supplier_bank_propose($1, $2::jsonb, 'again')`, [SUP.id, JSON.stringify(BANK)])), 'one pending change per supplier');
  ok(/SECOND_PERSON_REQUIRED/.test(await err(`select ds16_supplier_bank_decide($1, true, null)`, [bp.id])), 'the proposer cannot approve the bank details');
  const pg0 = await rpc(`select ds16_supplier_bank_page($1) r`, [SUP.id]);
  ok(pg0.current === null && pg0.pending?.id === bp.id, 'nothing in force until a second person approves');
  for (const [who, uid] of [['the supplier', SUP.uid], ['a merchant', M.uid]]) {
    await as(uid);
    ok(/FORBIDDEN|permission denied/.test(await err(`select ds16_supplier_bank_page($1)`, [SUP.id])) && /FORBIDDEN|permission denied/.test(await err(`select ds16_supplier_bank_decide($1, true, null)`, [bp.id])), `${who}: no access to bank details`);
  }
  await as(adminB, 'aal2');
  await rpc(`select ds16_supplier_bank_decide($1, true, 'Called the supplier back') r`, [bp.id]);
  const pg1 = await rpc(`select ds16_supplier_bank_page($1) r`, [SUP.id]);
  ok(pg1.current?.account_no === '6222000011112345' && pg1.current?.swift === 'BKCHCNBJ' && pg1.pending === null, 'approved by a second person: the details are in force');
  await owner();
  ok(/two_person/.test(await err(`update supplier_bank_detail_changes set decided_by = proposed_by where id = $1`, [bp.id])), 'table CHECK: the approver is never the proposer');

  // ── 8. audit ──
  await owner();
  const acts = (await all(`select distinct action from audit_log where action in ('ds_setting.proposed', 'ds_setting.approved', 'ds_setting.withdrawn', 'turnkey.project_custom', 'turnkey.quote_sent',
    'turnkey.deposit_pct_custom', 'supplier_application.first_approval', 'supplier_application.review', 'supplier_bank.proposed', 'supplier_bank.approved', 'ds_supplier_price.submitted', 'ds_supplier_rules.saved', 'fee_version.proposed', 'ds_case.opened')`)).map((r) => r.action);
  ok(acts.length === 14, `audit rows for every change (${acts.length}/14)`);
  const leak = await one(`select count(*)::int n from audit_log where action like 'supplier_bank.%' and details::text like '%6222000011112345%'`);
  ok(leak.n === 0, 'bank audit rows keep only the last 4 digits');
  const seededAudit = await one(`select count(*)::int n from audit_log where entity = 'site_settings' and details ->> 'source' = 'owner decision 26 Nov 2026 (migration 249)'`);
  ok(seededAudit.n >= 1, 'the seeded owner values are in the audit log');

  // restore what the test changed outside rolled-back data
  if (featsBefore) await db.query(`update site_settings set value = $1::jsonb where key = 'dropship_features'`, [JSON.stringify(featsBefore)]);

  // ── 9. down → up ──
  if (ctx.DOWN && ctx.UP) {
    await owner();
    let skipped = false;
    try { await ctx.unwindLater(db); } catch (e) { if (e.skipRoundTrip) skipped = true; else throw e; }
    if (!skipped) {
      const snapSchema = async () => JSON.stringify(await all(`
        select 'fn' k, p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '') x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') from information_schema.columns where table_schema = 'public'
        union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') from pg_policies where schemaname = 'public'
        union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
        union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
        union all select 'tg', tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
        union all select 'seq', sequencename from pg_sequences where schemaname = 'public'
        union all select 'acl', c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c where c.relnamespace = 'public'::regnamespace
        order by 1, 2`));
      const backup = await all(`select key, existed, row -> 'value' v from ds16_settings_backup order by key`);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const gone = await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES]);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      const qdef = (await one(`select pg_get_functiondef('public.get_dropship_order_quote(jsonb,text,text,text,text,numeric,text)'::regprocedure) d`)).d;
      ok(Number(gone.n) === 0 && fnLeft === 0 && !/ds16_/.test(qdef), 'down: every DS16 table and function is gone; the replaced functions are the installed ones again');
      let back = true;
      for (const b of backup) {
        const now = await one(`select value from site_settings where key = $1`, [b.key]);
        if (b.existed ? JSON.stringify(now?.value) !== JSON.stringify(b.v) : now !== undefined) { back = false; console.log('   setting not restored:', b.key); }
      }
      ok(back && backup.length === 11, 'down: every seeded setting is back to its value before the up (or removed when it did not exist)');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema (functions + grants, columns, policies, constraints, indexes, triggers, sequences, table ACLs)');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_ds16_owner_decisions.sql'));
  if (!MIG) { console.error('✘ DS16 migration file not found'); process.exit(1); }
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
    failed = await runDs16Checks(db, {
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
  console.log(failed ? `\nds16-owner-decisions: ${failed} check(s) failed` : '\nds16-owner-decisions: all passed');
  process.exitCode = failed ? 1 : 0;
}
