import 'server-only';
import type { Session } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { supplierAccess, type Access } from '@/lib/distributor/access-rules';

/**
 * Server-side checks for the distributor portal (change request v2 item 3). Row-level security already hides other
 * suppliers' products; these checks run first so a request for another supplier's product is answered with 403 (not an
 * empty page or a silent no-op), and so code paths that use the service-role key cannot skip the assignment.
 */

/** Supplier ids assigned to the caller (own rows only — RLS on distributor_suppliers and suppliers.user_id). */
export async function assignedSupplierIds(s: Session): Promise<Set<string>> {
  if (s.isAdmin) return new Set();
  const sb = await createClient();
  const [{ data: links }, { data: own }] = await Promise.all([
    sb.from('distributor_suppliers').select('supplier_id').eq('distributor_id', s.userId),
    sb.from('suppliers').select('id').eq('user_id', s.userId),
  ]);
  return new Set([
    ...(links ?? []).map((r) => r.supplier_id as string),
    ...(own ?? []).map((r) => r.id as string),
  ]);
}

/** Supplier of a product, read with the service role (supplier_id only — never returned to the caller). */
async function productSupplierId(productId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
  const { data } = await createAdminClient().from('products').select('supplier_id').eq('id', productId).maybeSingle();
  return (data?.supplier_id as string | undefined) ?? null;
}

export async function checkSupplierAccess(s: Session, supplierId: string | null | undefined): Promise<Access> {
  if (!supplierId || !/^[0-9a-f-]{36}$/i.test(supplierId)) return 'not_found';
  return supplierAccess(s, await assignedSupplierIds(s), supplierId);
}

export async function checkProductAccess(s: Session, productId: string): Promise<Access> {
  return supplierAccess(s, await assignedSupplierIds(s), await productSupplierId(productId));
}

/** Does a supplier with this code exist at all? (public_suppliers: code + country only) — tells 403 from 404.
 *  public_suppliers is service-role only since migration 195; only a boolean leaves this function (callers have a session). */
export async function supplierCodeExists(code: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from('public_suppliers').select('id').ilike('code', code.replace(/[%_]/g, '')).limit(1);
  return !!data?.length;
}
