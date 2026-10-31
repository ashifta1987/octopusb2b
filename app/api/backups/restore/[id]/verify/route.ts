import { connection } from 'next/server';
import { dispatchWorkflow } from '@/lib/backup/github';
import { fail, failDb, gate, isUuid, ok } from '@/lib/backup/http';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/backups/restore/[id]/verify — "verify first" (SPEC §16.3 step 2).
 * Full/drill restores: restore.yml {mode:'verify', target:'scratch'} → checks posted back → pending_approval (or failed).
 * Partial restores: restore.yml {mode:'partial', target:'production'} loads the chosen tables into the `recovery` schema
 * (never touches public tables) so admins can compare before approval.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const g = await gate('request_restore');
  if ('response' in g) return g.response;
  const { id } = await params;
  if (!isUuid(id)) return fail('NOT_FOUND', 404);

  const sb = await createClient();
  const { data: r, error } = await sb.from('restore_requests').select('id, code, status, restore_type').eq('id', id).maybeSingle();
  if (error) return failDb(error);
  if (!r) return fail('NOT_FOUND', 404);
  if (r.status !== 'verifying' && r.status !== 'draft') return fail('INVALID_TRANSITION', 409, { message: `Restore ${r.code} is ${r.status}` });

  const partial = r.restore_type === 'partial';
  const d = await dispatchWorkflow('restore.yml', { restore_id: id, mode: partial ? 'partial' : 'verify', target: partial ? 'production' : 'scratch' });
  if (!d.ok) return fail(d.error, d.error === 'GITHUB_NOT_CONFIGURED' ? 503 : 502, { restore_id: id, detail: 'detail' in d ? d.detail : undefined });
  return ok({ restore_id: id, status: r.status, mode: partial ? 'partial' : 'verify' });
}
