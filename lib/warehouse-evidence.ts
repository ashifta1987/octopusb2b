import 'server-only';
import type { createClient } from '@/lib/supabase/server';

/** Signed URLs (10 minutes) for packing photos in the private wh-evidence bucket; the storage policy decides who may read. */
export async function signEvidence(sb: Awaited<ReturnType<typeof createClient>>, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data } = await sb.storage.from('wh-evidence').createSignedUrls(paths, 600);
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
  return out;
}
