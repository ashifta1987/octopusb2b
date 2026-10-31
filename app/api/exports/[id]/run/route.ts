import { connection } from 'next/server';
import { runExport } from '@/lib/backup/exports';
import { fail, failDb, gate, isUuid, ok } from '@/lib/backup/http';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * POST /api/exports/[id]/run — permission backups:export. Builds the export now (worker in lib/backup/exports.ts)
 * and returns `{ ok, status }`. Body {force?: true} rebuilds a ready/failed export. Queued exports that nobody runs
 * are picked up by the daily /api/cron/backup-monitor.
 */
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const g = await gate('export');
  if ('response' in g) return g.response;
  const { id } = await params;
  if (!isUuid(id)) return fail('NOT_FOUND', 404);
  const body = (await req.json().catch(() => ({}))) as { force?: unknown };

  // visibility through RLS first (exports_read), then the service-role worker builds the file
  const sb = await createClient();
  const { data: row, error } = await sb.from('data_exports').select('id, status').eq('id', id).maybeSingle();
  if (error) return failDb(error);
  if (!row) return fail('NOT_FOUND', 404);

  const res = await runExport(createAdminClient(), id, { force: body.force === true });
  if (!res.ok) return fail(res.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'EXPORT_FAILED', res.error === 'NOT_FOUND' ? 404 : 500, { status: res.status, message: res.error });
  return ok({ ...res, status: res.status });
}
