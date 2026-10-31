import { buildPostman } from '@/lib/api/postman';

/** GET /api/v1/postman.json — Postman v2.1 collection (public). */
export async function GET(req: Request) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;
  return new Response(JSON.stringify(buildPostman(base), null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="octopus-b2b.postman_collection.json"',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
