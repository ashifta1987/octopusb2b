import 'server-only';
import { redirect } from 'next/navigation';
import { getSession, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Warehouse OS · W6 — who may open the monthly invoice run (/office/warehouse/invoices): warehouse admins and Finance preview,
 * Finance (or a company admin) issues. Finance people usually have no warehouse role, so this does not use
 * requireWarehouseStaff (which needs one); the database functions check again on every call.
 */
export type InvoiceAccess = { session: Session; preview: boolean; issue: boolean };

export async function requireInvoiceAccess(next: string): Promise<InvoiceAccess> {
  const s = await getSession();
  if (!s) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  if (!s.isStaff) redirect('/login');
  if (s.aal !== 'aal2') redirect(`/staff/verify?next=${encodeURIComponent(next)}`);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_invoice_access');
  if (error) throw new Error(`Could not check access: ${error.message}`);
  const a = (data ?? {}) as { preview?: boolean; issue?: boolean };
  if (!a.preview) redirect('/forbidden');
  return { session: s, preview: true, issue: Boolean(a.issue) };
}
