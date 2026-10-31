import { buildOpenApi } from '@/lib/api/openapi';

/** GET /api/v1/openapi.json — OpenAPI 3.1 document (public). */
export async function GET(req: Request) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;
  return new Response(JSON.stringify(buildOpenApi(base), null, 2), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}
