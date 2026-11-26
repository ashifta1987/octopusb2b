// Turnkey T4 DB checks — migration *_t4_turnkey_drawings_quotes. STAGING ONLY, one rolled-back transaction, acting as
// customers / staff through JWT claims (what PostgREST does).
//  1. Structure: RLS, no write grants, definer functions with search_path=public, internal helpers not callable,
//     customer-readable columns don't look internal (customer-columns INTERNAL_NAME), staff-only tables, private bucket.
//  2. Drawings: storage policies (editor uploads into <project>/ in Design; client reads registered files only), versions
//     1-3 free, changes on v3 → v4 is an extra version at 50% of the active drawing fee with a proforma, upload refused
//     until fully paid, admin waiver with a reason voids the proforma, approval completes Design (gate).
//  3. Quotes: factory quotes and costs never visible to customers (rows and columns), white-label guard, sending needs
//     the deposit setting (DEPOSIT_NOT_SET), deposit frozen on send, acceptance issues the deposit proforma (TK division),
//     Quote and deposit completes only with an accepted quote whose deposit is fully paid; the T3 fee gate still applies.
//  4. Audit on every change; client history never names a factory; ledger balanced; down → up.
// Run: node supabase/tests/turnkey-t4.test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, override: true });
if (process.env.APP_ENVIRONMENT !== 'staging' || !process.env.DATABASE_URL) {
  console.error('✘ refused: needs .env.staging with APP_ENVIRONMENT=staging');
  process.exit(1);
}
const MIG = fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_t4_turnkey_drawings_quotes.sql'));
if (!MIG) { console.error('✘ T4 migration file not found'); process.exit(1); }
const UP = fs.readFileSync(`supabase/migrations/${MIG}`, 'utf8');
const DOWN = fs.readFileSync(`supabase/migrations/down/${MIG.replace(/\.sql$/, '.down.sql')}`, 'utf8');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const all = async (q, p) => (await db.query(q, p)).rows;
const owner = async () => { await db.query('reset role'); await db.query(`select set_config('request.jwt.claims', '', true)`); };
const as = async (uid, aal = 'aal2', role = 'authenticated') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role, aal } : { role })]);
  await db.query(`set local role ${role}`);
};
const tryq = async (q, p) => {
  await db.query('savepoint sp');
  try { const r = await db.query(q, p); await db.query('release savepoint sp'); return { err: null, rows: r.rows }; }
  catch (e) { await db.query('rollback to savepoint sp'); return { err: e.message, rows: [] }; }
};
const err = async (q, p) => (await tryq(q, p)).err ?? '';
const INTERNAL_NAME = /supplier|cost|margin|markup|contact|note|_raw$|created_by|assigned|reviewer|confirmed_by|set_by|updated_by|invited_by|matched_by|trace_id|is_seed|hold_reason|rejection|sha256|storage_path|source_file|secret|key_hash|factory_model|internal/;
const PLAN = 'A 150 m² gym in Izmir, opening next spring.';
const SUPPLIER = 'Foshan Gymtech T4';

try {
  await db.query('begin');
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let refN = 0;
  const mkUser = async (tag, role = null) => {
    const email = `tk4-${tag}-${stamp}@test.local`;
    const id = (await one(`insert into auth.users(id, email, aud, role, instance_id, email_confirmed_at) values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now()) returning id`, [email])).id;
    await db.query(`insert into profiles(id, full_name, email) values ($1, $2, $3) on conflict (id) do update set full_name = excluded.full_name`, [id, `TK4 ${tag}`, email]);
    if (role) await db.query(`insert into user_roles(user_id, role_code) values ($1, $2)`, [id, role]);
    return id;
  };
  const mkOrg = async (name, uid) => {
    const id = (await one(`insert into organizations(name, country) values ($1, 'TR') returning id`, [name])).id;
    await db.query(`insert into org_members(org_id, user_id, member_role) values ($1, $2, 'owner')`, [id, uid]);
    return id;
  };
  const admin1 = await mkUser('admin1', 'admin');
  const agent = await mkUser('agent', 'sourcing_agent');
  const am = await mkUser('am', 'account_manager');
  const cust = await mkUser('cust');
  const custB = await mkUser('custb');
  const orgA = await mkOrg('TK4 Client A', cust);
  await mkOrg('TK4 Client B', custB);
  await db.query(`insert into division_members(user_id, division_id, role) values ($1, division_id_of('TK'), 'staff')`, [agent]);
  await as(cust, 'aal1');
  const p1 = (await one(`select tk_submit_enquiry($1, null, 'TK4 gym', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  const p2 = (await one(`select tk_submit_enquiry($1, null, 'TK4 laundry', 'TR', null, null, null, null, $2) r`, [orgA, PLAN])).r;
  await owner();
  await db.query(`delete from site_settings where key = 'turnkey.deposit_pct'`); // the design gives no value: start unset (rolled back)

  const pay = async (doc, cents) => { await owner(); return (await one(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null) r`, [doc, cents, `TK4-${stamp}-${++refN}`])).r; };
  const feeAndMove = async (pid, stage, service, cents) => {
    await as(agent);
    const f = (await one(`select tk_propose_fee($1, $2, $3, $4, null) r`, [pid, stage, service, cents])).r;
    await pay(f.document_id, cents);
    await as(agent);
    await db.query(`select tk_move_project_stage($1, $2, null)`, [pid, stage]);
    return f;
  };
  const putFile = async (name, mime = 'application/pdf', size = 2048) => {
    await owner();
    await db.query(`insert into storage.objects (bucket_id, name, metadata) select 'turnkey-drawings', $1, $2::jsonb where not exists (select 1 from storage.objects where bucket_id = 'turnkey-drawings' and name = $1)`, [name, JSON.stringify({ mimetype: mime, size })]);
  };

  // ── 1. structure ──
  await db.query(UP); // re-runnable
  const T = ['tk_drawing_versions', 'tk_drawing_comments', 'tk_drawing_extra_fees', 'tk_factory_quotes', 'tk_factory_quote_lines', 'tk_client_quotes', 'tk_client_quote_lines', 'tk_client_quote_line_costs'];
  const rls = await all(`select relname from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace and relrowsecurity`, [T]);
  ok(rls.length === T.length, `T4: RLS on all ${T.length} new tables (up is re-runnable)`);
  const writes = await all(`select t from unnest($1::text[]) t where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('anon', 'public.' || t, 'SELECT')`, [T]);
  ok(writes.length === 0, `T4: no write grants, nothing for anon (${writes.map((w) => w.t).join(',') || 'none'})`);
  const fns = await all(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'EXECUTE') anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tk\\\\_%' and p.proname <> 'tk_import_catalogue'`);
  ok(fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg) && !f.anon), `T4: all ${fns.length} tk_ functions are security definer, search_path=public, not for anon`);
  const internal = await all(`select x, has_function_privilege('authenticated', x, 'EXECUTE') e from unnest(array['public.tk_issue_project_proforma(uuid,text,text,text,bigint)', 'public.tk_names_supplier(uuid,text)', 'public.tk_t4_history_guard()']) x`);
  ok(internal.every((r) => !r.e), 'T4: internal helpers not callable by users');
  const CLIENT = ['tk_drawing_versions', 'tk_drawing_comments', 'tk_drawing_extra_fees', 'tk_client_quotes', 'tk_client_quote_lines'];
  const ccols = await all(`select table_name t, column_name c from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated' and privilege_type = 'SELECT'`, [CLIENT]);
  const badCols = ccols.filter((r) => INTERNAL_NAME.test(r.c) || /uploaded_by|author_id|waive|sent_by|base_fee/.test(r.c));
  ok(badCols.length === 0, `T4: customer-readable columns are customer-safe (${ccols.length}${badCols.length ? '; BAD ' + badCols.map((b) => `${b.t}.${b.c}`).join(',') : ''})`);
  const bucket = await one(`select public, file_size_limit::bigint l from storage.buckets where id = 'turnkey-drawings'`);
  ok(bucket && bucket.public === false && Number(bucket.l) === 20971520, 'T4: private bucket turnkey-drawings (20 MB)');
  const spol = (await all(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'turnkey drawings%'`)).map((r) => r.policyname).sort().join('|');
  ok(spol === 'turnkey drawings read|turnkey drawings remove unregistered|turnkey drawings staff upload', `T4: storage policies (${spol})`);

  // ── 2. drawings ──
  await feeAndMove(p1.id, 'consultation', 'consultation', 9900);
  const dfee = await feeAndMove(p1.id, 'design', 'layout_drawing', 29900);
  await as(agent);
  ok((await tryq(`select public.tk_drawing_can_upload($1)`, [String(p1.id)])).rows[0]?.tk_drawing_can_upload === true, 'storage: the editor may upload into the project folder (Design)');
  ok((await one(`select public.tk_drawing_can_upload($1) x`, [String(p2.id)])).x === false, 'storage: not for a project outside Design');
  await as(cust, 'aal1');
  ok((await one(`select public.tk_drawing_can_upload($1) x`, [String(p1.id)])).x === false, 'storage: the client cannot upload');
  await putFile(`${p1.id}/v1.pdf`);
  await as(cust, 'aal1');
  ok((await one(`select public.tk_drawing_file_visible($1) x`, [`${p1.id}/v1.pdf`])).x === false, 'storage: the client cannot read an unregistered file');
  ok(/FORBIDDEN/.test(await err(`select tk_add_drawing_version($1, $2, 'v1.pdf', null)`, [p1.id, `${p1.id}/v1.pdf`])), 'drawing: customer cannot register');
  await as(agent, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_add_drawing_version($1, $2, 'v1.pdf', null)`, [p1.id, `${p1.id}/v1.pdf`])), 'drawing: staff without 2FA refused');
  await as(agent);
  ok(/FILE_NOT_UPLOADED/.test(await err(`select tk_add_drawing_version($1, $2, 'x.pdf', null)`, [p1.id, `${p1.id}/missing.pdf`])), 'drawing: the file must be in the bucket');
  await putFile(`${p1.id}/bad.exe`, 'application/x-msdownload');
  await as(agent);
  ok(/INVALID_FILE_TYPE/.test(await err(`select tk_add_drawing_version($1, $2, 'bad.exe', null)`, [p1.id, `${p1.id}/bad.exe`])), 'drawing: only PDF / images (type from storage)');
  const v1 = (await one(`select tk_add_drawing_version($1, $2, 'Layout v1.pdf', 'First layout') r`, [p1.id, `${p1.id}/v1.pdf`])).r;
  ok(v1.version === 1, 'drawing: version 1 shared');
  await as(cust, 'aal1');
  ok((await one(`select public.tk_drawing_file_visible($1) x`, [`${p1.id}/v1.pdf`])).x === true, 'storage: the client reads the registered file (signed link)');
  ok((await all(`select id from tk_drawing_versions where project_id = $1`, [p1.id])).length === 1 && /permission denied/.test(await err(`select uploaded_by from tk_drawing_versions`)),
    'client: sees the version, not the uploader');
  await as(custB, 'aal1');
  ok((await all(`select id from tk_drawing_versions where project_id = $1`, [p1.id])).length === 0 && (await one(`select public.tk_drawing_file_visible($1) x`, [`${p1.id}/v1.pdf`])).x === false,
    'other customer: no version, no file');
  await as(cust, 'aal1');
  ok(!(await tryq(`select tk_comment_drawing($1, 'Can the reception be wider?')`, [v1.id])).err, 'client: comments');
  ok(/REASON_REQUIRED/.test(await err(`select tk_decide_drawing($1, 'changes', ' ')`, [v1.id])), 'client: changes need a reason');
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select tk_decide_drawing($1, 'approve', null)`, [v1.id])), 'staff cannot approve for the client');

  const askChanges = async (n) => {
    const vid = (await one(`select id from tk_drawing_versions where project_id = $1 and version = $2`, [p1.id, n])).id;
    await as(cust, 'aal1');
    return (await one(`select tk_decide_drawing($1, 'changes', 'Change version ' || $2::text) r`, [vid, n])).r;
  };
  const upload = async (n) => { await putFile(`${p1.id}/v${n}.pdf`); await as(agent); return tryq(`select tk_add_drawing_version($1, $2, $3, null) r`, [p1.id, `${p1.id}/v${n}.pdf`, `v${n}.pdf`]); };
  ok(!(await askChanges(1)).extra_fee_id && !(await upload(2)).err, 'free versions: v2 free');
  ok(!(await askChanges(2)).extra_fee_id && !(await upload(3)).err, 'free versions: v3 free (3 of 3)');
  const c3 = await askChanges(3);
  ok(!!c3.extra_fee_id && Number(c3.amount_cents) === 14950, `extra: changes on v3 → v4 costs 50% of the US$ 299 drawing fee (${c3.amount_cents} cents)`);
  await owner();
  const x4 = await one(`select e.for_version, e.base_fee_id, e.document_id, d.status, d.amount_cents::bigint a, d.org_id, d.data ->> 'service' svc, d.data ->> 'ref_type' rt, d.division_id = division_id_of('TK') tk
    from tk_drawing_extra_fees e join documents d on d.id = e.document_id where e.id = $1`, [c3.extra_fee_id]);
  ok(x4.for_version === 4 && x4.base_fee_id === dfee.id && Number(x4.a) === 14950 && x4.status === 'awaiting_payment' && x4.org_id === orgA && x4.svc === 'turnkey' && x4.rt === 'tk_drawing_version' && x4.tk,
    'extra: proforma for the client company (turnkey, TK division), awaiting payment, based on the active drawing fee');
  ok(/EXTRA_VERSION_NOT_PAID/.test((await upload(4)).err ?? ''), 'extra: v4 upload refused (gate) until paid');
  await pay(x4.document_id, 7000);
  ok(/EXTRA_VERSION_NOT_PAID/.test((await upload(4)).err ?? ''), 'extra: part paid is not enough');
  await pay(x4.document_id, 7950);
  ok(!(await upload(4)).err, 'extra: v4 uploaded after full payment');
  const c4 = await askChanges(4);
  await as(agent);
  ok(/FORBIDDEN/.test(await err(`select tk_waive_drawing_fee($1, 'goodwill')`, [c4.extra_fee_id])), 'waive: Turnkey editor (not admin) refused');
  await as(admin1);
  ok(/REASON_REQUIRED/.test(await err(`select tk_waive_drawing_fee($1, ' ')`, [c4.extra_fee_id])), 'waive: a reason is required');
  ok(!(await tryq(`select tk_waive_drawing_fee($1, 'Our mistake in v4')`, [c4.extra_fee_id])).err, 'waive: admin waives with a reason');
  await owner();
  ok((await one(`select d.status from tk_drawing_extra_fees e join documents d on d.id = e.document_id where e.id = $1`, [c4.extra_fee_id])).status === 'void', 'waive: the proforma is voided');
  ok(!(await upload(5)).err, 'waive: v5 uploaded');
  await as(cust, 'aal1');
  ok(/permission denied/.test(await err(`select waive_reason from tk_drawing_extra_fees`)), 'client: the waiver reason is staff-only');
  await as(agent);
  ok(/DRAWING_NOT_APPROVED/.test(await err(`select tk_move_project_stage($1, 'sourcing', null)`, [p1.id])), 'gate: Design does not complete before an approved version');
  const v5 = (await one(`select id from tk_drawing_versions where project_id = $1 and version = 5`, [p1.id])).id;
  await as(cust, 'aal1');
  ok((await one(`select tk_decide_drawing($1, 'approve', 'Looks great') r`, [v5])).r.status === 'approved', 'client approves v5');
  ok(/DRAWING_APPROVED/.test((await upload(6)).err ?? ''), 'no new version after approval');
  await owner();
  ok(/TK_HISTORY_KEPT/.test(await err(`delete from tk_drawing_versions where id = $1`, [v5])) && /TK_HISTORY_KEPT/.test(await err(`update tk_drawing_versions set file_name = 'x' where id = $1`, [v5])),
    'DB: versions never deleted or rewritten');
  await feeAndMove(p1.id, 'sourcing', 'sourcing_quotes', 19900);
  await owner();
  ok((await one(`select stage from tk_client_projects where id = $1`, [p1.id])).stage === 'sourcing', 'gate: approved drawing + paid sourcing fee → Sourcing');

  // ── 3. quotes ──
  await as(agent);
  const fq = (await one(`select tk_add_factory_quote($1, $2, 'FG-881', null, 'cheapest of three', $3::jsonb) r`, [p1.id, SUPPLIER,
    JSON.stringify([{ description: 'Treadmill T9', qty: 4, unit_cost_cents: 120000 }, { description: 'Rack set', qty: 2, unit_cost_cents: 45000 }])])).r;
  await owner();
  const fls = await all(`select id from tk_factory_quote_lines where factory_quote_id = $1 order by line_no`, [fq]);
  await as(cust, 'aal1');
  ok((await all(`select * from tk_factory_quotes`)).length === 0 && (await all(`select * from tk_factory_quote_lines`)).length === 0 && (await all(`select * from tk_client_quote_line_costs`)).length === 0,
    'client: no rows from factory quotes, cost lines or line costs (RLS)');
  await as(am);
  ok(/FORBIDDEN/.test(await err(`select tk_add_factory_quote($1, 'X', null, null, null, '[{"description":"a","qty":1,"unit_cost_cents":1}]'::jsonb)`, [p1.id])), 'factory quote: view-only staff refused');
  await as(agent);
  ok(/SUPPLIER_NAME_SHOWN/.test(await err(`select tk_save_client_quote($1, null, null, $2::jsonb)`, [p1.id, JSON.stringify([{ description: `Treadmill by ${SUPPLIER.toUpperCase()}`, qty: 1, unit_price_cents: 100 }])])),
    'white-label: a client line naming the factory is refused');
  const lines1 = [{ description: 'Commercial treadmill', qty: 4, unit_price_cents: 160000, factory_line_id: fls[0].id }, { description: 'Power rack set', qty: 2, unit_price_cents: 60000 }];
  const d1 = (await one(`select tk_save_client_quote($1, 'Delivered to Izmir', null, $2::jsonb) r`, [p1.id, JSON.stringify(lines1)])).r;
  await as(cust, 'aal1');
  ok((await all(`select id from tk_client_quotes where project_id = $1`, [p1.id])).length === 0, 'client: drafts are not visible');
  await as(agent);
  ok(/DEPOSIT_NOT_SET/.test(await err(`select tk_send_client_quote($1)`, [d1.id])), 'deposit: no quote can be sent (so none accepted) until the deposit % is set');
  ok(/FORBIDDEN/.test(await err(`select tk_set_deposit_pct(30)`)), 'deposit setting: non-admin refused');
  await as(admin1, 'aal1');
  ok(/FORBIDDEN/.test(await err(`select tk_set_deposit_pct(30)`)), 'deposit setting: admin without 2FA refused');
  await as(admin1);
  ok(/INVALID_DEPOSIT/.test(await err(`select tk_set_deposit_pct(101)`)) && !(await tryq(`select tk_set_deposit_pct(30)`)).err, 'deposit setting: 1..100; admin sets 30%');
  await as(agent);
  const s1 = (await one(`select tk_send_client_quote($1) r`, [d1.id])).r;
  ok(s1.deposit_pct === 30 && Number(s1.deposit_cents) === 228000, 'quote: sent; deposit 30% of US$ 7,600 frozen (US$ 2,280.00)');
  const sq1 = (await one(`select tk_staff_quotes($1) r`, [p1.id])).r.quotes.find((x) => x.id === d1.id);
  ok(Number(sq1.cost_cents) === 480000 && sq1.cost_complete === false && sq1.lines[0].supplier_name === SUPPLIER, 'staff: cost, source factory and "cost incomplete" (margin unknown, never 0)');
  await as(cust, 'aal1');
  const cl = await all(`select description, qty, unit_price_cents, total_cents from tk_client_quote_lines where quote_id = $1`, [d1.id]);
  ok(cl.length === 2 && !JSON.stringify(cl).includes(SUPPLIER), 'client: sees the sent quote lines, no factory');
  ok(/permission denied/.test(await err(`select created_by from tk_client_quotes`)) && /permission denied/.test(await err(`select sent_by from tk_client_quotes`)), 'client: creator / sender columns not readable');
  ok(/FORBIDDEN/.test(await err(`select tk_staff_quotes($1)`, [p1.id])) && /FORBIDDEN/.test(await err(`select tk_staff_drawings($1)`, [p1.id])), 'client: staff views refused');
  await as(custB, 'aal1');
  ok((await all(`select id from tk_client_quotes where project_id = $1`, [p1.id])).length === 0, 'other customer: no quote');
  await as(cust, 'aal1');
  ok(!(await tryq(`select tk_decide_client_quote($1, 'changes', 'Lower the treadmill price, please')`, [d1.id])).err, 'client: asks for changes');
  await as(agent);
  const lines2 = [{ description: 'Commercial treadmill', qty: 4, unit_price_cents: 150000, factory_line_id: fls[0].id }, { description: 'Power rack set', qty: 2, unit_price_cents: 60000, unit_cost_cents: 45000 }];
  const d2 = (await one(`select tk_save_client_quote($1, null, current_date + 30, $2::jsonb) r`, [p1.id, JSON.stringify(lines2)])).r;
  await db.query(`select tk_send_client_quote($1)`, [d2.id]);
  const sq2 = (await one(`select tk_staff_quotes($1) r`, [p1.id])).r.quotes.find((x) => x.id === d2.id);
  ok(sq2.cost_complete === true && Number(sq2.total_cents) - Number(sq2.cost_cents) === 150000, 'staff: margin = total − cost (US$ 1,500.00)');
  await owner();
  ok(/QUOTE_SENT/.test(await err(`insert into tk_client_quote_lines (quote_id, project_id, line_no, description, qty, unit_price_cents, total_cents) values ($1, $2, 9, 'x', 1, 1, 1)`, [d2.id, p1.id]))
    && /TK_HISTORY_KEPT/.test(await err(`update tk_client_quotes set total_cents = 1 where id = $1`, [d2.id])), 'DB: a sent quote and its lines cannot be changed');
  await as(agent);
  await db.query(`select tk_move_project_stage($1, 'quote_deposit', null)`, [p1.id]);
  ok(/QUOTE_NOT_ACCEPTED/.test(await err(`select tk_move_project_stage($1, 'production_qc', null)`, [p1.id])), 'gate: Quote and deposit needs an accepted quote');
  await as(cust, 'aal1');
  const acc = (await one(`select tk_decide_client_quote($1, 'accept', null) r`, [d2.id])).r;
  ok(acc.status === 'accepted' && Number(acc.deposit_cents) === 216000, 'client: accepts v2; deposit 30% of US$ 7,200 = US$ 2,160.00');
  await owner();
  const dep = await one(`select d.org_id, d.status, d.amount_cents::bigint a, d.data ->> 'service' svc, d.data ->> 'ref_type' rt, d.division_id = division_id_of('TK') tk,
    (select string_agg(distinct service, ',') from invoice_lines where document_id = d.id) lines from documents d where d.id = $1`, [acc.document_id]);
  ok(dep.org_id === orgA && dep.status === 'awaiting_payment' && Number(dep.a) === 216000 && dep.svc === 'turnkey' && dep.rt === 'tk_client_quote' && dep.tk && dep.lines === 'turnkey',
    'deposit: proforma through the existing path (turnkey, TK division, awaiting payment)');
  await as(agent);
  ok(/DEPOSIT_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'production_qc', null)`, [p1.id])), 'gate: deposit unpaid → refused');
  await pay(acc.document_id, 100000);
  await as(agent);
  ok(/DEPOSIT_NOT_PAID/.test(await err(`select tk_move_project_stage($1, 'production_qc', null)`, [p1.id])), 'gate: deposit part paid → refused');
  const paid = await pay(acc.document_id, 116000);
  ok(paid.fully_paid === true, 'deposit: Finance records the rest by bank transfer (fully paid; tax invoice by the existing rule)');
  await as(agent);
  ok(/FEE_NOT_APPROVED/.test(await err(`select tk_move_project_stage($1, 'production_qc', null)`, [p1.id])), 'gate: deposit paid; the T3 fee gate of Production and QC still applies (T3 not weakened)');
  await feeAndMove(p1.id, 'production_qc', 'factory_audit', 25000);
  await owner();
  ok((await one(`select stage from tk_client_projects where id = $1`, [p1.id])).stage === 'production_qc', 'gate: accepted + deposit paid + audit fee paid → Production and QC');

  // ── 4. audit, history, ledger ──
  const acts = (await all(`select distinct action from audit_log where action like 'turnkey.%' and created_at >= now() - interval '1 hour'`)).map((a) => a.action);
  for (const a of ['turnkey.drawing_uploaded', 'turnkey.drawing_comment', 'turnkey.drawing_changes', 'turnkey.drawing_extra_fee', 'turnkey.drawing_fee_waived', 'turnkey.drawing_approved',
    'turnkey.factory_quote_added', 'turnkey.quote_draft_saved', 'turnkey.quote_sent', 'turnkey.quote_changes', 'turnkey.quote_accepted', 'turnkey.deposit_pct', 'turnkey.fee_proforma_void'])
    ok(acts.includes(a), `audit: ${a}`);
  const evText = (await one(`select string_agg(message, ' ') m, count(*) filter (where kind in ('drawing', 'quote'))::int n from tk_client_project_events where project_id = $1`, [p1.id]));
  ok(evText.n >= 10 && !/foshan|gymtech|cost|margin/i.test(evText.m), 'client history: drawing and quote entries, never a factory, cost or margin');
  const l = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok(l.d === l.c, `ledger balanced (${l.d} = ${l.c})`);
  ok(!(await tryq(`delete from tk_client_projects where id = $1`, [p2.id])).err, 'owner clean-up: deleting a project cascades through the T4 tables');

  // ── down → up (data kept as documented; the schema diff is checked by check-migration-roundtrip) ──
  const { appliedAfter, unwind, reapply } = await import('./lib-later-migrations.mjs');
  const later = await appliedAfter(db, MIG);
  await unwind(db, later);
  const docs = (await one(`select count(*)::int n from documents`)).n;
  await db.query(DOWN);
  const gone = await one(`select to_regclass('public.tk_drawing_versions') a, to_regclass('public.tk_client_quotes') b, to_regprocedure('public.tk_decide_client_quote(uuid,text,text)') c,
    (select prosrc from pg_proc where oid = 'public.tk_move_project_stage(uuid,text,text)'::regprocedure) m,
    (select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'turnkey drawings%') sp`);
  ok(!gone.a && !gone.b && !gone.c && !/DRAWING_NOT_APPROVED/.test(gone.m) && /FEE_NOT_PAID/.test(gone.m) && gone.sp === 0, 'down: T4 tables, functions, storage policies removed; T3 gate function back');
  const l2 = await one(`select coalesce(sum(debit_cents),0)::bigint d, coalesce(sum(credit_cents),0)::bigint c from ledger_entries`);
  ok((await one(`select count(*)::int n from documents`)).n === docs && l2.d === l2.c, 'down: issued proformas and the ledger are kept, still balanced');
  await db.query(UP);
  await reapply(db, later);
  ok(!!(await one(`select to_regclass('public.tk_client_quotes') a`)).a, 'up again after down');
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
console.log(failed ? `\nturnkey-t4: ${failed} check(s) failed` : '\nturnkey-t4: all passed');
process.exitCode = failed ? 1 : 0;
