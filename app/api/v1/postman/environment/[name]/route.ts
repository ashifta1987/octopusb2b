import { buildEnvironment } from '@/lib/api/postman';
import { apiBase, jsonDownload } from '@/lib/api/postman-http';
import { problem } from '@/lib/api/problem';

/**
 * GET /api/v1/postman/environment/sandbox.json | live.json — Postman environments with EMPTY secrets
 * (client_id, client_secret, access_token). Real customer keys never go into shared environments.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const kind = name.replace(/\.json$/, '');
  if (kind !== 'sandbox' && kind !== 'live') return problem(404, 'NOT_FOUND', 'Use sandbox.json or live.json.');
  return jsonDownload(buildEnvironment(kind, { baseUrl: apiBase(req) }), `${kind}.postman_environment.json`);
}
