/**
 * Distributor product access rules (change request v2 item 3, 8 Nov 2026) — pure, so they can be unit-tested.
 * A distributor may read and change only the products of suppliers assigned to them (distributor_suppliers). Admins and
 * staff with products:view (platform-wide product rights) are not restricted. Mirrors distributor_restricted() in SQL.
 */
export type Access = 'ok' | 'forbidden' | 'not_found';

export type AccessSubject = { isAdmin: boolean; roles: string[]; permissions: ReadonlySet<string> };

/** True when the caller is a distributor without platform-wide product rights (same rule as the database). */
export function isRestrictedDistributor(s: AccessSubject): boolean {
  return s.roles.includes('distributor') && !s.isAdmin && !s.permissions.has('products:view');
}

/** Can the caller work with products of `supplierId`? `null` supplier = the product/supplier does not exist. */
export function supplierAccess(s: AccessSubject, assigned: ReadonlySet<string>, supplierId: string | null | undefined): Access {
  if (!supplierId) return 'not_found';
  if (s.isAdmin || s.permissions.has('products:view')) return 'ok';
  if (s.roles.includes('distributor') || s.roles.includes('supplier')) return assigned.has(supplierId) ? 'ok' : 'forbidden';
  return 'forbidden';
}

/** Message shown when an action is refused (server actions cannot carry an HTTP status). */
export const FORBIDDEN_MESSAGE = 'Forbidden (403): this product belongs to a supplier that is not assigned to you.';
