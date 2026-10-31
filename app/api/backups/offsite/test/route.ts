import { connection } from 'next/server';
import { fail, failDb, gate, ok } from '@/lib/backup/http';
import { s3ConfigFromEnv, testBucket } from '@/lib/backup/s3';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/backups/offsite/test — admin only. Tests the off-site S3-compatible bucket from the server env BACKUP_S3_*
 * (PUT + HEAD + DELETE of a small object) and records backup_settings.offsite.last_test_at / last_test_ok
 * (plus provider/bucket/endpoint/region for display — never credentials).
 */
export async function POST() {
  await connection();
  const g = await gate('backup');
  if ('response' in g) return g.response;
  if (!g.session.isAdmin) return fail('FORBIDDEN', 403);

  const cfg = s3ConfigFromEnv();
  const result = cfg ? await testBucket(cfg) : { ok: false, steps: [], error: 'OFFSITE_NOT_CONFIGURED' };

  const sb = await createClient();
  const { data: cur } = await sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
  const prev = ((cur?.value as Record<string, unknown> | null)?.offsite ?? {}) as Record<string, unknown>;
  const endpoint = cfg?.endpoint ?? (cfg ? `https://s3.${cfg.region}.amazonaws.com` : (prev.endpoint as string) ?? '');
  const provider =
    (prev.provider as string) ||
    (process.env.BACKUP_S3_PROVIDER ?? (endpoint.includes('r2.cloudflarestorage') ? 'Cloudflare R2' : endpoint.includes('backblazeb2') ? 'Backblaze B2' : cfg && !cfg.endpoint ? 'AWS S3' : 'S3-compatible'));
  const offsite = {
    ...prev,
    provider,
    bucket: cfg?.bucket ?? prev.bucket ?? '',
    endpoint,
    region: cfg?.region ?? prev.region ?? 'auto',
    last_test_at: new Date().toISOString(),
    last_test_ok: result.ok,
  };
  const { error } = await sb.rpc('update_backup_settings', { p_settings: { offsite } });
  if (error) return failDb(error);

  if (!cfg) return fail('OFFSITE_NOT_CONFIGURED', 503, { offsite });
  return result.ok ? ok({ offsite, steps: result.steps }) : fail('OFFSITE_TEST_FAILED', 502, { offsite, steps: result.steps, detail: 'error' in result ? result.error : undefined });
}
