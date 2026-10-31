// SPEC §17 checks (rolled back): staff need aal2, step-up for sensitive actions, lockout after 5 failures, staff ≠ customer.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const id = async (e) => (await db.query('select id from profiles where email=$1', [e])).rows[0].id;
const [admin, fin, fin2, ops, buyer] = await Promise.all(['admin', 'finance', 'finance2', 'ops', 'buyer'].map((u) => id(`${u}@demo.octopusb2b.com`)));
const now = () => Math.floor(Date.now() / 1000);
// level: 'aal1' (password only) | 'stale' (aal2, code verified 30 min ago) | 'fresh' (aal2, code just now)
const as = async (uid, level = 'fresh') => {
  await db.query('reset role');
  const claims = { sub: uid, role: 'authenticated',
    aal: level === 'aal1' ? 'aal1' : 'aal2',
    amr: level === 'aal1' ? [{ method: 'password', timestamp: now() }]
       : [{ method: 'password', timestamp: now() - 1900 }, { method: 'totp', timestamp: level === 'stale' ? now() - 1800 : now() }] };
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)]);
  await db.query('set local role authenticated');
};
const one = async (s, p) => (await db.query(s, p)).rows[0];
let failed = 0;
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const expectErr = async (fn, code, m) => { await db.query('savepoint s'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.message.includes(code), `${m} → ${e.message}`); } await db.query('rollback to savepoint s'); };

await db.query('begin');
try {
  // 2FA everywhere: staff without aal2 cannot read staff tables
  await as(ops, 'aal1');
  ok(Number((await one('select count(*) n from kyc_submissions')).n) === 0, 'ops with password only (aal1) sees no KYC submissions');
  ok(Number((await one('select count(*) n from suppliers')).n) === 0, 'aal1 staff cannot read suppliers');
  ok((await one('select is_staff() v')).v === false && (await one(`select can('orders','view') v`)).v === false, 'aal1 staff have no staff permissions');
  await as(ops, 'fresh');
  ok(Number((await one('select count(*) n from suppliers')).n) > 0, 'ops with aal2 can read suppliers');
  await as(admin, 'aal1');
  ok((await one('select is_admin() v')).v === false, 'admin without aal2 is not admin');
  await as(buyer, 'aal1');
  ok(Number((await one('select count(*) n from orders')).n) > 0, 'customers are unaffected (aal1 still sees own orders)');

  // step-up: sensitive actions need a code from the last 10 minutes
  await db.query('reset role');
  const fa = (await one(`insert into finance_approvals(kind, org_id, amount_cents, currency, reason, requested_by)
                         select 'refund', org_id, 500, 'USD', 'test', $1 from org_members where user_id=$2 limit 1 returning id`, [fin, buyer])).id;
  await as(fin2, 'stale');
  await expectErr(() => db.query(`select decide_finance_approval($1, true)`, [fa]), 'STEP_UP_REQUIRED', 'money approval with a stale code asks for step-up');
  await as(fin2, 'fresh');
  await db.query(`select decide_finance_approval($1, true)`, [fa]);
  ok((await one(`select status from finance_approvals where id=$1`, [fa])).status === 'executed', 'money approval with a fresh code succeeds');
  await as(admin, 'stale');
  await expectErr(() => db.query(`insert into user_roles(user_id, role_code) values ($1,'support')`, [ops]), 'row-level security', 'role change with a stale code is refused');
  await expectErr(() => db.query(`select admin_reset_2fa($1)`, [ops]), 'STEP_UP_REQUIRED', 'resetting 2FA needs step-up');
  await as(admin, 'fresh');
  await db.query(`insert into user_roles(user_id, role_code) values ($1,'support')`, [ops]);
  ok(true, 'role change with a fresh code works');
  ok(Number((await one(`select admin_reset_2fa($1, 'lost phone') v`, [ops])).v) >= 0, 'admin can reset 2FA (fresh code)');
  ok(Number((await one(`select admin_end_sessions($1, 'test') v`, [ops])).v) >= 0, 'admin can end sessions');
  const sec = await db.query(`select * from admin_staff_security()`);
  ok(sec.rows.length >= 8 && 'totp_factors' in sec.rows[0], `Staff & roles security columns (${sec.rows.length} staff)`);
  await db.query('reset role');
  ok(Number((await one(`select count(*) n from audit_log where action in ('auth.2fa_reset','auth.sessions_ended') and entity_id=$1`, [ops])).n) >= 2, '2FA reset and session end are audited');

  // lockout after 5 failures
  let r;
  for (let i = 1; i <= 5; i++) r = (await one(`select auth_record_failure('ops@demo.octopusb2b.com','password','203.0.113.5','test-agent') v`)).v;
  ok(r.locked === true && r.just_locked === true, 'account locked after 5 wrong passwords');
  ok((await one(`select auth_lock_status('ops@demo.octopusb2b.com') v`)).v.locked === true, 'lock status reports locked');
  ok(Number((await one(`select count(*) n from notifications n join user_roles ur on ur.user_id=n.user_id and ur.role_code='admin' where n.title='Staff account locked'`)).n) >= 1, 'admin is notified of the lockout');
  ok(Number((await one(`select count(*) n from audit_log where action='auth.lockout' and details->>'ip'='203.0.113.5'`)).n) === 1, 'lockout audited with IP and device');
  await as(admin, 'fresh');
  await db.query(`select admin_unlock_account('ops@demo.octopusb2b.com')`);
  await db.query('reset role');
  ok((await one(`select auth_lock_status('ops@demo.octopusb2b.com') v`)).v.locked === false, 'admin can unlock');

  // staff ≠ customer
  await expectErr(() => db.query(`insert into org_members(org_id, user_id) select id, $1 from organizations limit 1`, [ops]), 'STAFF_CANNOT_BE_CUSTOMER', 'a staff user cannot join a customer org');
  await expectErr(() => db.query(`insert into user_roles(user_id, role_code) values ($1,'support')`, [buyer]), 'CUSTOMER_CANNOT_BE_STAFF', 'a customer cannot be given a staff role');
  ok((await one(`select email_is_staff('new.person@octopusb2b.com') v`)).v === true, 'octopusb2b.com emails cannot sign up as customers');
} finally {
  await db.query('rollback');
  await db.end();
}
console.log(failed ? `\n${failed} failed` : '\nall staff-auth checks passed');
process.exitCode = failed ? 1 : 0;

