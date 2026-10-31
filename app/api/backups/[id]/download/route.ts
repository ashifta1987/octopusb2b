import { connection } from 'next/server';
import { fail, failDb, gate, isUuid, ok } from '@/lib/backup/http';
import { prefixFromLocation, presignGet, s3ConfigFromEnv } from '@/lib/backup/s3';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * GET /api/backups/[id]/download[?file=db/data.sql.gz.age] — backups:download + a recent 2FA (mfa_recent()).
 * Returns a 10-minute SigV4 presigned URL from the off-site bucket (default: manifest.json) plus links for every file,
 * and writes the audit log. Files stay age-encrypted: decrypting needs the owner's offline private key.
 */
const EXPIRES = 600;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const g = await gate('download');
  if ('response' in g) return g.response;
  const { id } = await params;
  if (!isUuid(id)) return fail('NOT_FOUND', 404);

  const sb = await createClient();
  const { data: mfa, error: mfaErr } = await sb.rpc('mfa_recent');
  if (mfaErr) return failDb(mfaErr);
  if (!mfa) return fail('MFA_REQUIRED', 401);

  const { data: b, error } = await sb.from('backups').select('id, code, status, location').eq('id', id).maybeSingle();
  if (error) return failDb(error);
  if (!b) return fail('NOT_FOUND', 404);
  if (b.status !== 'completed') return fail('BACKUP_NOT_COMPLETED', 409);

  const cfg = s3ConfigFromEnv();
  if (!cfg) return fail('OFFSITE_NOT_CONFIGURED', 503);
  const prefix = prefixFromLocation(b.location as string | null, cfg.bucket);
  if (!prefix) return fail('OFFSITE_LOCATION_UNKNOWN', 409, { message: 'Backup location is not in the configured off-site bucket.' });

  const { data: files } = await sb.from('backup_files').select('path, kind, bucket, size_bytes').eq('backup_id', id).order('path');
  const paths = ['manifest.json', ...(files ?? []).map((f) => f.path as string).filter((p) => p !== 'manifest.json')];
  const want = new URL(req.url).searchParams.get('file') ?? 'manifest.json';
  if (!paths.includes(want)) return fail('FILE_NOT_FOUND', 404);

  const url = presignGet(cfg, `${prefix}/${want}`, EXPIRES);
  await createAdminClient()
    .from('audit_log')
    .insert({ actor_id: g.session.userId, action: 'backup.download', entity: 'backups', entity_id: id, details: { code: b.code, file: want, expires_in: EXPIRES } });

  return ok({
    url,
    file: want,
    expires_in: EXPIRES,
    files: paths.map((p) => ({ path: p, kind: (files ?? []).find((f) => f.path === p)?.kind ?? 'manifest', size_bytes: (files ?? []).find((f) => f.path === p)?.size_bytes ?? null, url: p === want ? url : presignGet(cfg, `${prefix}/${p}`, EXPIRES) })),
  });
}
