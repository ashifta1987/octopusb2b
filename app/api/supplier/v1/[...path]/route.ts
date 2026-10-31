import { authenticate } from '@/lib/api/auth';
import { problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';
import { SUPPLIER_SCOPES } from '@/lib/contracts';

/**
 * Supplier API stubs (SPEC §7 Supplier API): /api/supplier/v1/{products,inventory,rfqs,quotes,orders}.
 * Returns 403 while site_settings.supplier_portal_enabled is false (launch default). When the portal opens the
 * same auth model applies (supplier scopes: products:write, inventory:write, rfqs:read, quotes:write, orders:read);
 * the endpoints themselves are not implemented yet (501). Writes must still pass moderation + supplier switches.
 */
const RESOURCES = new Set(['products', 'inventory', 'rfqs', 'quotes', 'orders']);

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const { data } = await createAdminClient().from('site_settings').select('value').eq('key', 'supplier_portal_enabled').maybeSingle();
  if (data?.value !== true) return problem(403, 'SUPPLIER_PORTAL_DISABLED', 'The supplier API is not open yet.');
  if (!RESOURCES.has(path?.[0] ?? '')) return problem(404, 'NOT_FOUND', 'Unknown supplier API resource.');
  const ctx = await authenticate(req);
  if (ctx instanceof Response) return ctx;
  if (!ctx.scopes.some((s) => (SUPPLIER_SCOPES as readonly string[]).includes(s)))
    return problem(403, 'INSUFFICIENT_SCOPE', `Supplier API needs one of: ${SUPPLIER_SCOPES.join(', ')}.`);
  return problem(501, 'NOT_IMPLEMENTED', `Supplier API "${path.join('/')}" is coming soon.`);
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
