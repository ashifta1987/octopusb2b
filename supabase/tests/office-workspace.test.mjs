// ODS T8 · Back Office workspace — DB checks for migration *_office_workspace (254, DRAFT).
// STAGING ONLY, one rolled-back transaction, acting as staff / customers through JWT claims (what PostgREST does).
// Self-contained: if 254 is not applied yet it is applied INSIDE the transaction (and rolled back with everything else).
//  0. Structure: 3 tables with RLS; column read grants only (no direct writes); one read policy each; RPC grants; helpers not
//     callable; search_path=public.
//  1. Workspace tabs: staff save / restore their own; another staff member and customers see nothing; customers can't save;
//     shape checks (13 max, app paths only, duplicate ids, active tab must be open, size cap).
//  2. UI prefs: patch merge, validation, owner only.
//  3. Saved views: personal = owner only; shared with a role = holders of that role; shared with everyone = admins only;
//     name unique per page; one default per page; update / delete own only; admins may delete shared views; audit on share.
//  4. (staging) down → up → up → down: identical schema.
// Run: node supabase/tests/office-workspace.test.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function runOfficeWorkspaceChecks(db, ctx) {
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
    await db.query('savepoint ow');
    try { const r = (await db.query(q, p)).rows[0]; await db.query('release savepoint ow'); return r; }
    catch (e) { await db.query('rollback to savepoint ow'); lastErr = e.message; return { __error: e.message }; }
  };
  const stamp = Date.now().toString(36);
  const TABLES = ['workspace_tabs', 'saved_views', 'ui_prefs'];
  const RPC_FNS = ['save_workspace_tabs', 'save_ui_prefs', 'save_view', 'delete_view'];
  const INTERNAL_FNS = ['office_guard', 'office_json_text'];

  await owner();
  if (!(await one(`select to_regclass('public.saved_views') t`)).t) {
    await db.query(ctx.UP);
    console.log('- 254 not applied on this database: applied inside the test transaction (rolled back at the end)');
  }

  // ── 0. structure ──
  const rls = await all(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABLES]);
  ok(rls.length === 3 && rls.every((r) => r.relrowsecurity), '3 new tables, RLS on every one');
  const grants = await all(`select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [TABLES]);
  ok(grants.length === 0, 'no table-wide grant to anon or signed-in users (no direct insert / update / delete)');
  const colGrants = await all(`select table_name, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated'`, [TABLES]);
  ok(colGrants.length > 0 && colGrants.every((c) => c.privilege_type === 'SELECT'), 'signed-in users: column SELECT grants only');
  const pols = await all(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]);
  ok(pols.length === 3 && pols.every((p) => p.cmd === 'SELECT'), 'one read policy per table, no write policy');
  const fns = await all(`select p.proname, p.proconfig::text cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]]);
  ok(fns.length === RPC_FNS.length + INTERNAL_FNS.length && fns.every((f) => /search_path=public/.test(f.cfg ?? '')), 'every new function exists with search_path=public');
  ok(fns.every((f) => !f.anon_x), 'anon executes none of them');
  ok(fns.filter((f) => RPC_FNS.includes(f.proname)).every((f) => f.auth_x) && fns.filter((f) => INTERNAL_FNS.includes(f.proname)).every((f) => !f.auth_x),
    'signed-in users execute the 4 RPCs only, never the guard / text helper');

  // ── fixtures ──
  const mkUser = async (tag, ...roles) => {
    await owner();
    const mail = `ow-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, email_confirmed_at${ctx.staging ? ', aud, role, instance_id' : ''}) values (gen_random_uuid(), $1, now()${ctx.staging ? ", 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'" : ''}) returning id`, [mail])).id;
    await db.query(`insert into profiles (id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`, [id, `OW ${tag}`, mail]);
    for (const r of roles) await db.query(`insert into user_roles (user_id, role_code) values ($1, $2)`, [id, r]);
    return id;
  };
  const F1 = await mkUser('fin1', 'finance');
  const F2 = await mkUser('fin2', 'finance');
  const OPS = await mkUser('ops', 'operations');
  const ADM = await mkUser('admin', 'admin');
  const CUST = await mkUser('cust');
  const org = (await one(`insert into organizations (name, country) values ($1, 'AE') returning id`, [`OW org ${stamp}`])).id;
  await db.query(`insert into org_members (org_id, user_id, member_role) values ($1, $2, 'owner')`, [org, CUST]);

  // ── 1. workspace tabs ──
  const dash = { id: 'dashboard', href: '/office', title: 'Dashboard', pinned: true };
  const tab = (i) => ({ id: `t${i}`, href: `/office/orders/ORD-${i}`, title: `Order ${i}`, filters: { status: 'open' }, scrollY: 120 });
  await as(F1);
  let r = await rpc(`select save_workspace_tabs($1::jsonb, 't1') x`, [JSON.stringify([dash, tab(1), tab(2)])]);
  ok(!r.__error && !!r.x, 'staff member saves 3 tabs with the active one');
  const mine = await one(`select tabs, active_id from workspace_tabs`);
  ok(mine?.tabs.length === 3 && mine.active_id === 't1' && mine.tabs[1].filters.status === 'open', 'they restore their tabs (order, filters, active tab)');
  r = await rpc(`select save_workspace_tabs($1::jsonb, null) x`, [JSON.stringify([dash, tab(3)])]);
  ok(!r.__error && (await one(`select jsonb_array_length(tabs) n from workspace_tabs`)).n === 2, 'saving again replaces the list (one row per user)');
  await as(F2);
  ok(Number((await one(`select count(*) n from workspace_tabs`)).n) === 0, 'another staff member reads none of them');
  await as(CUST);
  r = await rpc(`select save_workspace_tabs('[]'::jsonb) x`);
  ok(/STAFF_ONLY/.test(r.__error ?? ''), 'a customer cannot save tabs (STAFF_ONLY)');
  await as(F1, 'aal1');
  r = await rpc(`select save_workspace_tabs('[]'::jsonb) x`);
  ok(/STAFF_ONLY/.test(r.__error ?? ''), 'staff without a 2FA session cannot save (STAFF_ONLY)');
  await as(null, 'aal1', 'anon');
  r = await rpc(`select save_workspace_tabs('[]'::jsonb) x`);
  ok(/permission denied/.test(r.__error ?? ''), 'anon cannot call it');
  await as(F1);
  const tooMany = [dash, ...Array.from({ length: 13 }, (_, i) => tab(i + 10))];
  r = await rpc(`select save_workspace_tabs($1::jsonb) x`, [JSON.stringify(tooMany)]);
  ok(/INVALID_INPUT: at most 12/.test(r.__error ?? ''), '14 tabs → INVALID_INPUT (12 open + Dashboard)');
  for (const [href, what] of [['https://evil.example/x', 'an outside URL'], ['//evil.example', 'a protocol-relative URL'], ['/\\evil', 'a backslash path']]) {
    r = await rpc(`select save_workspace_tabs($1::jsonb) x`, [JSON.stringify([{ id: 'a', href, title: 'x' }])]);
    ok(/INVALID_INPUT: tab link/.test(r.__error ?? ''), `${what} as a tab link → INVALID_INPUT`);
  }
  r = await rpc(`select save_workspace_tabs($1::jsonb) x`, [JSON.stringify([tab(1), tab(1)])]);
  ok(/duplicate tab id/.test(r.__error ?? ''), 'duplicate tab ids → INVALID_INPUT');
  r = await rpc(`select save_workspace_tabs($1::jsonb, 'nope') x`, [JSON.stringify([tab(1)])]);
  ok(/active tab is not open/.test(r.__error ?? ''), 'an active tab that is not open → INVALID_INPUT');
  r = await rpc(`select save_workspace_tabs('{"a":1}'::jsonb) x`);
  ok(/must be a list/.test(r.__error ?? ''), 'not a list → INVALID_INPUT');
  r = await rpc(`select save_workspace_tabs($1::jsonb) x`, [JSON.stringify([{ ...tab(1), filters: { big: 'x'.repeat(33000) } }])]);
  ok(/too large/.test(r.__error ?? ''), 'over 32 KB → INVALID_INPUT');
  ok((await one(`select jsonb_array_length(tabs) n from workspace_tabs`)).n === 2, 'refused saves change nothing');

  // ── 2. UI prefs ──
  r = await rpc(`select save_ui_prefs('{"sidebar_collapsed": true, "groups_collapsed": ["accounts"]}'::jsonb) x`);
  ok(r.x?.sidebar_collapsed === true && r.x.groups_collapsed[0] === 'accounts' && r.x.density_override === null, 'prefs saved (sidebar collapsed, one group collapsed)');
  r = await rpc(`select save_ui_prefs('{"density_override": "compact", "extra": {"grid_page_size": 50}}'::jsonb) x`);
  ok(r.x?.sidebar_collapsed === true && r.x.density_override === 'compact' && r.x.extra.grid_page_size === 50, 'a second patch keeps the earlier choices');
  r = await rpc(`select save_ui_prefs('{"extra": {"grid_page_size": null, "x": 1}}'::jsonb) x`);
  ok(r.x?.extra.x === 1 && !('grid_page_size' in (r.x?.extra ?? {})), 'extra merges key by key; null removes a key');
  r = await rpc(`select save_ui_prefs('{"theme": "dark"}'::jsonb) x`);
  ok(/unknown preference/.test(r.__error ?? ''), 'unknown preference → INVALID_INPUT');
  r = await rpc(`select save_ui_prefs('{"density_override": "huge"}'::jsonb) x`);
  ok(/density/.test(r.__error ?? ''), 'bad density → INVALID_INPUT');
  r = await rpc(`select save_ui_prefs('{"sidebar_collapsed": "yes"}'::jsonb) x`);
  ok(/sidebar_collapsed/.test(r.__error ?? ''), 'non-boolean sidebar flag → INVALID_INPUT');
  await as(F2);
  ok(Number((await one(`select count(*) n from ui_prefs`)).n) === 0, 'another staff member does not read them');
  await as(CUST);
  r = await rpc(`select save_ui_prefs('{}'::jsonb) x`);
  ok(/STAFF_ONLY/.test(r.__error ?? ''), 'customers cannot save prefs');

  // ── 3. saved views ──
  const PAGE = '/office/accounts/invoices';
  await as(F1);
  r = await rpc(`select save_view(null, $1, 'My overdue', 'personal', null, '{"status":"overdue"}', '["number","customer","balance"]', '[{"id":"due","desc":false}]', true) x`, [PAGE]);
  const v1 = r.x;
  ok(!!v1, 'personal view created (default for the page)');
  r = await rpc(`select save_view(null, $1, 'My overdue', 'personal') x`, [PAGE]);
  ok(/VIEW_NAME_TAKEN/.test(r.__error ?? ''), 'same name on the same page → VIEW_NAME_TAKEN');
  r = await rpc(`select save_view(null, $1, 'Big ones', 'personal', null, '{}', '[]', '[]', true) x`, [PAGE]);
  const v2 = r.x;
  ok(Number((await one(`select count(*) n from saved_views where is_default and page = $1`, [PAGE])).n) === 1
     && (await one(`select is_default d from saved_views where id = $1`, [v2]))?.d === true, 'a new default replaces the old one (one default per page)');
  r = await rpc(`select save_view(null, $1, 'Finance · to chase', 'shared', 'finance', '{"status":"overdue","days":">30"}') x`, [PAGE]);
  const vShared = r.x;
  ok(!!vShared, 'finance user shares a view with the finance role');
  r = await rpc(`select save_view(null, $1, 'For everyone', 'shared', null) x`, [PAGE]);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'non-admin sharing with all staff → ROLE_NOT_ALLOWED');
  r = await rpc(`select save_view(null, $1, 'For ops', 'shared', 'operations') x`, [PAGE]);
  ok(/ROLE_NOT_ALLOWED/.test(r.__error ?? ''), 'sharing with a role you do not hold → ROLE_NOT_ALLOWED');
  r = await rpc(`select save_view(null, '/Office/../x', 'Bad', 'personal') x`);
  ok(/INVALID_INPUT: page/.test(r.__error ?? ''), 'bad page key → INVALID_INPUT');
  r = await rpc(`select save_view(null, $1, 'Bad cols', 'personal', null, '{}', '{"a":1}') x`, [PAGE]);
  ok(/INVALID_INPUT: columns/.test(r.__error ?? ''), 'columns must be a list');
  await as(F2);
  let seen = (await all(`select id, name from saved_views where page = $1`, [PAGE])).map((v) => v.id);
  ok(seen.length === 1 && seen[0] === vShared, 'another finance user sees only the shared finance view (not the personal ones)');
  r = await rpc(`select save_view($1, $2, 'Hijack', 'personal') x`, [vShared, PAGE]);
  ok(/NOT_FOUND/.test(r.__error ?? ''), 'they cannot change it (NOT_FOUND)');
  r = await rpc(`select delete_view($1) x`, [vShared]);
  ok(/NOT_FOUND/.test(r.__error ?? ''), 'nor delete it');
  await as(OPS);
  ok(Number((await one(`select count(*) n from saved_views where page = $1`, [PAGE])).n) === 0, 'operations staff see none of them');
  await as(ADM);
  r = await rpc(`select save_view(null, $1, 'Everyone · this month', 'shared', null) x`, [PAGE]);
  const vAll = r.x;
  ok(!!vAll, 'an admin shares a view with all staff');
  await as(OPS);
  seen = (await all(`select id from saved_views where page = $1`, [PAGE])).map((v) => v.id);
  ok(seen.length === 1 && seen[0] === vAll, 'every staff member sees the all-staff view');
  await as(CUST);
  ok(Number((await one(`select count(*) n from saved_views`)).n) === 0, 'customers see no views');
  r = await rpc(`select save_view(null, $1, 'x', 'personal') x`, [PAGE]);
  ok(/STAFF_ONLY/.test(r.__error ?? ''), 'customers cannot save views');
  await as(F1);
  r = await rpc(`select save_view($1, $2, 'My overdue (30+)', 'personal', null, '{"status":"overdue","days":">30"}', '["number"]', '[]', false) x`, [v1, PAGE]);
  ok(r.x === v1 && (await one(`select name from saved_views where id = $1`, [v1]))?.name === 'My overdue (30+)', 'owner renames / updates their view');
  await owner();
  const auditBefore = Number((await one(`select count(*) n from audit_log where action in ('office.view_shared', 'office.view_deleted')`)).n);
  await as(ADM);
  r = await rpc(`select delete_view($1) x`, [vShared]);
  ok(r.x === true, 'an admin may remove someone else\'s shared view');
  await as(F1);
  r = await rpc(`select delete_view($1) x`, [v2]);
  ok(r.x === true && Number((await one(`select count(*) n from saved_views where page = $1 and user_id = $2`, [PAGE, F1])).n) === 1, 'owner deletes their own view');
  await owner();
  ok(Number((await one(`select count(*) n from audit_log where action in ('office.view_shared', 'office.view_deleted')`)).n) === auditBefore + 1, 'removing a shared view is audited (shares were audited too)');
  ok(Number((await one(`select count(*) n from audit_log where action = 'office.view_shared' and entity_id = $1`, [vAll])).n) === 1, 'sharing is audited');
  await as(F1);
  r = await rpc(`insert into saved_views (user_id, page, name) values ($1, $2, 'direct') returning id`, [F1, PAGE]);
  ok(/permission denied/.test(r.__error ?? ''), 'no direct insert into saved_views');
  r = await rpc(`update workspace_tabs set tabs = '[]' where user_id = $1 returning user_id`, [F1]);
  ok(/permission denied/.test(r.__error ?? ''), 'no direct update of workspace_tabs');

  // ── 4. round trip ──
  if (ctx.staging || ctx.local) {
    await owner();
    await db.query('savepoint owrt');
    try {
      if (ctx.unwindLater) await ctx.unwindLater(db);
      const snapSchema = async () => (await one(SNAP)).h;
      if (ctx.staging) await db.query(`set local lock_timeout = '5s'`);
      const withIt = await snapSchema();
      await db.query(ctx.DOWN);
      const without = await snapSchema();
      const gone = Number((await one(`select count(*) filter (where to_regclass('public.' || t) is not null) n from unnest($1::text[]) t`, [TABLES])).n);
      const fnLeft = Number((await one(`select count(*) n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [[...RPC_FNS, ...INTERNAL_FNS]])).n);
      ok(gone === 0 && fnLeft === 0 && !(await one(`select to_regtype('public.saved_view_scope') t`)).t, 'down: every 254 table, function and the enum are gone');
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
      await db.query('rollback to savepoint owrt');
    }
  } else skip('round trip (staging only)');
  return failed;
}

// one server-side md5 of the public schema (relations, columns, constraints, indexes, policies, enums, functions, triggers)
export const SNAP = `select md5(string_agg(k || '|' || x, E'\\n' order by k, x)) h from (
  select 'rel' k, c.relname || ':' || c.relkind::text || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity x from pg_class c where c.relnamespace = 'public'::regnamespace
  union all select 'col', table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable from information_schema.columns where table_schema = 'public'
  union all select 'con', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'idx', indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
  union all select 'pol', tablename || ':' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
  union all select 'typ', t.typname from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'
  union all select 'trg', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all select 'fn', p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f'
) s`;

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
  const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_office_workspace.sql'));
  if (!MIG) { console.error('✘ office workspace migration (254) not found'); process.exit(1); }
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
    const applied = (await db.query(`select to_regclass('public.saved_views') t`)).rows[0].t;
    failed = await runOfficeWorkspaceChecks(db, {
      UP, DOWN, MIG, staging: true,
      // later migrations exist only when 254 is really applied; otherwise there's nothing to unwind
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
  console.log(failed ? `\noffice-workspace: ${failed} check(s) failed` : '\noffice-workspace: all passed');
  process.exitCode = failed ? 1 : 0;
}
