/**
 * CONN S2b · product images for stores that download them from a URL (WooCommerce). A store keeps the file name of the URL it
 * downloads, so we never hand out the storage path (it carries the content hash): images go out as
 *   <site>/api/webhooks/media/<token>/img-<8 hex>.<ext>
 * where <token> = base64url(storage path) + "." + 16 hex of an HMAC (key derived from CONNECTOR_TOKEN_KEY). The route checks the
 * HMAC and streams the public product image. Only images of the public product-media bucket are ever served.
 */
import crypto from 'node:crypto';

const BUCKET_PREFIX = '/storage/v1/object/public/product-media/';
const PATH_OK = /^[A-Za-z0-9/_.-]{1,300}$/;

const mac = (key: string, path: string) => crypto.createHmac('sha256', `store-media:v1:${key}`).update(path).digest('hex');

/** our product-media storage path of a public image URL, or null when the URL is anything else */
export function mediaPath(url: string, supabaseUrl: string): string | null {
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    if (u.origin !== base.origin || !u.pathname.startsWith(BUCKET_PREFIX)) return null;
    const p = decodeURIComponent(u.pathname.slice(BUCKET_PREFIX.length));
    return PATH_OK.test(p) && !p.includes('..') ? p : null;
  } catch { return null; }
}

export function storeMediaUrl(url: string, opts: { site: string; supabaseUrl: string; key: string }): string | null {
  const path = mediaPath(url, opts.supabaseUrl);
  if (!path || !opts.key || !/^https:\/\//.test(opts.site)) return null;
  const m = mac(opts.key, path);
  const ext = (path.match(/\.(jpe?g|png|webp|gif)$/i)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  return `${opts.site.replace(/\/$/, '')}/api/webhooks/media/${Buffer.from(path).toString('base64url')}.${m.slice(0, 16)}/img-${m.slice(16, 24)}.${ext}`;
}

/** the storage path behind a token, or null when the token was not made by us */
export function openMediaToken(token: string, key: string): string | null {
  const m = /^([A-Za-z0-9_-]{1,420})\.([0-9a-f]{16})$/.exec(token);
  if (!m || !key) return null;
  let path: string;
  try { path = Buffer.from(m[1], 'base64url').toString('utf8'); } catch { return null; }
  if (!PATH_OK.test(path) || path.includes('..')) return null;
  const want = Buffer.from(mac(key, path).slice(0, 16));
  const got = Buffer.from(m[2]);
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? path : null;
}

export const mediaSourceUrl = (path: string, supabaseUrl: string) => `${supabaseUrl.replace(/\/$/, '')}${BUCKET_PREFIX}${path.split('/').map(encodeURIComponent).join('/')}`;
