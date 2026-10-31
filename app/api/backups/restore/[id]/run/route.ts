import { connection } from 'next/server';
import { dispatchWorkflow } from '@/lib/backup/github';
import { fail, failDb, gate, isUuid, ok } from '@/lib/backup/http';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * POST /api/backups/restore/[id]/run — after approval (SPEC §16.3 steps 3–5).
 * rpc start_restore (approved → running) → restore.yml {restore_id, mode:'run', target}. For target production the
 * workflow itself turns maintenance mode on/off and runs in the protected GitHub environment `restore-production`
 * (manual approval). Partial restores re-load the recovery schema (mode 'partial') and complete; rows are then copied
 * back with restore_records from the compare screen.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const g = await gate('request_restore');
  if ('response' in g) {
    const g2 = await gate('approve_restore');
    if ('response' in g2) return g2.response;
  }
  const { id } = await params;
  if (!isUuid(id)) return fail('NOT_FOUND', 404);

  const sb = await createClient();
  const { data: r, error } = await sb.rpc('start_restore', { p_id: id });
  if (error) return failDb(error);
  const row = (Array.isArray(r) ? r[0] : r) as { id: string; code: string; target: 'scratch' | 'staging' | 'production'; restore_type: string } | null;
  if (!row) return fail('NOT_FOUND', 404);

  const partial = row.restore_type === 'partial';
  const d = await dispatchWorkflow('restore.yml', { restore_id: id, mode: partial ? 'partial' : 'run', target: partial ? 'production' : row.target });
  if (!d.ok) {
    // the request is already 'running': mark it failed so it can be re-requested, with the reason
    await createAdminClient().rpc('restore_report', {
      p_id: id, p_status: 'failed', p_error: d.error === 'GITHUB_NOT_CONFIGURED' ? 'GitHub Actions is not configured (GITHUB_REPO / GITHUB_ACTIONS_TOKEN)' : `GitHub dispatch failed: ${d.detail ?? ''}`.slice(0, 1000),
      p_phase: 'post_restore',
    });
    return fail(d.error, d.error === 'GITHUB_NOT_CONFIGURED' ? 503 : 502, { restore_id: id });
  }
  return ok({ restore_id: id, code: row.code, status: 'running', target: row.target, mode: partial ? 'partial' : 'run' });
}
