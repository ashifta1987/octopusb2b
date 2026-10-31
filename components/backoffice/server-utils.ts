import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSession, can, type Session } from '@/lib/auth';
import { mapDbError } from '@/lib/format';

export type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export const ok = <T,>(data?: T, message?: string): Result<T> => ({ ok: true, data, message });
export const fail = (e: { message?: string } | string | null | undefined): Result<never> =>
  ({ ok: false, error: typeof e === 'string' ? e : mapDbError(e) });

/** Session guard for server actions (pages redirect; actions return an error instead). */
export async function actionSession(area?: string, action = 'view'): Promise<{ s: Session } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: 'Please sign in again.' };
  if (area && !can(s, area, action)) return { error: 'You do not have permission to do this.' };
  return { s };
}

export type SupplierRow = {
  id: string; code: string; legal_name: string; country: string; city: string | null; supplier_type: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null; verified: boolean; main_categories: string | null;
  supplier_switches: { portal_login: boolean; product_upload: boolean; rfq_replies: boolean; listings_live: boolean; ai_tools: boolean } | null;
};

/** Suppliers a distributor manages (admins see all). RLS also restricts this to assigned suppliers. */
export async function getManagedSuppliers(s: Session): Promise<SupplierRow[]> {
  const sb = await createClient();
  let q = sb.from('suppliers')
    .select('id, code, legal_name, country, city, supplier_type, contact_name, contact_email, contact_phone, verified, main_categories, supplier_switches(portal_login, product_upload, rfq_replies, listings_live, ai_tools)')
    .is('archived_at', null).order('code');
  if (!s.isAdmin) {
    const { data: links } = await sb.from('distributor_suppliers').select('supplier_id').eq('distributor_id', s.userId);
    const ids = (links ?? []).map((l) => l.supplier_id as string);
    if (!ids.length) return [];
    q = q.in('id', ids);
  }
  const { data } = await q;
  return ((data ?? []) as unknown as (Omit<SupplierRow, 'supplier_switches'> & { supplier_switches: SupplierRow['supplier_switches'] | SupplierRow['supplier_switches'][] })[])
    .map((r) => ({ ...r, supplier_switches: Array.isArray(r.supplier_switches) ? r.supplier_switches[0] ?? null : r.supplier_switches }));
}

export async function managedSupplierIds(s: Session) {
  return (await getManagedSuppliers(s)).map((x) => x.id);
}

/** Single join → object (supabase may return arrays for embedded relations). */
export function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}
