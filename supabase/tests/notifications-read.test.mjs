// Bug 1 (8 Nov 2026): notifications — one source for list + count, own rows only, only read_at writable, one per event.
// STAGING ONLY (refuses otherwise). One transaction, rolled back: no org, user or notification persists.
// Run: node supabase/tests/notifications-read.test.mjs
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (uid) => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal1' })]); await db.query('set local role authenticated'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows, n: r.rowCount }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message }; } };
const user = async (email) => (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
try {
  await db.query('begin');
  const uA = await user('notif-a@example.com'); const uB = await user('notif-b@example.com');
  const admin = await user('notif-admin@example.com');
  await db.query(`insert into user_roles(user_id, role_code) values ($1, 'admin')`, [admin]);
  const oA = (await one(`insert into organizations(name, country) values ('Notif test A', 'AE') returning id`)).id;
  const oB = (await one(`insert into organizations(name, country) values ('Notif test B', 'AE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1,$2,'owner'), ($3,$4,'owner')`, [oA, uA, oB, uB]);
  // A: two unread company notifications + one staff alert about A (user_id = admin, org_id = A, like create_brand_project)
  const n1 = (await one(`insert into notifications(org_id, title, link) values ($1, 'KYC verified', '/account/kyc') returning id`, [oA])).id;
  const n2 = (await one(`insert into notifications(org_id, title, link) values ($1, '3PL request SR-1 paid', '/account/sourcing/SR-1') returning id`, [oA])).id;
  await db.query(`insert into notifications(user_id, org_id, title, link) values ($1, $2, 'New Make My Brand request MB-9', '/admin/customers/x')`, [admin, oA]);
  const nB = (await one(`insert into notifications(org_id, title) values ($1, 'B only') returning id`, [oB])).id;

  // before the fix there is no my_notifications(): fall back to what the app queried then (company rows by org_id)
  const hasFn = !!(await one(`select to_regprocedure('my_notifications()') f`)).f;
  const src = hasFn ? 'my_notifications()' : `(select * from notifications where org_id = '${oA}') x`;
  if (!hasFn) console.log('· my_notifications() missing — using the old app query (before the fix)');
  await as(uA);
  const unread = async () => Number((await one(`select count(*) n from ${src} where read_at is null`)).n);
  const listed = (await db.query(`select title from ${src} order by created_at`)).rows.map((r) => r.title);
  ok(await unread() === 2, `bubble = 2 for two unread (got ${await unread()})`);
  ok(listed.length === 2 && !listed.some((t) => /Make My Brand/.test(t)), `list = the same 2 rows; staff alert not shown to the customer (${listed.join(' | ')})`);
  ok(Number((await one(`select count(*) n from notifications where read_at is null`)).n) === 2, 'direct table read gives the same 2 (RLS)');
  // open one → only that one is read
  const r1 = await tryq(`update notifications set read_at = now() where id = $1 and read_at is null returning id`, [n1]);
  ok(!r1.err && r1.n === 1, 'open #1: marked read');
  ok(await unread() === 1, 'bubble = 1 after opening one');
  const first = (await one(`select read_at from notifications where id = $1`, [n1])).read_at;
  await tryq(`update notifications set read_at = now() + interval '1 hour' where id = $1`, [n1]);
  ok(+(await one(`select read_at from notifications where id = $1`, [n1])).read_at === +first, 'a second "read" keeps the first read time');
  const clr = await tryq(`update notifications set read_at = null where id = $1`, [n1]);
  ok(+(await one(`select read_at from notifications where id = $1`, [n1])).read_at === +first, `read_at cannot be cleared (${clr.err ?? 'ignored'})`);
  // only read_at
  const t = await tryq(`update notifications set title = 'hacked' where id = $1`, [n2]);
  ok(!!t.err && /permission denied/i.test(t.err), `changing the title: ${t.err ?? 'ALLOWED'}`);
  const l = await tryq(`update notifications set link = 'https://evil.example' where id = $1`, [n2]);
  ok(!!l.err, 'changing the link: denied');
  const ins = await tryq(`insert into notifications(org_id, title) values ($1, 'fake')`, [oA]);
  ok(!!ins.err, 'inserting a notification: denied');
  // another customer's notification
  const x = await tryq(`update notifications set read_at = now() where id = $1 returning id`, [nB]);
  ok(!x.err && x.n === 0, `A marks B's notification read: ${x.err ?? `${x.n} row(s)`}`);
  ok(!(await db.query(`select 1 from notifications where id = $1`, [nB])).rowCount, "A cannot read B's notification");
  // mark all only up to what was seen
  const seen = (await one(`select max(created_at)::text m from ${src}`)).m; // text keeps microseconds (as PostgREST returns it)
  await db.query('reset role');
  const late = (await one(`insert into notifications(org_id, title, created_at) values ($1, 'arrived after the click', now() + interval '1 minute') returning id`, [oA])).id;
  await as(uA);
  await tryq(`update notifications set read_at = now() where read_at is null and created_at <= $1`, [seen]);
  ok(!!(await one(`select read_at from notifications where id = $1`, [n2])).read_at, 'mark all: seen notification read');
  ok(!(await one(`select read_at from notifications where id = $1`, [late])).read_at, 'mark all: a notification that arrived after the click stays unread');
  // B untouched
  await db.query('reset role');
  ok(!(await one(`select read_at from notifications where id = $1`, [nB])).read_at, "B's notification still unread");
  // one per event
  const d1 = await tryq(`insert into notifications(org_id, title, dedupe_key) values ($1, 'Paid', 'k:test') on conflict (dedupe_key) do nothing`, [oA]);
  await tryq(`insert into notifications(org_id, title, dedupe_key) values ($1, 'Paid', 'k:test') on conflict (dedupe_key) do nothing`, [oA]);
  const dn = d1.err ? -1 : Number((await one(`select count(*) n from notifications where dedupe_key = 'k:test'`)).n);
  ok(dn === 1, `same event key twice → one notification (${d1.err ?? dn})`);
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'notif-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nnotifications: ${failed} check(s) failed` : '\nnotifications: all passed');
process.exitCode = failed ? 1 : 0;
