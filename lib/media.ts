import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

/**
 * Brand kit step 4 — site pictures by Site content key (site_media). The content team swaps a file or its alt text in
 * Site content › Media without a deploy; until a file is uploaded the slot uses the picture shipped in /public/images.
 */
export type SiteImage = { key: string; src: string; alt: string; width: number; height: number };

const publicUrl = (path: string) => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/storage/v1/object/public/site-media/${path}`;

export async function getSiteMedia(): Promise<Record<string, SiteImage>> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('site-media');
  const { data } = await createPublicClient().from('site_media').select('key, default_src, path, alt, width, height');
  const out: Record<string, SiteImage> = {};
  (data ?? []).forEach((r) => {
    out[r.key as string] = { key: r.key as string, src: r.path ? publicUrl(r.path as string) : (r.default_src as string), alt: (r.alt as string) ?? '', width: Number(r.width) || 1200, height: Number(r.height) || 800 };
  });
  return out;
}

/** One slot, with a safe fallback when the table row is missing (e.g. a fresh database). */
export function slot(media: Record<string, SiteImage>, key: string, fallback: Omit<SiteImage, 'key'>): SiteImage {
  return media[key] ?? { key, ...fallback };
}
