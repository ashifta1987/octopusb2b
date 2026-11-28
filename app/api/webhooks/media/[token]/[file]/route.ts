import { openMediaToken, mediaSourceUrl } from '@/lib/connectors/media';
import { problem } from '@/lib/api/problem';

/**
 * GET /api/webhooks/media/{token}/{file} — CONN S2b: a product image for a store that downloads images by URL (WooCommerce).
 * The token is checked (HMAC); the image is streamed from the public product-media bucket under a neutral file name, so the store
 * never sees our storage path. Images only, 10 MB at most, cached for a day.
 */
const MAX = 10 * 1024 * 1024;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; file: string }> }) {
  const { token, file } = await params;
  const key = process.env.CONNECTOR_TOKEN_KEY ?? '';
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^img-[0-9a-f]{8}\.(jpg|png|webp|gif)$/.test(file)) return problem(404, 'NOT_FOUND', 'Not found.');
  const path = openMediaToken(token, key);
  if (!path || !supa) return problem(404, 'NOT_FOUND', 'Not found.');
  let res: Response;
  try { res = await fetch(mediaSourceUrl(path, supa), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { return problem(502, 'UNAVAILABLE', 'The image could not be loaded.'); }
  const type = res.headers.get('content-type') ?? '';
  const len = Number(res.headers.get('content-length') ?? '0');
  if (!res.ok || !res.body || !/^image\/(jpeg|png|webp|gif)$/.test(type) || len > MAX) return problem(404, 'NOT_FOUND', 'Not found.');
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': type, ...(len ? { 'Content-Length': String(len) } : {}), 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${file}"` },
  });
}
