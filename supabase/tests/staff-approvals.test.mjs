// ODS T8 · Two-person approvals for staff money actions — DB checks for migration *_staff_approvals (255, DRAFT).
// STAGING ONLY, one rolled-back transaction, acting as staff through JWT claims (what PostgREST does).
// Self-contained: if 255 is not applied yet it is applied INSIDE the transaction (and rolled back with everything else).
//  0. Structure: table with RLS, column read grants only (no IPs), the two-person CHECK, guard trigger, setting seeded, RPC grants.
//  1. Limit from settings: at / below the limit nothing is recorded; above → waiting APR-n; limit change is honoured; a missing
//     setting means every amount needs approval; non-USD converted with today's converter.
//  2. Roles: who may request (finance / wallet / support create), who may decide (finance:approve), customers refused.
//  3. Self-approval blocked: RPC (MAKER_CANNOT_APPROVE) AND the table CHECK even for a direct owner write.
//  4. Decide: step-up 2FA, reject needs a reason, approve once (INVALID_TRANSITION after), decided rows immutable, no delete.
//  5. Audit: request / decision / execution rows with actor, before / after, IP.
//  6. Use: staff_approval_ready → today's money action → staff_approval_mark_executed (once).
//  7. Queue: staff_approvals + finance_approvals (+ escrow / credit terms read model), can_decide, decide_rpc; readiness count.
//  8. No money: no journal, ledger entry, payout, payment or document is created by any of it.
//  9. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/staff-approvals.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runStaffApprovalChecks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const skip = (m) => console.log(`- skipped: ${m}`);
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  // fresh = the second factor was verified now (step-up); stale = 2 hours ago
  const as = async (uid, aal = 'aal2', fresh = true, role = 'authenticated') => {
    await db.query('reset role');
    const ts = Math.floor(Date.now() / 1000) - (fresh ? 0 : 7200);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: ts }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const err = async (q, p) => {
    await db.query('savepoint sa');
    try { await db.query(q, p); await db.query('release savepoint sa'); return ''; }
    catch (e) { await db.query('rollback to savepoint sa'); lastErr = e.message; return e.message; }
  };
  const rpc = async (q, p) => {
    await db.query('savepoint sar');
    try { const r = (await db.query(q, p)).rows[0]; await db.query('release savepoint sar'); return r; }
    catch (e) { await db.query('rollback to savepoint sar'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const RPC_FNS = ['staff_approval_request', 'staff_approval_decide', 'staff_approval_ready', 'staff_approval_mark_executed', 'office_approval_queue', 'staff_approvals_readiness'];
  const INTERNAL_FNS = ['staff_approval_limit_minor', 'staff_approval_usd', 'staff_approval_ip', 'staff_approval_audit', 'staff_approvals_guard'];
  const MONEY_TABLES = ['journals', 'ledger_entries', 'payouts', 'payments', 'documents'];
  const KEY = 'office.second_approver_over_cents';

  await owner();
  if (!(await one(`select to_regclass('public.staff_approvals') t`)).t) {
    await db.query(ctx.UP);
    console.log('- 255 not applied on this database: applied inside the test transaction (rolled back at the end)');
  }
  const moneyCount = async () => Object.fromEntries(await Promise.all(MONEY_TABLES.map(async (t) => [t, Number((await one(`select count(*) n from ${t}`)).n)])));
  const moneyBefore = await moneyCount();

  // ── 0. structure ──
  ok((await one(`select relrowsecurity r from pg_class where oid = 'public.staff_approvals'::regclass`)).r, 'staff_approvals has RLS on');
  const grants = await all(`select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'staff_approvals' and grantee in ('anon', 'authenticated')`);
  ok(grants.length === 0, 'no table-wide grant to anon or signed-in users');
  const cols = (await all(`select column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'staff_approvals' and grantee = 'authenticated'`));
  ok(cols.length > 0 && cols.every((c) => c.privilege_type === 'SELECT') && !cols.some((c) => /_ip$/.test(c.column_name)), 'column SELECT grants only, IP columns not readable');
  const con = await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'staff_approvals_two_person'`);
  ok(/approved_by <> requested_by/.test(con?.d ?? ''), 'CHECK staff_approvals_two_person (approved_by <> requested_by)');
  ok(!!(await one(`select 1 x from pg_trigger where tgname = 'trg_staff_approvals_guard'`)), 'guard trigger installed');
  const fns = await all(`select p.proname, p.proconfig::text cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists with search_path=public');
  ok(fns.every((f) => !f.anon_x) && fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x)
     && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x), 'signed-in users execute the 6 RPCs only; anon none');
  const seeded = await one(`select value from site_settings where key = $1`, [KEY]);
  ok(seeded != null, `setting ${KEY} exists (value ${JSON.stringify(seeded?.value)})`);
  const settingWas = seeded?.value ?? null;
  await db.query(`insert into site_settings (key, value) values ($1, '250000'::jsonb) on conflict (key) do update set value = '250000'::jsonb`, [KEY]);

  // ── fixtures ──
  const mkUser = async (tag, ...roles) => {
    await owner();
    const mail = `sa-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles (id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `SA ${tag}`, mail]);
    for (const r of roles) await db.query(`insert into user_roles (user_id, role_code) values ($1, $2)`, [id, r]);
    return id;
  };
  const F1 = await mkUser('fin1', 'finance');
  const F2 = await mkUser('fin2', 'finance');
  const SUP = await mkUser('support', 'support');
  const OPS = await mkUser('ops', 'operations');
  const CUST = await mkUser('cust');
  const org = (await one(`insert into organizations (name, country) values ($1, 'AE') returning id`, [`SA org ${stamp}`])).id;
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, CUST]);
  const REQ = `select staff_approval_request($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8) x`;

  // ── 1. limit from settings ──
  await as(F1);
  let r = await rpc(REQ, ['payment', 250000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-1`, org, '203.0.113.7']);
  ok(r.x?.required === false && Number(r.x.limit_minor) === 250000, 'US$ 2,500.00 exactly (= the limit) → no approval needed, nothing recorded');
  ok(Number((await one(`select count(*) n from staff_approvals where ref_id = $1`, [`INV-${stamp}-1`])).n) === 0, 'no row for an amount at the limit');
  r = await rpc(REQ, ['payment', 300000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-2`, org, '203.0.113.7, 10.0.0.1']);
  const A1 = r.x;
  ok(A1?.required === true && /^APR-\d{5,}$/.test(A1.code) && A1.status === 'waiting' && A1.duplicate === false, `US$ 3,000.00 → approval ${A1?.code} waiting`);
  await owner();
  const row1 = await one(`select requested_by, requested_ip::text ip, amount_usd_minor, limit_usd_minor, org_id from staff_approvals where id = $1`, [A1?.id]);
  ok(row1?.requested_by === F1 && /^203\.0\.113\.7/.test(row1.ip ?? '') && Number(row1.limit_usd_minor) === 250000 && row1.org_id === org,
    'requester, client IP (first of the forwarded list), limit at request time and company recorded');
  await db.query(`update site_settings set value = '500000'::jsonb where key = $1`, [KEY]);
  await as(F1);
  r = await rpc(REQ, ['refund', 300000, 'USD', 'Refund for damaged goods', 'order', `ORD-${stamp}-1`, org, null]);
  ok(r.x?.required === false && Number(r.x.limit_minor) === 500000, 'limit raised to US$ 5,000 in settings → the same amount needs no approval (no hard-coded limit)');
  await owner();
  await db.query(`delete from site_settings where key = $1`, [KEY]);
  await as(F1);
  r = await rpc(REQ, ['refund', 100, 'USD', 'Refund for damaged goods', 'order', `ORD-${stamp}-2`, org, null]);
  ok(r.x?.required === true && Number(r.x.limit_minor) === 0, 'setting missing → fail safe: even US$ 1.00 needs a second person');
  await owner();
  await db.query(`insert into site_settings (key, value) values ($1, '250000'::jsonb) on conflict (key) do update set value = '250000'::jsonb`, [KEY]);
  const cny = await rpc(`select staff_approval_usd(1000000, 'CNY') u`);
  if (cny.__error) skip(`CNY conversion (${cny.__error.split(':')[0]})`);
  else {
    await as(F1);
    r = await rpc(REQ, ['supplier_payment', 1000000, 'CNY', 'Factory balance payment', 'supplier', `SUP-${stamp}`, null, null]);
    ok(r.x != null && Number(r.x.amount_usd_minor) === Number(cny.u) && r.x.required === (Number(cny.u) > 250000),
      `CN¥ 10,000.00 is compared in USD with today's converter (${cny.u} US cents → required ${r.x?.required})`);
  }

  // ── 2. roles + input ──
  await as(SUP);
  r = await rpc(REQ, ['credit_note', 400000, 'USD', 'Goodwill credit after complaint', 'ticket', `TCK-${stamp}`, org, null]);
  const A2 = r.x;
  ok(A2?.required === true, 'support (support:create) can ask for an approval');
  await as(OPS);
  r = await rpc(REQ, ['payment', 400000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-9`, org, null]);
  ok(/FORBIDDEN/.test(r.__error ?? ''), 'operations staff without a money permission → FORBIDDEN');
  await as(CUST);
  r = await rpc(REQ, ['payment', 400000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-9`, org, null]);
  ok(/FORBIDDEN/.test(r.__error ?? ''), 'a customer → FORBIDDEN');
  await as(F1, 'aal1');
  r = await rpc(REQ, ['payment', 400000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-9`, org, null]);
  ok(/FORBIDDEN/.test(r.__error ?? ''), 'finance without a 2FA session → FORBIDDEN');
  await as(F1);
  r = await rpc(REQ, ['bonus', 400000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-9`, org, null]);
  ok(/INVALID_INPUT: kind/.test(r.__error ?? ''), 'unknown kind → INVALID_INPUT');
  r = await rpc(REQ, ['payment', 0, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-9`, org, null]);
  ok(/INVALID_AMOUNT/.test(r.__error ?? ''), 'zero amount → INVALID_AMOUNT');
  r = await rpc(REQ, ['payment', 400000, 'USD', 'pay', 'invoice', `INV-${stamp}-9`, org, null]);
  ok(/REASON_REQUIRED/.test(r.__error ?? ''), 'reason under 5 characters → REASON_REQUIRED');
  r = await rpc(REQ, ['payment', 300000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-2`, org, null]);
  ok(r.x?.id === A1?.id && r.x.duplicate === true, 'asking again for the same action and amount → the same waiting approval');
  r = await rpc(REQ, ['payment', 310000, 'USD', 'Bank transfer from customer', 'invoice', `INV-${stamp}-2`, org, null]);
  ok(/APPROVAL_PENDING/.test(r.__error ?? ''), 'a different amount while one is waiting → APPROVAL_PENDING');

  // ── 3. self-approval blocked ──
  await as(F1);
  r = await rpc(`select staff_approval_decide($1, true, null, null) x`, [A1?.id]);
  ok(/MAKER_CANNOT_APPROVE/.test(r.__error ?? ''), 'the person who recorded it cannot approve it (MAKER_CANNOT_APPROVE)');
  await owner();
  const direct = await err(`update staff_approvals set status = 'approved', approved_by = requested_by, decided_at = now() where id = $1`, [A1?.id]);
  ok(/staff_approvals_two_person/.test(direct), 'even a direct database write with approver = requester is refused by the CHECK');
  await as(F1);
  ok(/permission denied/.test(await err(`update staff_approvals set status = 'approved' where id = $1`, [A1?.id])), 'signed-in users cannot update approvals directly');
  ok(/permission denied/.test(await err(`insert into staff_approvals (kind, amount_minor, currency, amount_usd_minor, limit_usd_minor, reason, ref_type, ref_id, requested_by) values ('payment', 1, 'USD', 1, 0, 'xxxxx', 'invoice', 'x', $1)`, [F1])), 'nor insert them');

  // ── 4. decide ──
  await as(SUP);
  r = await rpc(`select staff_approval_decide($1, true) x`, [A1?.id]);
  ok(/FORBIDDEN/.test(r.__error ?? ''), 'support (no finance:approve) cannot decide');
  await as(F2, 'aal2', false);
  r = await rpc(`select staff_approval_decide($1, true) x`, [A1?.id]);
  ok(/STEP_UP_REQUIRED/.test(r.__error ?? ''), 'a second approver whose code is older than the step-up window → STEP_UP_REQUIRED');
  await as(F2);
  r = await rpc(`select staff_approval_decide($1, false, 'no') x`, [A2?.id]);
  ok(/REASON_REQUIRED/.test(r.__error ?? ''), 'reject without a real reason → REASON_REQUIRED');
  await owner();
  const auditBefore = Number((await one(`select count(*) n from audit_log where entity = 'staff_approvals'`)).n);
  await as(F2);
  r = await rpc(`select staff_approval_decide($1, true, 'Matches the bank statement', '198.51.100.4') x`, [A1?.id]);
  ok(r.x?.status === 'approved', `a different Finance approver approves ${A1?.code}`);
  r = await rpc(`select staff_approval_decide($1, false, 'Duplicate of an earlier credit', null) x`, [A2?.id]);
  ok(r.x?.status === 'rejected', `${A2?.code} rejected with a reason`);
  r = await rpc(`select staff_approval_decide($1, false, 'changed my mind') x`, [A1?.id]);
  ok(/INVALID_TRANSITION/.test(r.__error ?? ''), 'deciding again → INVALID_TRANSITION');
  await owner();
  const dec = await one(`select status, approved_by, decided_ip::text ip, decision_note from staff_approvals where id = $1`, [A1?.id]);
  ok(dec?.status === 'approved' && dec.approved_by === F2 && /^198\.51\.100\.4/.test(dec.ip ?? '') && dec.decision_note === 'Matches the bank statement',
    'decision: approver, time, IP and note stored');
  ok(/APPROVAL_DECIDED/.test(await err(`update staff_approvals set status = 'rejected', decision_note = 'later' where id = $1`, [A1?.id])), 'a decision cannot be rewritten, even by the database owner');
  ok(/APPROVAL_DECIDED/.test(await err(`update staff_approvals set amount_minor = 1 where id = $1`, [A1?.id])), 'the amount cannot be changed');
  ok(/APPROVALS_APPEND_ONLY/.test(await err(`delete from staff_approvals where id = $1`, [A1?.id])), 'approvals are never deleted');

  // ── 5. audit ──
  const auds = await all(`select action, actor_id, before, after, details from audit_log where entity = 'staff_approvals' and entity_id = $1 order by id`, [A1?.id]);
  const reqA = auds.find((a) => a.action === 'approval.requested');
  const appA = auds.find((a) => a.action === 'approval.approved');
  ok(reqA?.actor_id === F1 && reqA.before === null && reqA.after?.status === 'waiting' && reqA.details?.ip === '203.0.113.7' && reqA.details.code === A1?.code,
    'request audited: who, after, IP, code');
  ok(appA?.actor_id === F2 && appA.before?.status === 'waiting' && appA.after?.status === 'approved' && appA.details?.ip === '198.51.100.4',
    'approval audited: who, before → after, IP');
  ok(Number((await one(`select count(*) n from audit_log where entity = 'staff_approvals'`)).n) === auditBefore + 2, 'every decision audited (approve + reject)');

  // ── 6. use ──
  await as(F1);
  r = await rpc(`select staff_approval_ready('payment', 'invoice', $1, 300000) x`, [`INV-${stamp}-2`]);
  ok(r.x === A1?.id, 'staff_approval_ready finds the approved approval for this action and amount');
  r = await rpc(`select staff_approval_ready('payment', 'invoice', $1, 300001) x`, [`INV-${stamp}-2`]);
  ok(r.x === null, 'it does not cover a larger amount');
  r = await rpc(`select staff_approval_ready('credit_note', 'ticket', $1, 1) x`, [`TCK-${stamp}`]);
  ok(r.x === null, 'a rejected approval never counts');
  await as(OPS);
  r = await rpc(`select staff_approval_mark_executed($1) x`, [A1?.id]);
  ok(/FORBIDDEN/.test(r.__error ?? ''), 'someone else (not requester, not Finance approver) cannot mark it used');
  await as(F1);
  r = await rpc(`select staff_approval_mark_executed($1, '203.0.113.7') x`, [A1?.id]);
  ok(!!r.x?.executed_at, 'after today\'s money action the requester marks the approval used');
  r = await rpc(`select staff_approval_ready('payment', 'invoice', $1, 300000) x`, [`INV-${stamp}-2`]);
  ok(r.x === null, 'a used approval is not ready any more');
  r = await rpc(`select staff_approval_mark_executed($1) x`, [A1?.id]);
  ok(/INVALID_TRANSITION/.test(r.__error ?? ''), 'it can be used once only');
  r = await rpc(`select staff_approval_mark_executed($1) x`, [A2?.id]);
  ok(/INVALID_TRANSITION|FORBIDDEN/.test(r.__error ?? ''), 'a rejected approval cannot be marked used');

  // ── 7. RLS, queue, readiness ──
  await as(SUP);
  let vis = (await all(`select id from staff_approvals where id = any($1)`, [[A1?.id, A2?.id]])).map((x) => x.id);
  ok(vis.length === 1 && vis[0] === A2?.id, 'a requester outside Finance reads only their own approvals');
  await as(OPS);
  ok(Number((await one(`select count(*) n from staff_approvals where id = any($1)`, [[A1?.id, A2?.id]])).n) === 0, 'other staff read none');
  await as(CUST);
  ok(Number((await one(`select count(*) n from staff_approvals`)).n) === 0, 'customers read none');
  await as(F2);
  ok(Number((await one(`select count(*) n from staff_approvals where id = any($1)`, [[A1?.id, A2?.id]])).n) === 2, 'Finance reads all');
  await owner();
  const fa = (await one(`insert into finance_approvals (kind, org_id, amount_cents, reason, requested_by) values ('refund', $1, 280000, 'Refund for a cancelled order', $2) returning id`, [org, F1])).id;
  await as(F1);
  r = await rpc(REQ, ['wallet_adjustment', 900000, 'USD', 'Correct a duplicate top-up', 'wallet', `WAL-${stamp}`, org, null]);
  const A3 = r.x;
  let q = await all(`select * from office_approval_queue('waiting', 500)`);
  const qFa = q.find((x) => x.id === fa);
  const qA3 = q.find((x) => x.id === A3?.id);
  ok(qFa?.source === 'finance_approvals' && qFa.decide_rpc === 'decide_finance_approval' && qFa.status === 'waiting' && qFa.can_decide === false,
    'queue: today\'s finance_approvals row appears (decide with decide_finance_approval); its requester can\'t decide');
  ok(qA3?.source === 'staff_approvals' && qA3.decide_rpc === 'staff_approval_decide' && qA3.can_decide === false && qA3.org_name?.startsWith('SA org'),
    'queue: the new approval appears with the company name; its requester can\'t decide');
  ok(q.every((x) => x.status === 'waiting') && !q.some((x) => x.id === A1?.id), 'waiting filter: decided items are not listed');
  await as(F2);
  q = await all(`select * from office_approval_queue('waiting', 500)`);
  ok(q.find((x) => x.id === fa)?.can_decide === true && q.find((x) => x.id === A3?.id)?.can_decide === true && q.find((x) => x.id === A3?.id)?.requested_by_name === 'SA fin1',
    'another Finance approver can decide both; requester name shown');
  q = await all(`select * from office_approval_queue('decided', 500)`);
  ok(q.find((x) => x.id === A1?.id)?.status === 'approved' && q.find((x) => x.id === A2?.id)?.status === 'rejected' && q.find((x) => x.id === A1?.id)?.decided_by_name === 'SA fin2',
    'decided filter: approved / rejected with the approver');
  await as(SUP);
  r = await rpc(`select count(*) n from office_approval_queue('all', 10)`);
  ok(/FORBIDDEN/.test(r.__error ?? ''), 'the queue is for Finance only (support → FORBIDDEN)');
  await as(F2);
  r = await rpc(`select staff_approvals_readiness() x`);
  ok(r.x?.approvers >= 2 && r.x.second_approver_needed === false && Number(r.x.limit_minor) === 250000 && r.x.currency === 'USD',
    `readiness: ${r.x?.approvers} people can approve money → no "second approver needed" warning`);

  // ── 8. no money ──
  await owner();
  const moneyAfter = await moneyCount();
  ok(MONEY_TABLES.every((t) => moneyAfter[t] === moneyBefore[t]), `no journal, ledger entry, payout, payment or document created (${JSON.stringify(moneyAfter)})`);
  if (settingWas === null) await db.query(`delete from site_settings where key = $1`, [KEY]);
  else await db.query(`update site_settings set value = $2::jsonb where key = $1`, [KEY, JSON.stringify(settingWas)]);

  // ── 9. round trip ──
  if (ctx.staging || ctx.local) {
    await db.query('savepoint sart');
    try {
      if (ctx.unwindLater) await ctx.unwindLater(db);
      const snapSchema = async () => (await one(ctx.SNAP)).h;
      if (ctx.staging) await db.query(`set local lock_timeout = '5s'`);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      ok(!(await one(`select to_regclass('public.staff_approvals') t`)).t && fnLeft === 0 && !(await one(`select to_regtype('public.staff_approval_status') t`)).t
         && !(await one(`select to_regclass('public.seq_staff_approval') t`)).t, 'down: the table, sequence, enum and every 255 function are gone');
      ok(Number((await one(`select count(*) n from finance_approvals where id = $1`, [fa])).n) === 1, 'down leaves finance_approvals alone');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up again: identical schema');
      await db.query(ctx.UP);
      ok((await snapSchema()) === withIt, 'up is re-runnable');
      await db.query(ctx.DOWN);
      ok((await snapSchema()) === without, 'down again: the same schema as the first down (empty up → down diff)');
      await db.query(ctx.UP);
      if (ctx.reapplyLater) await ctx.reapplyLater(db);
    } catch (e) {
      if (e.skipRoundTrip) skip('round trip (too many later migrations)'); else { lastErr = e.message; ok(false, 'round trip ran'); }
    } finally {
      await db.query('rollback to savepoint sart');
    }
  } else skip('round trip (staging only)');
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
  const { SNAP } = await import('./office-workspace.test.mjs');
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_staff_approvals.sql'));
  if (!MIG) { console.error('✘ staff approvals migration (255) not found'); process.exit(1); }
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
    const applied = (await db.query(`select to_regclass('public.staff_approvals') t`)).rows[0].t;
    failed = await runStaffApprovalChecks(db, {
      UP, DOWN, MIG, SNAP, staging: true,
      unwindLater: applied ? async (c) => { later = await appliedAfter(c, MIG); await unwind(c, later, MAX_UNWIND); } : null,
      reapplyLater: applied ? async (c) => { await reapply(c, later); } : null,
    });
  } catch (e) {
    console.log('✘ unexpected error: ' + e.message);
    failed++;
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  console.log(failed ? `\nstaff-approvals: ${failed} check(s) failed` : '\nstaff-approvals: all passed');
  process.exitCode = failed ? 1 : 0;
}
