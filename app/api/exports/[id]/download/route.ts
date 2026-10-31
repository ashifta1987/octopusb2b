import { connection } from 'next/server';
import { EXPORTS_BUCKET, exportFiles } from '@/lib/backup/exports';
import { fail, failDb, gate, isUuid, ok } from '@/lib/backup/http';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * GET /api/exports/[id]/download — permission backups:export. `{ ok, url, urls, expires_in, files }`: 10-minute signed URL(s)
 * from the private bucket `exports` (CSV exports have one file per sheet → `files[]`, `url` = first). Audited.
 */
const EXPIRES = 600;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const g = await gate('export');
  if ('response' in g) return g.response;
  const { id } = await params;
  if (!isUuid(id)) return fail('NOT_FOUND', 404);

  const sb = await createClient();
  const { data: ex, error } = await sb.from('data_exports').select('id, code, status, file_path, format, expires_at').eq('id', id).maybeSingle();
  if (error) return failDb(error);
  if (!ex) return fail('NOT_FOUND', 404);
  if (ex.status === 'expired' || (ex.expires_at && new Date(ex.expires_at as string) < new Date())) return fail('EXPORT_EXPIRED', 410);
  if (ex.status !== 'ready' || !ex.file_path) return fail('EXPORT_NOT_READY', 409, { status: ex.status });

  const admin = createAdminClient();
  const paths = await exportFiles(admin, ex.file_path as string);
  if (!paths.length) return fail('FILE_NOT_FOUND', 404);
  const { data: signed, error: sErr } = await admin.storage.from(EXPORTS_BUCKET).createSignedUrls(paths, EXPIRES);
  if (sErr) return fail('SIGN_FAILED', 500, { message: sErr.message });
  const files = (signed ?? []).map((s, i) => ({ path: paths[i], name: paths[i].split('/').pop(), url: s.signedUrl }));

  await admin.from('audit_log').insert({ actor_id: g.session.userId, action: 'export.download', entity: 'data_exports', entity_id: id, details: { code: ex.code, files: paths.length } });
  return ok({ url: files[0]?.url ?? null, urls: files.map((f) => f.url), expires_in: EXPIRES, format: ex.format, files });
}
