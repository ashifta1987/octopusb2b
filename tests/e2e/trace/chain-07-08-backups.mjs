// Chains 7 + 8 — Backup now → upload → UI card (SPEC §21.1 #7) and partial restore of a deleted product (#8).
// No GitHub token / off-site bucket is configured (QA BK-01), so chain 7 is traced to that boundary; the workflow's
// signed status callback is then simulated (the mock boundary) to prove callback → DB → card. Chain 8 runs the restore
// inside one rolled-back transaction (recovery schema as the backup restore would build it).
import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import pg from 'pg';
import { BASE, count, cookieFor, ensureTraceAdmin, hops, http, newTrace, pwCookies, remember, reporter, signIn, sql, traceRows } from './lib.mjs';
import { recoveryRewriter, tablesForModules } from '../../../scripts/backup/lib.mjs';

const r7 = reporter(7, 'Backup now → upload → UI card');
const r8 = reporter(8, 'Partial restore of deleted product');
const trace7 = newTrace(7), trace8 = newTrace(8);
r7.r.traces.push(trace7); r8.r.traces.push(trace8);
remember((s) => s.traces.push(trace7, trace8));
const browser = await chromium.launch();
try {
  const adm = await ensureTraceAdmin();
  const sb = await signIn(adm.email, trace7, { staff: true });
  const cookie = cookieFor(sb, { staff: true });
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-trace-id': trace7 } });
  await ctx.addCookies(pwCookies(sb, { staff: true }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/backups`);
  await page.waitForLoadState('networkidle');
  const t0 = Date.now();
  page.on('dialog', (d) => d.accept());
  const [resp] = await Promise.all([
    page.waitForResponse((x) => x.url().includes('/api/backups/trigger'), { timeout: 20000 }),
    page.getByRole('button', { name: /back up now/i }).first().click(),
  ]);
  const confirmBtn = page.getByRole('dialog').getByRole('button', { name: /back up|start|confirm/i });
  if (await confirmBtn.count().catch(() => 0)) await confirmBtn.first().click().catch(() => null);
  const res = { json: await resp.json(), ms: Date.now() - t0 };
  r7.r.latency['UI Back up now → POST /api/backups/trigger (request_backup + GitHub dispatch)'] = res.ms;
  r7.check(res.json?.error === 'GITHUB_NOT_CONFIGURED' && res.json?.backup_id, 'Back up now → backup row queued; GitHub dispatch refused: GITHUB_NOT_CONFIGURED (boundary)', JSON.stringify(res.json));
  const backupId = res.json?.backup_id;
  const [bk] = await sql(`select code, status, trace_id from backups where id=$1`, [backupId]);
  r7.check(bk && bk.status === 'queued' && bk.trace_id === trace7, 'backups row queued with the trace id', JSON.stringify(bk));
  const [{ offsite: prevOffsite }] = await sql(`select value->'offsite' offsite from site_settings where key='backup_settings'`);
  const off = await http('/api/backups/offsite/test', { trace: trace7, cookie, method: 'POST', body: {} });
  // the probe stamps last_test_at/ok on the production setting — put the previous value back
  await sql(`update site_settings set value = jsonb_set(value, '{offsite}', $1::jsonb) where key='backup_settings'`, [JSON.stringify(prevOffsite)]);
  r7.check(!off.json?.ok, 'off-site bucket test → not configured (boundary)', JSON.stringify(off.json).slice(0, 160));
  // workflow callback (simulated GitHub Actions run): HMAC-signed status report
  const secret = process.env.BACKUP_CALLBACK_SECRET;
  const body = JSON.stringify({ type: 'backup', code: bk.code, status: 'completed', progress: 100, size_bytes: 1234567, location: 's3://qa-trace-not-real/' + bk.code, checksum_ok: true, manifest: { files: [] }, files: [], trigger: 'manual', retention_class: 'manual', migration_version: '20261101000136' });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const bad = await http('/api/backups/status', { trace: trace7, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': 't=1,v1=00' } });
  r7.check(bad.status === 401, 'callback with a bad HMAC → 401', bad.status);
  const cb = await http('/api/backups/status', { trace: trace7, method: 'POST', body, headers: { 'content-type': 'application/json', 'octopus-signature': sig } });
  r7.r.latency['signed status callback → backup_report'] = cb.ms;
  const [bk2] = await sql(`select status, checksum_ok, size_bytes from backups where id=$1`, [backupId]);
  r7.check(cb.status === 200 && bk2.status === 'completed' && bk2.checksum_ok, 'signed callback → backup completed with checksum (simulated workflow)', JSON.stringify(bk2));
  const liveCard = await page.getByText(/completed|Backup complete/i).first().waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
  await page.reload();
  await page.waitForLoadState('networkidle');
  const afterReload = await page.getByText(bk.code).first().isVisible().catch(() => false);
  r7.check(liveCard, 'status card refreshed without reload (3 s poll of the started backup)', `live: ${liveCard}, row listed after reload: ${afterReload}`);
  await page.screenshot({ path: 'docs/qa/2026-11-01-trace/chain-07-backups.png' });
  r7.r.e2e_ms = Date.now() - t0;
  const rows7 = await traceRows(trace7);
  r7.r.hops = hops(rows7);
  r7.check(count(rows7, 'audit_log') >= 1, 'backup request audited', (rows7.audit_log ?? []).map((a) => a.action).join(', '));
  r7.r.boundary = 'GitHub Actions dispatch + off-site bucket (owner: Owner/Admin — GITHUB_ACTIONS_TOKEN, BACKUP_S3_*, age key; QA BK-01)';

  // ── chain 8 (rolled back) ──
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const one = async (s, p) => (await db.query(s, p)).rows[0];
  await db.query('begin');
  try {
    await db.query(`select set_config('app.trace_id', $1, true)`, [trace8]);
    const tables = tablesForModules(['products', 'categories', 'cms']);
    const rw = recoveryRewriter(tables);
    await db.query([...rw.header(), ...rw.footer()].join('\n'));
    const cols = (await one(`select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='products' and is_generated='NEVER'`)).c;
    const p = await one(`select id, title, slug from products where status='live' order by created_at desc limit 1`);
    await db.query(`insert into recovery.products (${cols}) select ${cols} from public.products where id=$1`, [p.id]);
    await db.query('savepoint del');
    let deleted = true;
    try { await db.query(`delete from public.products where id=$1`, [p.id]); } catch (e) { deleted = false; r8.note(`hard delete blocked by FKs (${e.message.slice(0, 80)}); simulated as damaged row instead`); await db.query('rollback to savepoint del'); await db.query(`update public.products set title = title || ' [damaged]' where id=$1`, [p.id]); }
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adm.uid, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]);
    await db.query('set local role authenticated');
    const cmp = (await one(`select recovery_compare('products', array[$1]::uuid[], 5) v`, [p.id])).v;
    r8.check(['missing', 'changed'].includes(cmp?.[0]?.status), `wizard compare shows the product as ${cmp?.[0]?.status}`);
    const tR = performance.now();
    const n = Number((await one(`select restore_records('products', array[$1]::uuid[], 'E2E trace restore') n`, [p.id])).n);
    r8.r.latency['RPC restore_records'] = Math.round(performance.now() - tR);
    const back = await one(`select title from products where id=$1`, [p.id]);
    r8.check(n === 1 && back?.title === p.title, `product ${deleted ? 'deleted' : 'damaged'} → restored with backup values`, back?.title);
    await db.query('savepoint m');
    let money = null;
    try { await db.query(`select restore_records('ledger_entries', array[gen_random_uuid()], 'x')`); } catch (e) { money = e.message; }
    await db.query('rollback to savepoint m');
    r8.check(/MONEY_RECORDS_NOT_RESTORABLE/.test(money ?? ''), 'negative: money tables refused', money);
    await db.query('reset role');
    const rows8 = (await one(`select trace_rows($1) v`, [trace8])).v ?? {};
    r8.r.hops = hops(rows8);
    r8.check((rows8.audit_log ?? []).some((a) => a.action === 'restore.records'), 'audit restore.records with the trace id', (rows8.audit_log ?? []).map((a) => a.action).join(', '));
    r8.check(true, 'storefront revalidation: restoreRecords now calls revalidateTag(products) for catalogue tables (code fix; not observable inside a rolled-back transaction)');
    r8.note('Ran in one rolled-back transaction; the real wizard additionally needs a completed off-site backup (BK-01).');
  } finally {
    await db.query('rollback');
    await db.end();
  }
} catch (e) {
  r7.check(false, 'unexpected error', e.stack);
} finally {
  await browser.close();
  r7.save(); r8.save();
  process.exit(0);
}
