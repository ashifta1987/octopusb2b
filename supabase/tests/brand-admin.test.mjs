// Bug 2 (8 Nov 2026): Make My Brand → Admin. STAGING ONLY, one transaction, rolled back (nothing persists; the
// brand_project_seq number used by the test projects cannot be rolled back — sequences never are).
// Run: node supabase/tests/brand-admin.test.mjs
import { config } from 'dotenv'; import pg from 'pg';
config({ path: '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) { console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (uid, aal = 'aal2') => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]); await db.query('set local role authenticated'); };
const tryq = async (q, p) => { await db.query('savepoint s'); try { const r = await db.query(q, p); await db.query('release savepoint s'); return { err: null, rows: r.rows }; } catch (e) { await db.query('rollback to savepoint s'); return { err: e.message, rows: [] }; } };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users(id, email, aud, role, instance_id) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000') returning id`, [email])).id;
  await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name, email = excluded.email`, [id, `T ${role ?? 'buyer'}`, email]);
  if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
  return id;
};
try {
  await db.query('begin');
  const cA = await user('mb-a@example.com'); const cB = await user('mb-b@example.com');
  const admin = await user('mb-admin@example.com', 'admin');
  const mgr = await user('mb-mgr@example.com', 'account_manager');
  const wh = await user('mb-wh@example.com', 'warehouse');
  const oA = (await one(`insert into organizations(name, country) values ('MB admin test A', 'AE') returning id`)).id;
  const oB = (await one(`insert into organizations(name, country) values ('MB admin test B', 'AE') returning id`)).id;
  await db.query(`insert into org_members(org_id, user_id, member_role) values ($1,$2,'owner'), ($3,$4,'owner')`, [oA, cA, oB, cB]);
  await db.query(`insert into account_managers(org_id, staff_user_id, is_primary) values ($1, $2, true)`, [oB, mgr]);
  const existing = Number((await one(`select count(*) n from brand_projects`)).n);

  // ── customers submit ──
  await as(cA, 'aal1');
  const pA = (await one(`select create_brand_project($1) r`, [JSON.stringify({ product_link: 'https://example.com/a', quantity: '500', method: 'box', packaging: 'gift_box', stock_destination: 'bulk', bulk_country: 'AU', logo_paths: [`${oA}/logo.svg`] })])).r;
  ok(pA.needs_manager === true, `A (no account manager) submits ${pA.ref}: needs_manager`);
  const myA = (await db.query(`select title, link from my_notifications()`)).rows;
  ok(myA.some((n) => n.title === `Brand project received · ${pA.ref}`), 'A gets "Brand project received"');
  ok(!myA.some((n) => /New brand project/.test(n.title)), 'A does not see the staff alert');
  await as(cB, 'aal1');
  const pB = (await one(`select create_brand_project($1) r`, [JSON.stringify({ product_link: 'https://example.com/b', quantity: '100', method: 'pad', packaging: 'standard', stock_destination: 'warehouse', logo_paths: [] })])).r;
  ok(pB.needs_manager === false, `B (has account manager) submits ${pB.ref}`);
  // ── Admin notifications ──
  await db.query('reset role');
  const adminN = (await db.query(`select title, link, org_id from notifications where user_id = $1`, [admin])).rows;
  ok(adminN.some((n) => n.title === `New brand project ${pA.ref} — needs an account manager` && n.link === `/admin/brand-projects/${pA.id}` && !n.org_id), 'admin alert for A: "needs an account manager", links to the project, staff-only');
  const mgrN = (await db.query(`select title from notifications where user_id = $1`, [mgr])).rows;
  ok(mgrN.some((n) => n.title === `New brand project ${pB.ref}`), "B's account manager gets the alert for B");
  ok(!adminN.some((n) => n.title.includes(pB.ref)), 'admins are not alerted when a manager exists');
  // ── Admin list ──
  await as(admin);
  const list = (await db.query(`select * from admin_brand_projects()`)).rows;
  ok(list.length === existing + 2, `admin list shows every project (existing ${existing} + 2 new)`);
  const rowA = list.find((r) => r.id === pA.id);
  ok(rowA && rowA.company === 'MB admin test A' && rowA.manager_name === null && rowA.quantity === 500 && rowA.bulk_country === 'AU' && rowA.logo_paths.length === 1, 'A row: company, quantity, destination, logo, manager = none (Unassigned)');
  ok(list.find((r) => r.id === pB.id)?.manager_name === 'T account_manager', 'B row shows the customer\'s account manager');
  ok(list[0].created_at >= list[list.length - 1].created_at, 'newest first');
  ok((await db.query(`select * from admin_brand_projects(null, 'submitted')`)).rows.every((r) => r.status === 'submitted'), 'status filter');
  await as(mgr);
  const mgrList = (await db.query(`select id from admin_brand_projects()`)).rows.map((r) => r.id);
  ok(mgrList.includes(pB.id) && !mgrList.includes(pA.id), 'account manager sees only their customers\' projects');
  await as(wh);
  ok(!(await db.query(`select id from admin_brand_projects()`)).rowCount, 'staff without customer access (warehouse) see none');
  // ── customers: only their own ──
  await as(cB, 'aal1');
  ok(!(await db.query(`select 1 from brand_projects where id = $1`, [pA.id])).rowCount, "B cannot read A's project (direct API)");
  ok(!(await db.query(`select 1 from admin_brand_projects()`)).rowCount, 'B gets nothing from the staff list function');
  ok(!(await db.query(`select 1 from brand_project_history($1)`, [pA.id])).rowCount, 'B gets no history');
  await db.query('reset role');
  await db.query(`insert into storage.objects(bucket_id, name, owner) values ('brand-logos', $1, $2)`, [`${oA}/logo.svg`, cA]);
  await as(cB, 'aal1');
  ok(!(await db.query(`select 1 from storage.objects where bucket_id = 'brand-logos' and name = $1`, [`${oA}/logo.svg`])).rowCount, "B cannot read A's logo file");
  await as(admin);
  ok((await db.query(`select 1 from storage.objects where bucket_id = 'brand-logos' and name = $1`, [`${oA}/logo.svg`])).rowCount === 1, "admin can read A's logo file");
  // ── status moves ──
  await as(cB, 'aal1');
  ok(/FORBIDDEN/.test((await tryq(`select set_brand_project_status($1, 'proof')`, [pB.id])).err ?? ''), 'a customer cannot change the status');
  await as(mgr);
  ok(!(await tryq(`select set_brand_project_status($1, 'proof')`, [pB.id])).err, 'account manager: submitted → proof');
  ok(/NOT_FOUND/.test((await tryq(`select set_brand_project_status($1, 'proof')`, [pA.id])).err ?? ''), "account manager cannot touch another customer's project");
  ok(/REASON_REQUIRED/.test((await tryq(`select set_brand_project_status($1, 'closed', '  ')`, [pB.id])).err ?? ''), 'closing without a reason is refused');
  const cl = await tryq(`select set_brand_project_status($1, 'closed', 'Customer chose another supplier') r`, [pB.id]);
  ok(!cl.err && cl.rows[0].r.to === 'closed' && !cl.rows[0].r.warning, 'account manager closes with an internal reason (nothing paid → no warning)');
  await as(cB, 'aal1');
  const bNotes = (await db.query(`select title, body from my_notifications()`)).rows;
  ok(bNotes.some((n) => n.title === `Brand project ${pB.ref} closed`), 'customer gets "Brand project … closed"');
  ok(!bNotes.some((n) => /another supplier/.test(`${n.title} ${n.body}`)), 'the internal reason is not in the customer notification');
  ok((await one(`select status from brand_projects where id = $1`, [pB.id])).status === 'closed', 'customer sees status closed');
  ok(!(await db.query(`select 1 from audit_log where entity_id = $1`, [pB.ref])).rowCount, 'customer cannot read the audit log (reason stays internal)');
  await as(mgr);
  ok(/ADMIN_ONLY/.test((await tryq(`select set_brand_project_status($1, 'proof')`, [pB.id])).err ?? ''), 'reopen by an account manager is refused');
  await as(admin);
  ok(/REOPEN_TO_PREVIOUS/.test((await tryq(`select set_brand_project_status($1, 'sample')`, [pB.id])).err ?? ''), 'admin reopen only back to the previous step');
  ok(!(await tryq(`select set_brand_project_status($1, 'proof', 'Customer came back')`, [pB.id])).err, 'admin reopens → proof');
  const hist = (await db.query(`select * from brand_project_history($1)`, [pB.id])).rows;
  ok(hist.some((h) => h.from_status === 'proof' && h.to_status === 'closed' && h.reason === 'Customer chose another supplier' && h.actor === 'T account_manager'), 'audit: who, from → to, reason for the close');
  ok(hist.some((h) => h.from_status === 'closed' && h.to_status === 'proof'), 'audit: the reopen');
  // ── paid project: only admin may close, with a warning ──
  await db.query('reset role');
  const j = await tryq(`insert into journals(memo, ref_type, ref_id) values ('test deposit', 'brand_project', $1::uuid)`, [pB.id]);
  if (j.err) console.log('· journal fixture:', j.err);
  const paid = (await one(`select brand_project_paid($1) p`, [pB.id])).p;
  if (paid) {
    await as(mgr);
    ok(/ADMIN_ONLY_PAID/.test((await tryq(`select set_brand_project_status($1, 'closed', 'Cancelled')`, [pB.id])).err ?? ''), 'paid project: account manager cannot close');
    await as(admin);
    const pc = await tryq(`select set_brand_project_status($1, 'closed', 'Cancelled by customer') r`, [pB.id]);
    ok(!pc.err && pc.rows[0].r.warning === 'Payment received; handle the refund separately.', 'paid project: admin closes with the refund warning');
  } else ok(false, 'paid fixture');
  // ── one notification per event ──
  await db.query('reset role');
  ok(Number((await one(`select count(*) n from notifications where dedupe_key = $1`, [`brand_project:${pA.id}:received`])).n) === 1, 'exactly one "received" notification per project');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  ok(!(await db.query(`select 1 from auth.users where email like 'mb-%@example.com'`)).rowCount, 'rolled back — nothing left');
  await db.end();
}
console.log(failed ? `\nbrand admin: ${failed} check(s) failed` : '\nbrand admin: all passed');
process.exitCode = failed ? 1 : 0;
