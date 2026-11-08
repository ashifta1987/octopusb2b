'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { guard, fail, ok, type Result } from '@/components/admin/server';

/** Site content › Media (brand kit step 4): replace a picture or its alt text for one Site content key. */
const TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif' };

export async function saveSiteMedia(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('content', 'edit'); if ('error' in g) return g.error;
  const key = String(fd.get('key') ?? '');
  const alt = String(fd.get('alt') ?? '').trim();
  const decorative = fd.get('decorative') === 'on';
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(key)) return fail('Unknown picture slot.');
  if (!decorative && alt.length < 8) return fail('Describe what the picture shows (alt text, at least 8 characters).');
  if (/\b(mr|mrs|ms)\.?\s+[A-Z]/.test(alt)) return fail('Alt text describes the picture; no staff names.');
  const { data: row } = await g.sb.from('site_media').select('path').eq('key', key).maybeSingle();
  if (!row) return fail('Unknown picture slot.');

  let path: string | null = (row.path as string | null) ?? null;
  const file = fd.get('file');
  if (file instanceof File && file.size > 0) {
    const ext = TYPES[file.type];
    if (!ext) return fail('Use a WebP, JPG, PNG or AVIF picture.');
    if (file.size > 5 * 1024 * 1024) return fail('Pictures up to 5 MB. A 1200 × 800 WebP is usually under 200 KB.');
    path = `site/custom/${key.replace(/\./g, '-')}-${Date.now()}.${ext}`;
    const { error } = await createAdminClient().storage.from('site-media').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) return fail(`Upload failed: ${error.message}`);
  }
  if (fd.get('reset') === 'on') path = null; // back to the picture shipped with the site
  const { error } = await g.sb.rpc('set_site_media', { p_key: key, p_path: path, p_alt: decorative ? '' : alt });
  if (error) return fail(error);
  revalidateTag('site-media', 'max');
  revalidatePath('/admin/content');
  return ok('Picture saved. The site shows it within a minute.');
}
