import { buildPublicCollection } from '@/lib/api/postman';
import { apiBase, jsonDownload, POSTMAN_EXAMPLES } from '@/lib/api/postman-http';

/** GET /api/v1/postman.json — "Octopus B2B API v1" Postman v2.1 collection (public; base_url = this deployment). */
export async function GET(req: Request) {
  return jsonDownload(buildPublicCollection({ baseUrl: apiBase(req), examples: POSTMAN_EXAMPLES }), 'octopus-b2b-api-v1.postman_collection.json');
}
