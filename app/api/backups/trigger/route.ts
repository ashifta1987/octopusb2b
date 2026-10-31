import { connection } from 'next/server';
import { dispatchWorkflow } from '@/lib/backup/github';
import { fail, failDb, gate, ok } from '@/lib/backup/http';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * POST /api/backups/trigger — "Back up now" (SPEC §16.2). Body {note?}.
 * rpc request_backup (permission backups:backup, refuses a concurrent run) → workflow_dispatch backup.yml {backup_code, trigger:'manual'}.
 * Without GITHUB_REPO / GITHUB_ACTIONS_TOKEN → { ok:false, error:'GITHUB_NOT_CONFIGURED', backup_id } (row stays queued).
 */
export async function POST(req: Request) {
  await connection();
  const g = await gate('backup');
  if ('response' in g) return g.response;
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const sb = await createClient();
  const { data: id, error } = await sb.rpc('request_backup', { p_note: note });
  if (error) return failDb(error);
  const { data: row } = await sb.from('backups').select('id, code, status').eq('id', id).maybeSingle();
  const code = (row?.code as string | undefined) ?? '';

  const d = await dispatchWorkflow('backup.yml', { backup_code: code, trigger: 'manual' });
  if (!d.ok) {
    if (d.error === 'GITHUB_DISPATCH_FAILED') {
      // don't leave a queued row that blocks the next attempt for 3 hours
      await createAdminClient().rpc('backup_report', { p_code: code, p_status: 'failed', p_error: `GitHub dispatch failed (${d.status ?? 'network'}): ${d.detail ?? ''}`.slice(0, 1000) });
    }
    return fail(d.error, d.error === 'GITHUB_NOT_CONFIGURED' ? 503 : 502, { backup_id: id, code, detail: 'detail' in d ? d.detail : undefined });
  }
  return ok({ backup_id: id, code, status: 'queued' });
}
