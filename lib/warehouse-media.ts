import 'server-only';
import type { createClient } from '@/lib/supabase/server';

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Signed URLs (10 minutes) for files in a W5 private bucket; the storage policies decide who may read. */
async function sign(sb: Sb, bucket: 'wh-returns' | 'wh-products', paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return out;
  const { data } = await sb.storage.from(bucket).createSignedUrls(uniq, 600);
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  return out;
}

/** Return inspection photos (wh-returns: <WH>/<RT-code>/<uuid>.<ext>). */
export const signReturnPhotos = (sb: Sb, paths: string[]) => sign(sb, 'wh-returns', paths);
/** Client product photos (wh-products: <org>/<sku id>/<uuid>.<ext>). */
export const signProductPhotos = (sb: Sb, paths: string[]) => sign(sb, 'wh-products', paths);
