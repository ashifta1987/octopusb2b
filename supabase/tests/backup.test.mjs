// SPEC §16 checks (rolled back): permissions, restore workflow, partial restore of a deleted product, money tables refused.
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const id = async (e) => (await db.query('select id from profiles where email=$1', [e])).rows[0].id;
const [admin, fin, ops, buyer] = await Promise.all(['admin', 'finance', 'ops', 'buyer'].map((u) => id(`${u}@demo.octopusb2b.com`)));
const as = async (uid, aal = 'aal2') => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal, amr: aal === 'aal2' ? [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] : [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] })]); await db.query('set local role authenticated'); };
const one = async (s, p) => (await db.query(s, p)).rows[0];
let failed = 0;
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const expectErr = async (fn, code, m) => { await db.query('savepoint s'); try { await fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.message.includes(code), `${m} → ${e.message}`); } await db.query('rollback to savepoint s'); };

await db.query('begin');
try {
  // permissions: only admin by default
  await as(buyer);
  ok(Number((await one('select count(*) n from backups')).n) === 0, 'customer cannot see backups (RLS)');
  await expectErr(() => db.query(`select request_backup()`), 'FORBIDDEN', 'customer cannot start a backup');
  await as(ops);
  await expectErr(() => db.query(`select request_backup()`), 'FORBIDDEN', 'operations cannot start a backup (admin only by default)');
  await expectErr(() => db.query(`select request_export(array['orders'],'csv')`), 'FORBIDDEN', 'operations cannot export data');

  // backup reported by the workflow (service role)
  await db.query('reset role');
  const bk = (await one(`select backup_report('BK-TEST-0001','completed',100,'scheduled','daily',123456,'s3://octopus-backups/BK-TEST-0001',
      '{"tables":{"products":60}}'::jsonb, '[{"path":"db/data.sql.gz.age","kind":"db_data","size_bytes":1000,"sha256":"abc"}]'::jsonb, true, '20261101000080') v`)).v;
  await as(admin);
  ok((await one(`select status, checksum_ok from backups where id=$1`, [bk])).status === 'completed', 'admin sees the completed backup');
  const manual = (await one(`select request_backup('test') v`)).v;
  ok(!!manual, 'admin can request "Back up now"');
  await expectErr(() => db.query(`select request_backup()`), 'BACKUP_ALREADY_RUNNING', 'second concurrent backup is refused');

  // restore workflow + maker-checker + MFA
  await as(admin, 'aal1');
  await expectErr(() => db.query(`select request_restore($1,'full_staging','x')`, [bk]), 'STEP_UP_REQUIRED', 'restore request needs a fresh 2FA code (step-up)');
  await as(admin);
  const rs = (await one(`select request_restore($1,'full_staging','Rebuild staging') v`, [bk])).v;
  await db.query('reset role');
  await db.query(`select restore_report($1,'verified','[{"kind":"checksums","status":"pass","detail":"412 of 412"},{"kind":"ledger_balanced","status":"pass","detail":"USD and CNY"}]'::jsonb)`, [rs]);
  ok((await one(`select status from restore_requests where id=$1`, [rs])).status === 'pending_approval', 'verified restore waits for a second approver');
  await as(admin);
  await expectErr(() => db.query(`select approve_restore($1)`, [rs]), 'MAKER_CANNOT_APPROVE', 'requester cannot approve own restore');
  await as(ops);
  await expectErr(() => db.query(`select approve_restore($1)`, [rs]), 'FORBIDDEN', 'operations cannot approve a restore');
  await as(fin, 'aal1');
  await expectErr(() => db.query(`select approve_restore($1)`, [rs]), 'STEP_UP_REQUIRED', 'approver must re-enter 2FA (step-up)');
  await as(fin);
  await db.query(`select approve_restore($1)`, [rs]);
  ok((await one(`select status from restore_requests where id=$1`, [rs])).status === 'approved', 'finance (second approver) approves a money-touching restore');

  // partial restore: product deleted after the backup, recovered from the recovery schema
  await db.query('reset role');
  const p = await one(`select p.id, p.title from products p where not exists(select 1 from rfqs where product_id=p.id)
                        and not exists(select 1 from service_requests where product_id=p.id) order by title limit 1`);
  await db.query(`create table recovery.products as select * from public.products where id = $1`, [p.id]);
  await db.query(`create table recovery.ledger_entries as select * from public.ledger_entries limit 1`);
  await db.query(`delete from recommendations where product_id=$1 or recommended_id=$1`, [p.id]);
  await db.query(`delete from products where id=$1`, [p.id]);
  await as(admin);
  const cmp = (await one(`select recovery_compare('products', array[$1::uuid]) v`, [p.id])).v;
  ok(cmp[0]?.status === 'missing', 'compare screen shows the deleted product as missing');
  await expectErr(() => db.query(`select restore_records('ledger_entries', array[gen_random_uuid()], 'x')`), 'MONEY_RECORDS_NOT_RESTORABLE', 'restore_records refuses ledger rows');
  await expectErr(() => db.query(`select restore_records('payments', array[gen_random_uuid()], 'x')`), 'MONEY_RECORDS_NOT_RESTORABLE', 'restore_records refuses payment rows');
  const n = (await one(`select restore_records('products', array[$1::uuid], 'Deleted by mistake') v`, [p.id])).v;
  ok(n === 1 && (await one(`select title from products where id=$1`, [p.id]))?.title === p.title, `deleted product recovered: ${p.title}`);
  await db.query('reset role');
  ok(Number((await one(`select count(*) n from audit_log where action='restore.records' and entity='products'`)).n) >= 1, 'partial restore is in the audit log');

  // maintenance mode
  await as(admin);
  await db.query(`select set_maintenance(true, 'Restore in progress')`);
  ok((await one(`select maintenance_enabled() v`)).v === true, 'maintenance mode on');
  await as(buyer);
  await expectErr(() => db.query(`select set_maintenance(false)`), 'FORBIDDEN', 'customer cannot toggle maintenance');

  // exports
  await as(admin);
  const ex = (await one(`select request_export(array['orders','ledger'],'xlsx', null, null, true, 'test') v`)).v;
  ok((await one(`select status from data_exports where id=$1`, [ex])).status === 'queued', 'admin can queue a data export');
} finally {
  await db.query('rollback');
  await db.end();
}
console.log(failed ? `\n${failed} failed` : '\nall backup checks passed');
process.exitCode = failed ? 1 : 0;

