// Bug fix 6 Nov 2026 — bulk-import "Submit for moderation" (job b1e4cb86… stayed draft while the job said "submitted").
// · a job made only of UPDATE rows submits every product → 'submitted' (the status /office/products reads)
// · the moderation queue count equals the submitted product count
// · re-importing after submit keeps the status (an import never lowers a product)
// · a product that cannot be submitted is reported on its row; the job is NOT marked "submitted"
// · supplier identity unresolved → may enter the queue, still cannot be published
// · every submit writes an audit_log row
// Runs in one transaction that is always rolled back. Optional: MIGRATION=<file.sql> to test before applying.
import { config } from 'dotenv'; import pg from 'pg'; import fs from 'node:fs';
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const one = async (s, p) => (await db.query(s, p)).rows[0];
const before = Number((await one(`select count(*) n from products`)).n);
try {
  await db.query('begin');
  if (process.env.MIGRATION) await db.query(fs.readFileSync(process.env.MIGRATION, 'utf8'));
  const adminId = (await one(`select ur.user_id from user_roles ur join auth.users u on u.id = ur.user_id where ur.role_code = 'admin' order by u.created_at limit 1`)).user_id;
  const okSup = (await one(`select id from suppliers where identity_status = 'ok' and archived_at is null order by code limit 1`)).id;
  const bwj = await one(`select p.id, p.supplier_id from products p where p.sku like 'CN-GD-BWJ-%' and exists (select 1 from price_tiers t where t.product_id = p.id) order by p.sku limit 1`);
  await db.query(`update products set status = 'draft' where id = $1`, [bwj.id]);   // fixture (rolled back)
  // fixture: this supplier's legal name is under review (live Bowijie was resolved on 6 Nov, so don't rely on live state)
  await db.query(`update suppliers set identity_status = 'needs_identity_review' where id = $1`, [bwj.supplier_id]);
  const asAdmin = async () => {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminId, role: 'authenticated', aal: 'aal2' })]);
    await db.query('set local role authenticated');
  };
  const asOwner = () => db.query('reset role');
  // three fresh drafts (created by an earlier import) + one archived product + one Bowijie draft
  const mk = async (sku) => (await one(`select import_product_row($1::jsonb) id`, [JSON.stringify({ mode: 'create', sku, slug: 'qa-sub-' + sku.toLowerCase(), title: 'QA submit ' + sku, supplier_id: okSup, unit: 'pcs', moq: 1, currency: 'USD', tiers: [{ min_qty: 1, unit_price_cents: 100 }] })])).id;
  const a = await mk('QA-SUB-001'), b = await mk('QA-SUB-002'), c = await mk('QA-SUB-003'), arch = await mk('QA-SUB-ARC');
  await db.query(`update products set status = 'archived' where id = $1`, [arch]);
  const job = (await one(`insert into import_jobs(file_name, status, total_rows, valid_rows, created_by) values ('qa.xlsx', 'imported', 4, 4, $1) returning id`, [adminId])).id;
  const addRow = (n, pid) => db.query(`insert into import_rows(job_id, row_no, data, product_id) values ($1, $2, $3, $4)`, [job, n, JSON.stringify({ mode: 'update', title: 'x', tiers: [] }), pid]);
  await addRow(2, a); await addRow(3, b); await addRow(4, c); await addRow(5, bwj.id);

  // 1 · update-only job → all submitted, including the supplier with an unresolved identity
  await asAdmin();
  const r1 = (await one(`select submit_import_job($1) r`, [job])).r;
  await asOwner();
  const st = (await db.query(`select status, count(*)::int n from products where id = any($1) group by 1`, [[a, b, c, bwj.id]])).rows;
  ok(r1.submitted === 4 && r1.failed === 0 && r1.job_status === 'submitted' && st.length === 1 && st[0].status === 'submitted',
    `a job made only of updates submits all 4 products (${JSON.stringify(r1)})`);
  // 2 · queue = what /office/products reads
  const queue = Number((await one(`select count(*) n from products where id = any($1) and status in ('submitted', 'in_review')`, [[a, b, c, bwj.id]])).n);
  ok(queue === r1.submitted, `moderation queue count (${queue}) equals the submitted product count (${r1.submitted})`);
  ok((await one(`select status from import_jobs where id = $1`, [job])).status === 'submitted', 'job shows "submitted" because the products really changed');
  const aud = await one(`select details from audit_log where action = 'import_job.submitted' and entity_id = $1 order by id desc limit 1`, [job]);
  ok(aud?.details?.submitted === 4, 'audit_log row written for the job submit');
  // 3 · re-import after submit keeps the status
  await one(`select import_product_row($1::jsonb)`, [JSON.stringify({ mode: 'update', product_id: a, supplier_id: okSup, title: 'QA submit changed', unit: 'pcs', moq: 2, currency: 'USD', tiers: [{ min_qty: 1, unit_price_cents: 90 }] })]);
  ok((await one(`select status from products where id = $1`, [a])).status === 'submitted', 're-import (update) after submit keeps status submitted');
  const def = (await one(`select pg_get_functiondef('commit_import_run(uuid,uuid,text)'::regprocedure) d`)).d;
  ok(!def.includes(`listing_status = coalesce(v->>'listing_status', listing_status)`), 'Bowijie workbook update no longer overwrites Platform status (applies to new rows only)');
  // 4 · submitting again: nothing changes, still reported honestly
  await asAdmin();
  const r2 = (await one(`select submit_import_job($1) r`, [job])).r;
  await asOwner();
  ok(r2.submitted === 0 && r2.already_in_moderation === 4 && r2.job_status === 'submitted', 'a second submit changes nothing and says so (already in moderation)');
  // 5 · a product that cannot be submitted → row reason, job not "submitted"
  const job2 = (await one(`insert into import_jobs(file_name, status, total_rows, valid_rows, created_by) values ('qa2.xlsx', 'imported', 2, 2, $1) returning id`, [adminId])).id;
  const d2 = await mk('QA-SUB-004');
  await db.query(`insert into import_rows(job_id, row_no, data, product_id) values ($1, 2, '{}', $2), ($1, 3, '{}', $3)`, [job2, d2, arch]);
  await asAdmin();
  const r3 = (await one(`select submit_import_job($1) r`, [job2])).r;
  await asOwner();
  const rowErr = (await one(`select submit_error from import_rows where job_id = $1 and row_no = 3`, [job2])).submit_error;
  ok(r3.submitted === 1 && r3.failed === 1 && r3.job_status === 'partially_submitted' && /archived — only draft or rejected/.test(rowErr ?? ''),
    `unsubmittable product reported on its row ("${rowErr}"), job = ${r3.job_status}`);
  const job3 = (await one(`insert into import_jobs(file_name, status, created_by) values ('qa3.xlsx', 'imported', $1) returning id`, [adminId])).id;
  await db.query(`insert into import_rows(job_id, row_no, data, product_id) values ($1, 2, '{}', $2)`, [job3, arch]);
  await asAdmin();
  const r4 = (await one(`select submit_import_job($1) r`, [job3])).r;
  await asOwner();
  ok(r4.job_status === 'submit_failed', 'a job where nothing could be submitted is "submit_failed", never "submitted"');
  // 5b · ADDON-27 import run (no import job): submit_import_run submits every product of the run, reasons per Product Id
  const run = await one(`select id, (select count(distinct s->>'external_id') from jsonb_array_elements(staging->'products') s) n from import_runs where status = 'committed' order by committed_at limit 1`);
  if (run) {
    const runSkus = (await db.query(`select distinct s->>'external_id' sku from import_runs ru, jsonb_array_elements(ru.staging->'products') s where ru.id = $1`, [run.id])).rows.map((x) => x.sku);
    await db.query(`update products set status = 'archived' where sku = $1`, [runSkus[0]]);   // one product that cannot be submitted
    await asAdmin();
    const rr = (await one(`select submit_import_run($1) r`, [run.id])).r;
    await asOwner();
    const inQueue = Number((await one(`select count(*) n from products where sku = any($1) and status in ('submitted', 'in_review', 'live', 'paused')`, [runSkus])).n);
    const reasons = Object.entries(rr.results).filter(([, v]) => !['submitted', 'already'].includes(v));
    ok(rr.total === Number(run.n) && /archived/.test(rr.results[runSkus[0]]) && inQueue === rr.submitted + rr.already_in_moderation
       && reasons.every(([, v]) => v && !/^[A-Z_]+:/.test(v)) && rr.status !== 'submitted',
      `import run submit: ${rr.submitted} submitted + ${rr.already_in_moderation} already = ${inQueue} in the queue; ${reasons.length} reported with plain reasons (e.g. "${rr.results[runSkus[0]]}")`);
    const ra = await one(`select details from audit_log where action = 'import_run.submitted' and entity_id = $1 order by id desc limit 1`, [run.id]);
    ok(ra?.details?.total === Number(run.n), 'audit_log row written for the run submit');
  }
  // 5c · submit requirements (every route): no buyer price, needs_quote, in_development → reason on the row; withdraw is audited
  const np = await mk('QA-SUB-NOPRICE'); await db.query(`delete from price_tiers where product_id = $1`, [np]);
  const nq = await mk('QA-SUB-NQ'); await db.query(`update products set listing_status = 'needs_quote' where id = $1`, [nq]);
  const dev = await mk('QA-SUB-DEV'); await db.query(`update products set listing_status = 'in_development' where id = $1`, [dev]);
  const job4 = (await one(`insert into import_jobs(file_name, status, created_by) values ('qa4.xlsx', 'imported', $1) returning id`, [adminId])).id;
  await db.query(`insert into import_rows(job_id, row_no, data, product_id) values ($1, 2, '{}', $2), ($1, 3, '{}', $3), ($1, 4, '{}', $4)`, [job4, np, nq, dev]);
  await asAdmin();
  const r5 = (await one(`select submit_import_job($1) r`, [job4])).r;
  const single = await db.query('savepoint sf').then(() => db.query(`select transition_product($1, 'submitted')`, [np])).then(() => 'submitted', (e) => e.message);
  await db.query('rollback to savepoint sf');
  await asOwner();
  const reasons = (await db.query(`select row_no, submit_error from import_rows where job_id = $1 order by row_no`, [job4])).rows.map((x) => x.submit_error);
  ok(r5.submitted === 0 && r5.failed === 3 && r5.job_status === 'submit_failed'
     && /no buyer price/.test(reasons[0]) && /not quoted/.test(reasons[1]) && /in development/.test(reasons[2]),
    `unpriced / needs-quote / in-development products are refused with a reason on each row (${reasons.join(' · ')})`);
  ok(/SUBMIT_BLOCKED.*no buyer price/.test(single), 'the single-form route (transition_product) is refused too');
  await asAdmin();
  const w = (await one(`select withdraw_from_moderation($1, 'qa') w`, [a])).w;
  await asOwner();
  const wa = await one(`select status, (select count(*) from audit_log where action = 'product.withdrawn_from_moderation' and entity_id = $1::uuid::text) n from products where id = $1::uuid`, [a]);
  ok(w === 'withdrawn' && wa.status === 'draft' && Number(wa.n) === 1, 'withdraw from moderation → draft, one audit row');
  // 6 · identity unresolved: in the queue, but publishing is still blocked
  await asAdmin();
  const pub = await db.query('savepoint p').then(() => db.query(`select transition_product($1, 'live')`, [bwj.id])).then(() => 'published', (e) => e.message);
  await db.query('rollback to savepoint p');
  await asOwner();
  ok(/IMPORT_PUBLISH_BLOCKED.*legal-name/.test(pub), 'Bowijie product (identity under review) still cannot be published');
  ok(/legal-name/.test((await one(`select product_publish_blocker($1) b`, [bwj.id])).b ?? ''), 'moderators see the publish blocker');
} catch (e) {
  ok(false, 'unexpected: ' + e.message);
} finally {
  await db.query('rollback');
  const after = Number((await one(`select count(*) n from products`)).n);
  ok(after === before, `rolled back — nothing persisted (${before} products)`);
  await db.end();
  console.log(failed ? `\nimport submit: ${failed} check(s) failed` : '\nimport submit: all passed');
  process.exitCode = failed ? 1 : 0;
}
