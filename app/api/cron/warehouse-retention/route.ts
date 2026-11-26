import { checkCron } from '@/lib/api/cron';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/cron/warehouse-retention — Warehouse OS W6 nightly retention job (Vercel Cron, CRON_SECRET; also a manual trigger).
 * Asks the database what is due (wh_retention_due: packing photos past their retention date, return photos of finished returns
 * older than the warehouse's setting, product photos / label PDFs no record points at for 30 days), removes the files with the
 * Storage API (service role — SQL cannot delete storage objects) and marks the photo rows purged (wh_retention_mark). Rows
 * are kept; nothing financial is touched. A file that is already gone counts as removed. Batches of up to 500 per kind.
 */
type Due = { kind: 'evidence' | 'return_photo' | 'product_orphan' | 'label_orphan'; id: string; bucket: string; path: string };

export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = checkCron(req);
  if (denied) return denied;
  const sb = createAdminClient();
  const started = Date.now();
  try {
    const { data, error } = await sb.rpc('wh_retention_due', { p_limit: 500 });
    if (error) throw new Error(error.message);
    const due = (data ?? []) as Due[];
    const removed: Due[] = [];
    const failed: string[] = [];
    const byBucket = new Map<string, Due[]>();
    for (const d of due) byBucket.set(d.bucket, [...(byBucket.get(d.bucket) ?? []), d]);
    for (const [bucket, items] of byBucket) {
      for (let i = 0; i < items.length; i += 100) {
        const chunk = items.slice(i, i + 100);
        const r = await sb.storage.from(bucket).remove(chunk.map((c) => c.path));
        if (r.error) { failed.push(`${bucket}: ${r.error.message}`); continue; }
        removed.push(...chunk);
      }
    }
    const marked = removed.length
      ? await sb.rpc('wh_retention_mark', { p_items: removed.map((d) => ({ kind: d.kind, id: d.id })) })
      : { data: { evidence: 0, return_photos: 0 }, error: null };
    if (marked.error) throw new Error(marked.error.message);
    const count = (k: Due['kind']) => removed.filter((d) => d.kind === k).length;
    return json({
      ok: failed.length === 0, job: 'warehouse-retention', duration_ms: Date.now() - started,
      result: { due: due.length, removed: { evidence: count('evidence'), return_photos: count('return_photo'), product_orphans: count('product_orphan'), label_orphans: count('label_orphan') }, marked: marked.data, failed },
    });
  } catch (e) {
    console.error('[cron/warehouse-retention]', e);
    return problem(500, 'JOB_FAILED', e instanceof Error ? e.message : String(e));
  }
}

export const POST = GET;
