// ODS T8 · Staff notification channel — DB checks for migration *_staff_notifications (256, DRAFT).
// STAGING ONLY, one rolled-back transaction, acting as staff / customers through JWT claims (what PostgREST does).
// Self-contained: 254 and 255 (which 256 builds on) and 256 itself are applied INSIDE the transaction when missing.
//  0. Structure: 2 tables with RLS, column read grants only, staff_notify not callable by signed-in users, triggers installed.
//  1. staff_notify: personal / role targets, exactly one target, staff only, staff role only, app links only, dedupe.
//  2. Reading: own + own roles' rows (RLS and the list RPC), customers / other roles see nothing, the actor of a role alert
//     doesn't get it, unread count, mark read (a role row read by one person stays unread for the others).
//  3. Turnkey: a new enquiry ("created" event) → the company's account manager; no manager → the fallback role;
//     legacy imports → nothing; manager / cover assigned → that person; tk_submit_enquiry (staging) → the manager.
//  4. Approvals: a waiting staff approval → Finance; its decision → the requester; a new finance_approvals request → Finance.
//  5. (staging) down → up → up → down: identical schema; the business triggers' tables untouched.
// Run: node supabase/tests/staff-notifications.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runStaffNotificationChecks(db, ctx) {
  let failed = 0;
  let lastErr = '';
  const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : ` [last error: ${lastErr.slice(0, 240)}]`}`); if (!c) failed++; };
  const skip = (m) => console.log(`- skipped: ${m}`);
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
  const as = async (uid, aal = 'aal2', role = 'authenticated') => {
    await db.query('reset role');
    const now = Math.floor(Date.now() / 1000);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }] } : { role })]);
    await db.query(`set local role ${role}`);
  };
  const rpc = async (q, p) => {
    await db.query('savepoint sn');
    try { const r = (await db.query(q, p)).rows[0]; await db.query('release savepoint sn'); return r; }
    catch (e) { await db.query('rollback to savepoint sn'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const TABLES = ['staff_notifications', 'staff_notification_reads'];
  const RPC_FNS = ['staff_notifications_list', 'staff_notifications_unread_count', 'staff_notifications_mark_read'];
  const INTERNAL_FNS = ['staff_notify', 'staff_notifications_visible', 'office_money_text', 'office_finance_role', 'office_tk_enquiry_alert',
    'office_tk_manager_alert', 'office_staff_approval_alert', 'office_finance_approval_alert'];
  const TRIGGERS = ['trg_office_tk_enquiry_alert', 'trg_office_tk_manager_alert', 'trg_office_staff_approval_alert', 'trg_office_finance_approval_alert'];

  await owner();
  for (const [reg, sql, n] of [['public.saved_views', ctx.UP_254, 254], ['public.staff_approvals', ctx.UP_255, 255], ['public.staff_notifications', ctx.UP, 256]]) {
    if (!(await one(`select to_regclass($1) t`, [reg])).t) {
      await db.query(sql);
      console.log(`- ${n} not applied on this database: applied inside the test transaction (rolled back at the end)`);
    }
  }

  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === 2 && rls.every((r) => r.relrowsecurity), '2 new tables, RLS on both');
  const grants = await all(`select table_name from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [TABLES]);
  const colGrants = await all(`select privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated'`, [TABLES]);
  ok(grants.length === 0 && colGrants.length > 0 && colGrants.every((c) => c.privilege_type === 'SELECT'), 'column SELECT grants only (no direct writes)');
  const fns = await all(`select p.proname, p.proconfig::text cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists with search_path=public');
  ok(fns.every((f) => !f.anon_x) && fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x)
     && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x), 'signed-in staff call list / count / mark read only; staff_notify is for server code');
  const trg = (await all(`select tgname from pg_trigger where tgname = any($1)`, [TRIGGERS])).map((t) => t.tgname);
  ok(TRIGGERS.every((t) => trg.includes(t)), '4 alert triggers installed (turnkey enquiry, turnkey manager, staff approvals, finance approvals)');

  // ── fixtures ──
  const mkUser = async (tag, ...roles) => {
    await owner();
    const mail = `sn-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles (id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `SN ${tag}`, mail]);
    for (const r of roles) await db.query(`insert into user_roles (user_id, role_code) values ($1, $2)`, [id, r]);
    return id;
  };
  const F1 = await mkUser('fin1', 'finance');
  const F2 = await mkUser('fin2', 'finance');
  const OPS = await mkUser('ops', 'operations');
  const AM = await mkUser('am', 'account_manager');
  const AM2 = await mkUser('am2', 'account_manager');
  const ADM = await mkUser('admin', 'admin');
  const CUST = await mkUser('cust');
  const mkOrg = async (tag, uid) => {
    const id = (await one(`insert into organizations (name, country) values ($1, 'AE') returning id`, [`SN ${tag} ${stamp}`])).id;
    if (uid) await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [id, uid]);
    return id;
  };
  const orgA = await mkOrg('managed', CUST);
  const orgB = await mkOrg('unmanaged');
  await db.query(`insert into account_managers (org_id, staff_user_id) values ($1, $2)`, [orgA, AM]);
  const NOTIFY = `select staff_notify($1, $2, $3, $4, $5, $6, $7, $8, $9) x`;

  // ── 1. staff_notify ──
  await owner();
  let r = await rpc(NOTIFY, [F1, null, 'test.personal', 'Personal for fin1', 'Body', '/office', 'invoice', 'INV-1', `sn:${stamp}:1`]);
  const nPersonal = r.x;
  ok(!!nPersonal, 'server code notifies one staff user');
  r = await rpc(NOTIFY, [null, 'finance', 'test.role', 'For Finance', null, '/office/approvals', null, null, `sn:${stamp}:2`]);
  const nRole = r.x;
  ok(!!nRole, 'server code notifies a staff role');
  r = await rpc(NOTIFY, [F1, null, 'test.personal', 'Again', null, null, null, null, `sn:${stamp}:1`]);
  ok(r.x === nPersonal && Number((await one(`select count(*) n from staff_notifications where dedupe_key = $1`, [`sn:${stamp}:1`])).n) === 1, 'same dedupe key → the same notification, no second row');
  r = await rpc(NOTIFY, [F1, 'finance', 'test.x', 'Both', null, null, null, null, null]);
  ok(/INVALID_TARGET/.test(r.__error ?? ''), 'user AND role → INVALID_TARGET');
  r = await rpc(NOTIFY, [null, null, 'test.x', 'None', null, null, null, null, null]);
  ok(/INVALID_TARGET/.test(r.__error ?? ''), 'no target → INVALID_TARGET');
  r = await rpc(NOTIFY, [CUST, null, 'test.x', 'To a customer', null, null, null, null, null]);
  ok(/NOT_STAFF/.test(r.__error ?? ''), 'a customer can\'t be notified here → NOT_STAFF');
  r = await rpc(NOTIFY, [null, 'customer', 'test.x', 'To customers', null, null, null, null, null]);
  ok(/INVALID_ROLE/.test(r.__error ?? ''), 'a non-staff role → INVALID_ROLE');
  r = await rpc(NOTIFY, [F1, null, 'test.x', 'Link', null, 'https://evil.example', null, null, null]);
  ok(/INVALID_INPUT: link/.test(r.__error ?? ''), 'an outside link → INVALID_INPUT');
  await as(F1);
  r = await rpc(NOTIFY, [F1, null, 'test.x', 'Self', null, null, null, null, null]);
  ok(/permission denied/.test(r.__error ?? ''), 'signed-in users cannot call staff_notify');
  r = await rpc(`insert into staff_notifications (user_id, kind, title) values ($1, 'test.x', 'direct') returning id`, [F1]);
  ok(/permission denied/.test(r.__error ?? ''), 'nor insert notifications directly');

  // ── 2. reading ──
  await as(F1);
  let ids = (await all(`select id from staff_notifications where id = any($1)`, [[nPersonal, nRole]])).map((x) => x.id);
  ok(ids.length === 2, 'fin1 reads their own notification and their role\'s (RLS)');
  let list = await all(`select * from staff_notifications_list(50)`);
  ok(list.some((x) => x.id === nPersonal && x.for_role === null) && list.some((x) => x.id === nRole && x.for_role === 'finance'), 'the list RPC returns both, marking the role one');
  const unread1 = Number((await one(`select staff_notifications_unread_count() n`)).n);
  await as(F2);
  ids = (await all(`select id from staff_notifications where id = any($1)`, [[nPersonal, nRole]])).map((x) => x.id);
  ok(ids.length === 1 && ids[0] === nRole, 'fin2 reads only the role notification');
  await as(OPS);
  ok(Number((await one(`select count(*) n from staff_notifications where id = any($1)`, [[nPersonal, nRole]])).n) === 0, 'operations staff read neither');
  await as(CUST);
  ok(Number((await one(`select count(*) n from staff_notifications`)).n) === 0, 'customers read nothing');
  r = await rpc(`select staff_notifications_unread_count() n`);
  ok(/STAFF_ONLY/.test(r.__error ?? ''), 'customers cannot use the staff bell RPCs (STAFF_ONLY)');
  await as(F1, 'aal1');
  ok(Number((await one(`select count(*) n from staff_notifications where id = any($1)`, [[nPersonal, nRole]])).n) === 0, 'no 2FA session → nothing readable');
  await as(F1);
  r = await rpc(`select staff_notifications_mark_read($1::uuid[]) n`, [[nRole]]);
  ok(Number(r.n) === 1 && Number((await one(`select staff_notifications_unread_count() n`)).n) === unread1 - 1, 'fin1 marks the role notification read → unread count drops by 1');
  list = await all(`select * from staff_notifications_list(50, true)`);
  ok(!list.some((x) => x.id === nRole) && list.some((x) => x.id === nPersonal), 'unread-only list leaves it out');
  await as(F2);
  ok((await all(`select * from staff_notifications_list(50, true)`)).some((x) => x.id === nRole), 'for fin2 the same role notification is still unread');
  await as(F1);
  r = await rpc(`select staff_notifications_mark_read(null) n`);
  ok(Number((await one(`select staff_notifications_unread_count() n`)).n) === 0, 'mark all read → 0 unread');
  r = await rpc(`select staff_notifications_mark_read(null) n`);
  ok(Number(r.n) === 0, 'marking again changes nothing');
  await owner();
  ok((await one(`select read_at from staff_notifications where id = $1`, [nPersonal]))?.read_at != null, 'a personal notification keeps its read time on the row');
  // the person whose action raised a role alert does not get it
  await as(F1);
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F1, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]);
  await db.query('reset role');
  const nActor = (await one(NOTIFY, [null, 'finance', 'test.actor', 'Raised by fin1', null, null, null, null, `sn:${stamp}:actor`])).x;
  await as(F1);
  ok(!(await all(`select id from staff_notifications_list(50)`)).some((x) => x.id === nActor), 'a role alert is not shown to the person who caused it');
  await as(F2);
  ok((await all(`select id from staff_notifications_list(50)`)).some((x) => x.id === nActor), '…but the rest of the role gets it');

  // ── 3. Turnkey ──
  const mkProject = async (org, source = 'web', ownerId = null) => {
    await owner();
    const p = await one(`insert into tk_client_projects (org_id, title, city, source) values ($1, $2, 'Dubai', $3) returning id, code`, [org, `SN shop fit-out ${stamp}`, source]);
    await db.query(`insert into tk_client_project_staff (project_id, owner_id, created_by) values ($1, $2, $3)`, [p.id, ownerId, CUST]);
    await db.query(`insert into tk_client_project_events (project_id, kind, to_stage, message) values ($1, 'created', 'enquiry', 'Enquiry sent.')`, [p.id]);
    return p;
  };
  const p1 = await mkProject(orgA);
  let n = await one(`select user_id, role_code, kind, title, link, ref_id from staff_notifications where dedupe_key = $1`, [`tk:enquiry:manager:${p1.id}`]);
  ok(n?.user_id === AM && n.kind === 'turnkey.enquiry' && n.title.includes(p1.code) && n.link === `/admin/turnkey/projects/${p1.code}` && n.ref_id === p1.id,
    `new enquiry ${p1.code} → the company's account manager`);
  await as(AM);
  ok((await all(`select id from staff_notifications_list(20)`)).length >= 1 && Number((await one(`select staff_notifications_unread_count() n`)).n) >= 1, 'the account manager sees it in their bell');
  await as(AM2);
  ok(!(await all(`select ref_id from staff_notifications_list(50)`)).some((x) => x.ref_id === p1.id), 'another account manager does not');
  const p2 = await mkProject(orgB);
  n = await one(`select user_id, role_code, title from staff_notifications where dedupe_key = $1`, [`tk:enquiry:manager:${p2.id}`]);
  ok(n?.user_id === null && n.role_code === 'admin' && /no account manager yet/.test(n.title), 'company without an account manager → the fallback role (admin)');
  await as(ADM);
  ok((await all(`select ref_id from staff_notifications_list(50)`)).some((x) => x.ref_id === p2.id), 'admins see the unassigned enquiry');
  const p3 = await mkProject(orgB, 'web', AM2);
  n = await one(`select user_id from staff_notifications where dedupe_key = $1`, [`tk:enquiry:manager:${p3.id}`]);
  ok(n?.user_id === AM2, 'a project that already has its manager → that manager (before the company\'s)');
  await owner();
  const legacy = await one(`insert into tk_client_projects (org_id, title, source) values (null, 'Old lead', 'legacy_lead') returning id`);
  await db.query(`insert into tk_client_project_events (project_id, kind, message) values ($1, 'created', 'Imported')`, [legacy.id]);
  ok(!(await one(`select 1 x from staff_notifications where ref_id = $1`, [legacy.id])), 'legacy imports raise no alert');
  await db.query(`update tk_client_project_staff set owner_id = $2, owner_set_at = now() where project_id = $1`, [p2.id, AM2]);
  n = await one(`select user_id, kind from staff_notifications where kind = 'turnkey.manager_assigned' and ref_id = $1`, [p2.id]);
  ok(n?.user_id === AM2, 'account manager assigned → they are told');
  await db.query(`update tk_client_project_staff set cover_id = $2, cover_from = current_date, cover_to = current_date + 7 where project_id = $1`, [p2.id, AM]);
  n = await one(`select user_id from staff_notifications where kind = 'turnkey.cover_assigned' and ref_id = $1`, [p2.id]);
  ok(n?.user_id === AM, 'cover assigned → the cover is told');
  await as(AM2);
  await db.query('reset role');
  await db.query(`update tk_client_project_staff set owner_id = $2, owner_set_at = now() + interval '1 second' where project_id = $1`, [p1.id, AM2]);
  ok(!(await one(`select 1 x from staff_notifications where kind = 'turnkey.manager_assigned' and ref_id = $1`, [p1.id])), 'assigning yourself raises no alert to yourself');
  await owner();
  if (ctx.staging && (await one(`select to_regprocedure('public.tk_submit_enquiry(uuid,text,text,text,text,date,numeric,bigint,text)') f`)).f) {
    await as(CUST, 'aal1');
    r = await rpc(`select tk_submit_enquiry($1, null, $2, 'AE', 'Dubai', null, null, null, null) x`, [orgA, `SN real enquiry ${stamp}`]);
    await owner();
    if (r.__error) skip(`tk_submit_enquiry path (${r.__error.split(':')[0]})`);
    else ok((await one(`select user_id from staff_notifications where dedupe_key = $1`, [`tk:enquiry:manager:${r.x.id}`]))?.user_id === AM, `tk_submit_enquiry (unchanged) → ${r.x.code} reaches the account manager`);
  } else skip('tk_submit_enquiry path (staging only)');

  // ── 4. approvals ──
  await owner();
  const KEY = 'office.second_approver_over_cents';
  const was = (await one(`select value from site_settings where key = $1`, [KEY]))?.value ?? null;
  await db.query(`insert into site_settings (key, value) values ($1, '250000'::jsonb) on conflict (key) do update set value = '250000'::jsonb`, [KEY]);
  await as(F1);
  const a = (await rpc(`select staff_approval_request('refund', 400000, 'USD', 'Refund for a damaged order', 'order', $1, $2, '{}'::jsonb, null) x`, [`ORD-${stamp}`, orgA])).x;
  await owner();
  n = await one(`select role_code, kind, title, link from staff_notifications where dedupe_key = $1`, [`approval:waiting:${a?.id}`]);
  ok(n?.role_code === 'finance' && n.kind === 'approval.waiting' && n.title.includes(a?.code) && n.title.includes('US$ 4,000.00') && n.link.startsWith('/office/approvals'),
    `waiting approval ${a?.code} → Finance ("Second approver needed · … US$ 4,000.00")`);
  await as(F1);
  ok(!(await all(`select ref_id from staff_notifications_list(50)`)).some((x) => x.ref_id === a?.id), 'the requester does not get their own "approval needed" alert');
  await as(F2);
  ok((await all(`select ref_id from staff_notifications_list(50)`)).some((x) => x.ref_id === a?.id), 'the other Finance user does');
  await rpc(`select staff_approval_decide($1, false, 'Customer already refunded by bank') x`, [a?.id]);
  await owner();
  n = await one(`select user_id, kind, body from staff_notifications where dedupe_key = $1`, [`approval:decided:${a?.id}`]);
  ok(n?.user_id === F1 && n.kind === 'approval.decided' && n.body === 'Customer already refunded by bank', 'the decision goes to the requester with the reason');
  const fa = (await one(`insert into finance_approvals (kind, org_id, amount_cents, reason, requested_by) values ('credit_note', $1, 120000, 'Credit for short shipment', $2) returning id`, [orgA, F1])).id;
  n = await one(`select role_code, kind, link from staff_notifications where dedupe_key = $1`, [`finance_approval:waiting:${fa}`]);
  ok(n?.role_code === 'finance' && n.kind === 'finance.approval_waiting' && n.link === '/admin/finance', 'a new finance_approvals request (today\'s flow, unchanged) → Finance');
  if (was === null) await db.query(`delete from site_settings where key = $1`, [KEY]);
  else await db.query(`update site_settings set value = $2::jsonb where key = $1`, [KEY, JSON.stringify(was)]);

  // ── 5. round trip ──
  if (ctx.staging || ctx.local) {
    await db.query('savepoint snrt');
    try {
      if (ctx.unwindLater) await ctx.unwindLater(db);
      const snapSchema = async () => (await one(ctx.SNAP)).h;
      if (ctx.staging) await db.query(`set local lock_timeout = '5s'`);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const left = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n)
        + Number((await one(`select count(*) n from pg_trigger where tgname = any($1)`, [TRIGGERS])).n)
        + Number((await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES])).n);
      ok(left === 0, 'down: tables, functions and the 4 triggers are gone');
      ok(Number((await one(`select count(*) n from tk_client_projects where id = any($1)`, [[p1.id, p2.id, p3.id]])).n) === 3
         && Number((await one(`select count(*) n from finance_approvals where id = $1`, [fa])).n) === 1, 'down leaves the turnkey and finance rows alone');
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
      await db.query('rollback to savepoint snrt');
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
  const files = fs.readdirSync('supabase/migrations');
  const MIG = files.find((f) => f.endsWith('_staff_notifications.sql'));
  const M254 = files.find((f) => f.endsWith('_office_workspace.sql'));
  const M255 = files.find((f) => f.endsWith('_staff_approvals.sql'));
  if (!MIG || !M254 || !M255) { console.error('✘ migrations 254 / 255 / 256 not found'); process.exit(1); }
  const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
  const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');
  const UP_254 = fs.readFileSync(`supabase/migrations/${M254}`, 'utf8');
  const UP_255 = fs.readFileSync(`supabase/migrations/${M255}`, 'utf8');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  const { appliedAfter, unwind, reapply, MAX_UNWIND } = await import('./lib-later-migrations.mjs');
  let later = [];
  let failed = 0;
  try {
    await db.query('begin');
    const applied = (await db.query(`select to_regclass('public.staff_notifications') t`)).rows[0].t;
    failed = await runStaffNotificationChecks(db, {
      UP, DOWN, UP_254, UP_255, MIG, SNAP, staging: true,
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
  console.log(failed ? `\nstaff-notifications: ${failed} check(s) failed` : '\nstaff-notifications: all passed');
  process.exitCode = failed ? 1 : 0;
}
