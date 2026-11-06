import { notFound } from 'next/navigation';
import type { Session } from '@/lib/auth';
import { getManagedSuppliers, type SupplierRow } from '@/components/backoffice/server-utils';

/**
 * Supplier scope for the distributor portal (6 Nov 2026): `?supplier=<code>` (e.g. OCT-1133).
 * The list comes from getManagedSuppliers(), which reads `suppliers` with the caller's RLS client — a distributor
 * without suppliers.view only ever sees suppliers assigned to them (is_my_supplier), so an unassigned or unknown
 * code resolves to nothing and the page answers 404. Admins see every supplier.
 */
export type SupplierScope = { suppliers: SupplierRow[]; selected: SupplierRow | null };

export function findSupplier(suppliers: SupplierRow[], param: string | null | undefined): SupplierRow | null | 'not_found' {
  const v = (param ?? '').trim();
  if (!v) return null;
  const hit = suppliers.find((x) => x.code.toUpperCase() === v.toUpperCase() || x.id === v);
  return hit ?? 'not_found';
}

export async function supplierScope(s: Session, param: string | null | undefined): Promise<SupplierScope> {
  const suppliers = await getManagedSuppliers(s);
  const sel = findSupplier(suppliers, param);
  if (sel === 'not_found') notFound();
  return { suppliers, selected: sel };
}

