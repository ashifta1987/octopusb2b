import { getEmail } from '@/lib/adapters';
import { checkCron } from '@/lib/api/cron';
import { json, problem } from '@/lib/api/problem';
import { EXPORT_MODULES } from '@/lib/backup/export-builders';
import { EXPORTS_BUCKET, exportFiles, runExport } from '@/lib/backup/exports';
import { dispatchWorkflow, githubConfigured } from '@/lib/backup/github';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/cron/backup-monitor (Vercel Cron, daily; `Authorization: Bearer ${CRON_SECRET}`) — SPEC §16.4 monitoring:
 *  1. backup_overdue() (no successful backup within alert_missing_hours, default 26 h) → email backup_settings.alert_email,
 *     integration_logs row (integration_code 'backups') and outbox event backup.missing. Failed backups of the last day too.
 *  2. On the 1st (China time) queue the monthly export pack (all modules, xlsx) once per month.
 *  3. Run queued exports (up to 3 per call) and expire old ones (files removed, status 'expired').
 *  4. Fallback for the monthly restore drill: if monthly_drill is on and no drill ran for 35 days, dispatch restore-drill.yml.
 */
export const maxDuration = 300;

type Sb = ReturnType<typeof createAdminClient>;

function shanghaiDate(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day };
}

export async function GET(req: Request) {
  const denied = checkCron(req);
  if (denied) return denied;
  const sb = createAdminClient();
  const started = Date.now();
  const out: Record<string, unknown> = {};
  try {
    const { data: s } = await sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
    const settings = (s?.value ?? {}) as Record<string, unknown>;
    const alertTo = (settings.alert_email as string | undefined) || null;

    out.backup = await checkBackups(sb, alertTo, Number(settings.alert_missing_hours ?? 26));
    out.monthly_export = await monthlyExport(sb);
    out.exports = await processExports(sb, started);
    out.expired_exports = await expireExports(sb);
    out.drill = settings.monthly_drill === false ? { skipped: 'monthly_drill off' } : await drillFallback(sb);
  } catch (e) {
    console.error('[cron/backup-monitor]', e);
    return problem(500, 'BACKUP_MONITOR_FAILED', e instanceof Error ? e.message : String(e));
  }
  return json({ ok: true, ...out, duration_ms: Date.now() - started });
}

async function checkBackups(sb: Sb, alertTo: string | null, hours: number) {
  const { data: overdue, error } = await sb.rpc('backup_overdue');
  if (error) throw new Error(error.message);
  const { data: last } = await sb.from('backups').select('id, code, finished_at').eq('status', 'completed').order('finished_at', { ascending: false }).limit(1).maybeSingle();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: failed } = await sb.from('backups').select('id, code, error').eq('status', 'failed').gte('created_at', since);

  const problems: string[] = [];
  if (overdue) problems.push(`No successful backup in the last ${hours} hours (last: ${last ? `${last.code} at ${last.finished_at}` : 'never'}).`);
  for (const f of failed ?? []) problems.push(`Backup ${f.code} failed: ${(f.error as string | null) ?? 'see GitHub Actions'}`);
  if (!problems.length) return { overdue: false, last: last?.code ?? null };

  const summary = overdue ? `backup missing: no successful backup in ${hours} h` : `backup failed: ${(failed ?? []).map((f) => f.code).join(', ')}`;
  await sb.from('integration_logs').insert({ integration_code: 'backups', direction: 'out', status: 500, summary: summary.slice(0, 500) });
  if (overdue) {
    await sb.rpc('emit_event', { p_type: 'backup.missing', p_agg_type: 'backup', p_agg_id: last?.id ?? null, p_payload: { last_code: last?.code ?? null, last_finished_at: last?.finished_at ?? null, hours } });
  }
  let emailed = false;
  if (alertTo) {
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
    await getEmail()
      .send({
        to: alertTo,
        subject: `[Octopus B2B] ${overdue ? 'Nightly backup missing' : 'Backup failed'}`,
        html: `<p>${problems.map((p) => p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)).join('</p><p>')}</p>
          <p>Check the GitHub Actions "Backup" workflow and <a href="${site}/admin/backups">Admin → Backup &amp; restore</a>.</p>`,
      })
      .then(() => (emailed = true))
      .catch((e) => console.error('[cron/backup-monitor] email failed', e));
  }
  return { overdue: !!overdue, failed: (failed ?? []).map((f) => f.code), alerted: emailed, last: last?.code ?? null };
}

async function monthlyExport(sb: Sb) {
  const { y, m, d } = shanghaiDate();
  if (d !== '01') return { skipped: 'not the 1st' };
  const monthStart = new Date(`${y}-${m}-01T00:00:00+08:00`).toISOString();
  const { data: existing } = await sb.from('data_exports').select('id').eq('trigger', 'monthly').gte('created_at', monthStart).limit(1);
  if (existing?.length) return { skipped: 'already queued', id: existing[0].id };
  const { data: s } = await sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
  const months = Number((s?.value as Record<string, unknown> | null)?.keep_exports_months ?? 12);
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + (Number.isFinite(months) ? months : 12));
  const { data, error } = await sb
    .from('data_exports')
    .insert({ title: `Monthly export pack ${y}-${m}`, modules: [...EXPORT_MODULES], format: 'xlsx', trigger: 'monthly', email_link: false, expires_at: expires.toISOString() })
    .select('id, code')
    .single();
  if (error) throw new Error(error.message);
  await sb.from('audit_log').insert({ action: 'export.requested', entity: 'data_exports', entity_id: data.id, details: { trigger: 'monthly', modules: EXPORT_MODULES } });
  return { queued: data.code };
}

async function processExports(sb: Sb, started: number) {
  const { data: queued } = await sb.from('data_exports').select('id, code').eq('status', 'queued').order('created_at', { ascending: true }).limit(3);
  const results: { code: string; status: string }[] = [];
  for (const q of queued ?? []) {
    if (Date.now() - started > 200_000) break;
    const r = await runExport(sb, q.id as string);
    results.push({ code: q.code as string, status: r.status });
  }
  return results;
}

async function expireExports(sb: Sb) {
  const { data: old } = await sb.from('data_exports').select('id, file_path').eq('status', 'ready').lt('expires_at', new Date().toISOString()).limit(50);
  let n = 0;
  for (const e of old ?? []) {
    if (e.file_path) {
      const paths = await exportFiles(sb, e.file_path as string).catch(() => [] as string[]);
      if (paths.length) await sb.storage.from(EXPORTS_BUCKET).remove(paths);
    }
    await sb.from('data_exports').update({ status: 'expired' }).eq('id', e.id);
    n++;
  }
  return n;
}

async function drillFallback(sb: Sb) {
  const { d } = shanghaiDate();
  if (Number(d) < 3) return { skipped: 'scheduled drill runs on the 1st' };
  const since = new Date(Date.now() - 35 * 86_400_000).toISOString();
  const { data: recent } = await sb.from('restore_requests').select('id').eq('restore_type', 'drill').gte('created_at', since).limit(1);
  if (recent?.length) return { skipped: 'drill ran recently' };
  const { data: anyBackup } = await sb.from('backups').select('id').eq('status', 'completed').limit(1);
  if (!anyBackup?.length) return { skipped: 'no completed backup yet' };
  if (!githubConfigured()) return { skipped: 'GITHUB_NOT_CONFIGURED' };
  const r = await dispatchWorkflow('restore-drill.yml', { force: 'false' });
  return r.ok ? { dispatched: true } : { dispatched: false, error: r.error };
}
