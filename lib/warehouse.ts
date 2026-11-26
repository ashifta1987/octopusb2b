import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Warehouse OS · W0 — multi-warehouse staff guard and the warehouse switcher choice (cookie, validated per request).
 * Row-level security and the wh_* database functions decide what is allowed; this only narrows the view.
 */
export const WH_COOKIE = 'wh_scope';

export type WarehouseOption = { code: string; name: string; city: string; status: string; is_default: boolean; role: string | null };
export type WarehouseAccess = {
  session: Session;
  warehouses: WarehouseOption[];
  /** null = all warehouses the person works in */
  current: WarehouseOption | null;
  canSeeAll: boolean;
  isAdmin: boolean;
};

export async function requireWarehouseStaff(next: string): Promise<WarehouseAccess> {
  const s = await getSession();
  if (!s) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  if (!s.isStaff) redirect('/login');
  if (s.aal !== 'aal2') redirect(`/staff/verify?next=${encodeURIComponent(next)}`);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_my_warehouses');
  if (error) throw new Error(`Could not load warehouses: ${error.message}`);
  const warehouses = (data ?? []) as WarehouseOption[];
  if (warehouses.length === 0) redirect('/forbidden');
  const chosen = (await cookies()).get(WH_COOKIE)?.value;
  const canSeeAll = warehouses.length > 1;
  let current = chosen && chosen !== 'all' ? warehouses.find((w) => w.code === chosen) ?? null : null;
  if (!current && !canSeeAll) current = warehouses[0];
  return { session: s, warehouses, current, canSeeAll, isAdmin: s.isAdmin };
}

export const ROLE_LABEL: Record<string, string> = {
  packer: 'Packer', receiver: 'Receiver', supervisor: 'Supervisor', admin: 'Admin', viewer: 'Viewer',
};
