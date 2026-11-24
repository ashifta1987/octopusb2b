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
export type ServiceState = {
  status: 'off' | 'trial' | 'on' | 'paused';
  plan: string | null;
  started_at: string | null;
  status_reason?: string | null;
};
export type Manager = { name: string; office: string | null; title: string | null; email: string | null } | null;
export type WalletSummary = { reference: string; available_cents: number; on_hold_cents: number; pending_transfers_cents: number };

/** APP_ENVIRONMENT (Vercel env setting): 'staging' on preview deployments; unset/'production' on live → no badge. */
export const isStaging = () => process.env.APP_ENVIRONMENT === 'staging';

export async function getAccountContext(orgId: string) {
  const sb = await createClient();
  const [services, wallet, manager, unread] = await Promise.all([
    sb.from('company_services').select('service, status, status_reason, plan, started_at').eq('org_id', orgId),
    sb.rpc('my_wallet_summary'),
    sb.rpc('my_account_team'),
    // bug 1 (8 Nov 2026): same source as the Notifications list — my_notifications(), unread = read_at empty, every type
    sb.rpc('my_notifications', undefined, { count: 'exact', head: true }).is('read_at', null),
  ]);
  const state = Object.fromEntries(
    SERVICES.map((s) => [s.key, { status: 'off', plan: null, started_at: null, status_reason: null } as ServiceState]),
  ) as Record<ServiceKey, ServiceState>;
  (services.data ?? []).forEach((r) => {
    if (r.service in state) {
      // Step 4 Correction 2: dropship status is 'on' | 'paused' | 'off' ONLY; map any legacy 'trial' to 'on'.
      const normStatus = r.service === 'dropship' && r.status === 'trial' ? 'on' : r.status;
      state[r.service as ServiceKey] = {
        status: normStatus,
        plan: r.plan,
        started_at: r.started_at,
        status_reason: (r as { status_reason?: string | null }).status_reason ?? null,
      } as ServiceState;
    }
  });
  // my_account_team(): name, title, office and email of the company's account manager (no other staff data)
  const m = manager.data as { name: string | null; office: string | null; title: string | null; email: string | null } | null;
  const mgr: Manager = m?.name ? { name: m.name, office: m.office, title: m.title, email: m.email } : null;
  return {
    services: state,
    onCount: Object.entries(state).filter(([k, s]) => (k === 'dropship' ? s.status === 'on' : s.status === 'on' || s.status === 'trial')).length,
    wallet: (wallet.data ?? null) as WalletSummary | null,
    manager: mgr,
    unread: unread.count ?? 0,
  };
}

export const serviceOn = (s: ServiceState) => s.status === 'on' || s.status === 'trial';
/** Step 4 Correction 2: Dropship access has no 'trial' — only 'on' | 'paused' | 'off'. */
export const dropshipOn = (s: ServiceState) => s.status === 'on';
/** Step 4 Correction 1: True for active, paused, or closed (previously-enabled) dropship merchants. */
export const dropshipEverEnabled = (s: ServiceState) =>
  s.status === 'on' || s.status === 'paused' || Boolean(s.started_at);
export const dropshipPausedOrClosed = (s: ServiceState) =>
  s.status === 'paused' || (s.status === 'off' && Boolean(s.started_at));

/** time helpers kept out of components (request-time pages; keeps render code free of impure calls) */
export const nowIso = () => new Date().toISOString();
export const withinDays = (iso: string, days: number) => Date.now() - Date.parse(iso) < days * 864e5;
