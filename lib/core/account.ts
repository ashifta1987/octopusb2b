import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** ADDON-41 — data every My account page needs (header wallet, service tabs, account manager card). Reads under RLS. */
export const SERVICES = [
  { key: 'sourcing', label: 'Sourcing', href: '/account/sourcing' },
  { key: 'dropship', label: 'Dropshipping', href: '/account/dropship' },
  { key: 'warehouse', label: '3PL warehouse', href: '/account/warehouse' },
  { key: 'brand', label: 'Make My Brand', href: '/account/brand' },
] as const;
export type ServiceKey = (typeof SERVICES)[number]['key'];
export type ServiceState = { status: 'off' | 'trial' | 'on' | 'paused'; plan: string | null; started_at: string | null };
export type Manager = { name: string; office: string | null; title: string | null; email: string | null } | null;
export type WalletSummary = { reference: string; available_cents: number; on_hold_cents: number; pending_transfers_cents: number };

export const isStaging = () => process.env.APP_ENVIRONMENT === 'staging';

export async function getAccountContext(orgId: string) {
  const sb = await createClient();
  const [services, wallet, manager, unread] = await Promise.all([
    sb.from('company_services').select('service, status, plan, started_at').eq('org_id', orgId),
    sb.rpc('my_wallet_summary'),
    sb.rpc('my_account_team'),
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('read_at', null),
  ]);
  const state = Object.fromEntries(SERVICES.map((s) => [s.key, { status: 'off', plan: null, started_at: null } as ServiceState])) as Record<ServiceKey, ServiceState>;
  (services.data ?? []).forEach((r) => { if (r.service in state) state[r.service as ServiceKey] = { status: r.status, plan: r.plan, started_at: r.started_at } as ServiceState; });
  // my_account_team(): name, title, office and email of the company's account manager (no other staff data)
  const m = manager.data as { name: string | null; office: string | null; title: string | null; email: string | null } | null;
  const mgr: Manager = m?.name ? { name: m.name, office: m.office, title: m.title, email: m.email } : null;
  return {
    services: state,
    onCount: Object.values(state).filter((s) => s.status === 'on' || s.status === 'trial').length,
    wallet: (wallet.data ?? null) as WalletSummary | null,
    manager: mgr,
    unread: unread.count ?? 0,
  };
}

export const serviceOn = (s: ServiceState) => s.status === 'on' || s.status === 'trial';

/** time helpers kept out of components (request-time pages; keeps render code free of impure calls) */
export const nowIso = () => new Date().toISOString();
export const withinDays = (iso: string, days: number) => Date.now() - Date.parse(iso) < days * 864e5;
