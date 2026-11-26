import 'server-only';
import type { createClient } from '@/lib/supabase/server';

/** Signed URLs (10 minutes) for parcel label PDFs in the private wh-labels bucket; the storage policy decides who may read. */
export async function signLabels(sb: Awaited<ReturnType<typeof createClient>>, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths)];
  if (!unique.length) return out;
  const { data } = await sb.storage.from('wh-labels').createSignedUrls(unique, 600);
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  return out;
}
