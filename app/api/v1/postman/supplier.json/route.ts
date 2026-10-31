import { buildSupplierCollection } from '@/lib/api/postman';
import { apiBase, jsonDownload, POSTMAN_EXAMPLES } from '@/lib/api/postman-http';

/** GET /api/v1/postman/supplier.json — "Octopus B2B Supplier API v1" Postman v2.1 collection (public). */
export async function GET(req: Request) {
  return jsonDownload(buildSupplierCollection({ baseUrl: apiBase(req), examples: POSTMAN_EXAMPLES }), 'octopus-b2b-supplier-api-v1.postman_collection.json');
}
