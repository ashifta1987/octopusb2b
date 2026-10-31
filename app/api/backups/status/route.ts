import { revalidatePath, revalidateTag } from 'next/cache';
import { connection } from 'next/server';
import { getEmail } from '@/lib/adapters';
import { backupReportArgs, parseCallback, RESTORE_TAGS, restoreReportArgs, type CallbackBody, type RestoreCheck } from '@/lib/backup/callback';
import { fail, ok } from '@/lib/backup/http';
import { resetMaintenanceCache } from '@/lib/backup/maintenance';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/backups/status — signed callback from the GitHub workflows (no session). Header `Octopus-Signature: t=…,v1=…`
 * (HMAC-SHA256 with BACKUP_CALLBACK_SECRET, 5-minute window). Body `{ type, … }`:
 *   backup → backup_report · restore → restore_report · retention_plan · mark_expired · maintenance → set_maintenance ·
 *   revalidate (cache tags after a restore) · drill_start (creates the monthly drill request) · restore_info · catalog (export/import
 *   the backup catalogue around a production restore so the panel history survives it).
 */
export const maxDuration = 60;

type Sb = ReturnType<typeof createAdminClient>;

export async function POST(req: Request) {
  await connection();
  const raw = await req.text();
  const parsed = parseCallback(raw, req.headers.get('octopus-signature'), process.env.BACKUP_CALLBACK_SECRET);
  if (!parsed.ok) return fail(parsed.error, parsed.status, parsed.issues ? { issues: parsed.issues } : {});
  const sb = createAdminClient();
  try {
    return await handle(sb, parsed.body);
  } catch (e) {
    console.error('[backups/status]', e);
    return fail('CALLBACK_FAILED', 500, { message: e instanceof Error ? e.message : String(e) });
  }
}

async function handle(sb: Sb, b: CallbackBody): Promise<Response> {
  switch (b.type) {
    case 'backup': {
      const { data, error } = await sb.rpc('backup_report', backupReportArgs(b));
      if (error) return fail('DB_ERROR', 500, { message: error.message });
      if (b.status === 'failed') await alert(sb, `Backup ${b.code} failed`, `<p>The backup <b>${b.code}</b> failed.</p><pre>${esc(b.error ?? 'see the GitHub Actions run')}</pre>`);
      return ok({ backup_id: data });
    }

    case 'restore': {
      const args = restoreReportArgs(b);
      const { error } = await sb.rpc('restore_report', args);
      if (error) return fail(error.message.startsWith('NOT_FOUND') ? 'NOT_FOUND' : 'DB_ERROR', error.message.startsWith('NOT_FOUND') ? 404 : 500, { message: error.message });
      if (b.status === 'completed' || b.status === 'failed') await restoreReportEmail(sb, b.restore_id, b.status, b.checks ?? [], args.p_phase, b.error);
      return ok({ restore_id: b.restore_id });
    }

    case 'retention_plan': {
      const { data, error } = await sb.rpc('backup_retention_plan');
      if (error) return fail('DB_ERROR', 500, { message: error.message });
      return ok({ plan: data ?? [] });
    }

    case 'mark_expired': {
      const { data, error } = await sb.rpc('backup_mark_expired', { p_ids: b.ids });
      if (error) return fail('DB_ERROR', 500, { message: error.message });
      return ok({ expired: data ?? 0 });
    }

    case 'maintenance': {
      const { error } = await sb.rpc('set_maintenance', { p_enabled: b.enabled, p_message: b.message ?? null, p_retry_after: b.retry_after ?? null });
      if (error) return fail('DB_ERROR', 500, { message: error.message });
      resetMaintenanceCache();
      revalidateTag('site-content', { expire: 0 });
      return ok({ maintenance: b.enabled });
    }

    case 'revalidate': {
      const tags = b.tags?.length ? b.tags : RESTORE_TAGS;
      for (const t of tags) revalidateTag(t, { expire: 0 }); // data was replaced: never serve stale content
      revalidatePath('/', 'layout');
      resetMaintenanceCache();
      return ok({ revalidated: tags });
    }

    case 'drill_start':
      return drillStart(sb, b.force ?? false, b.backup_code);

    case 'restore_info': {
      const { data: r } = await sb.from('restore_requests').select('id, code, status, restore_type, target, modules, records, backup_id').eq('id', b.restore_id).maybeSingle();
      if (!r) return fail('NOT_FOUND', 404);
      const { data: bk } = await sb.from('backups').select('id, code, status, location, migration_version').eq('id', r.backup_id).maybeSingle();
      return ok({ restore: r, backup: bk });
    }

    case 'catalog':
      return b.op === 'export' ? ok({ catalog: await catalogExport(sb) }) : ok({ imported: await catalogImport(sb, b.catalog ?? {}) });
  }
}

/* ───────── monthly drill ───────── */
async function drillStart(sb: Sb, force: boolean, backupCode?: string) {
  const { data: s } = await sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
  const settings = (s?.value ?? {}) as Record<string, unknown>;
  if (!force && settings.monthly_drill === false) return ok({ skip: true, reason: 'monthly_drill is off' });

  let q = sb.from('backups').select('id, code, location').eq('status', 'completed');
  q = backupCode ? q.eq('code', backupCode) : q.order('finished_at', { ascending: false });
  const { data: bk } = await q.limit(1).maybeSingle();
  if (!bk) return ok({ skip: true, reason: 'no completed backup' });

  // restore_requests.requested_by is required: the drill is recorded on behalf of the first admin (no user is involved)
  const { data: admin } = await sb.from('user_roles').select('user_id').eq('role_code', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (!admin) return fail('NO_ADMIN_USER', 409);
  const { data: r, error } = await sb
    .from('restore_requests')
    .insert({ backup_id: bk.id, restore_type: 'drill', target: 'scratch', reason: `Monthly restore drill of ${bk.code} into the scratch project`, status: 'running', requested_by: admin.user_id, started_at: new Date().toISOString() })
    .select('id, code')
    .single();
  if (error) return fail('DB_ERROR', 500, { message: error.message });
  await sb.from('audit_log').insert({ action: 'restore.drill_started', entity: 'restore_requests', entity_id: r.id, details: { backup: bk.code } });
  return ok({ restore_id: r.id, code: r.code, backup: bk });
}

/* ───────── backup catalogue around a production restore ───────── */
const CATALOG = ['backups', 'backup_files', 'restore_requests', 'restore_checks'] as const;

async function catalogExport(sb: Sb) {
  const out: Record<string, unknown[]> = {};
  for (const t of CATALOG) {
    const { data, error } = await sb.from(t).select('*').order('created_at', { ascending: true }).limit(5000);
    if (error) throw new Error(`${t}: ${error.message}`);
    out[t] = data ?? [];
  }
  return out;
}

async function catalogImport(sb: Sb, catalog: Record<string, Record<string, unknown>[]>) {
  const result: Record<string, { upserted: number; skipped: number }> = {};
  for (const t of CATALOG) {
    const rows = catalog[t] ?? [];
    let upserted = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from(t).upsert(chunk, { onConflict: 'id' });
      if (!error) {
        upserted += chunk.length;
        continue;
      }
      for (const row of chunk) {
        // e.g. a requester user created after the backup no longer exists → skip that row only
        const { error: e } = await sb.from(t).upsert(row, { onConflict: 'id' });
        if (e) skipped++;
        else upserted++;
      }
    }
    result[t] = { upserted, skipped };
  }
  return result;
}

/* ───────── notifications ───────── */
async function alertEmail(sb: Sb) {
  const { data } = await sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
  return ((data?.value as Record<string, unknown> | null)?.alert_email as string | undefined) || null;
}

async function alert(sb: Sb, subject: string, html: string) {
  const to = await alertEmail(sb);
  await sb.from('integration_logs').insert({ integration_code: 'backups', direction: 'in', status: 500, summary: subject.slice(0, 500) });
  if (!to) return;
  await getEmail()
    .send({ to, subject: `[Octopus B2B] ${subject}`, html })
    .catch((e) => console.error('[backups/status] alert email failed', e));
}

async function restoreReportEmail(sb: Sb, id: string, status: string, checks: RestoreCheck[], phase: string, error?: string) {
  const { data: r } = await sb.from('restore_requests').select('code, restore_type, target').eq('id', id).maybeSingle();
  const to = await alertEmail(sb);
  if (!to || !r) return;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const rows = checks.map((c) => `<tr><td>${esc(c.kind)}</td><td><b>${c.status.toUpperCase()}</b></td><td>${esc(c.detail)}</td></tr>`).join('');
  await getEmail()
    .send({
      to,
      subject: `[Octopus B2B] Restore ${r.code} ${status} (${r.restore_type} → ${r.target}, ${phase})`,
      html: `<p>Restore <b>${r.code}</b> (${r.restore_type} → ${r.target}) finished with status <b>${status}</b>.</p>${error ? `<pre>${esc(error)}</pre>` : ''}
        <table border="1" cellpadding="4" cellspacing="0"><tr><th>Check</th><th>Result</th><th>Detail</th></tr>${rows}</table>
        <p><a href="${site}/admin/backups">Open Backup &amp; restore</a></p>`,
    })
    .catch((e) => console.error('[backups/status] report email failed', e));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
