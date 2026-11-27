/**
 * Pure helper (server + client): may this image URL go through the Next image optimiser? Only URLs that match
 * next.config `images.remotePatterns` (https://*.supabase.co/storage/v1/object/public/site-media/**) or local paths
 * ("/…") can. Everything else (product-media bucket, external links) must render with `unoptimized`.
 */
export function isOptimizableImage(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname) && u.pathname.startsWith('/storage/v1/object/public/site-media/');
  } catch {
    return false;
  }
}
