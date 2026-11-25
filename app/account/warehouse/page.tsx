import { Suspense } from 'react';
import Link from 'next/link';
import { ServiceStart } from '@/components/account/service-start';
import { PageSkeleton } from '@/components/shell/skeletons';
import { requireCustomer } from '@/lib/auth';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import { createClient } from '@/lib/supabase/server';
import { isWarehouseOsEnabled } from '@/lib/warehouse';

export const metadata = { title: '3PL warehouse' };

/** Warehouse OS client portal tabs (design §5). Only Overview is live in W0; the others say when they arrive. */
const TABS: { key: string; label: string; ships?: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'inventory', label: 'Inventory', ships: 'with stock receiving' },
  { key: 'orders', label: 'Orders', ships: 'with pick and pack' },
  { key: 'send', label: 'Send stock', ships: 'with stock receiving' },
  { key: 'returns', label: 'Returns', ships: 'with returns' },
  { key: 'invoices', label: 'Invoices', ships: 'with monthly invoicing' },
  { key: 'integrations', label: 'Integrations', ships: 'with store connections' },
  { key: 'support', label: 'Support', ships: '' },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function Portal() {
  const s = await requireCustomer('/account/warehouse');
  if (!s.org) return <ServiceStart service="warehouse" />;
  const sb = await createClient();
  // W1: an approved 3PL application for this email links to the company on first visit (switches the service on).
  const on = await isWarehouseOsEnabled();
  if (on) await sb.rpc('wh_claim_my_application');
  const [ctx, clientRes] = await Promise.all([
    getAccountContext(s.org.id),
    on ? sb.from('wh_clients').select('org_id').eq('org_id', s.org.id).eq('status', 'active').maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!on || !(serviceOn(ctx.services.warehouse) || clientRes.data)) return <ServiceStart service="warehouse" />;
  const weekStart = daysAgo(7);
  const [openRes, shippedRes, whRes] = await Promise.all([
    sb.from('shipments').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id).in('status', ['created', 'label_ready', 'picked_up']),
    sb.from('shipments').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id).in('status', ['in_transit', 'out_for_delivery', 'delivered']).gte('created_at', weekStart),
    sb.from('warehouses').select('code, name, city').eq('status', 'active').order('is_default', { ascending: false }).order('name'),
  ]);
  const warehouses = (whRes.data ?? []) as { code: string; name: string; city: string }[];
  const tiles: [string, string, string][] = [
    ['Units in stock', '—', 'Your stock shows here once we receive it'],
    ['Open orders', openRes.count == null ? '—' : String(openRes.count), 'Being picked or packed'],
    ['Shipped this week', shippedRes.count == null ? '—' : String(shippedRes.count), 'Last 7 days'],
    ['Stock on its way in', '—', 'Stock notices arrive with stock receiving'],
  ];
  return (
    <div className="max-w-[1160px]" data-testid="wh-portal">
      <div className="mono text-[11.5px] font-semibold uppercase tracking-[.1em] text-coral-text">3PL and logistics</div>
      <h1 className="text-[32px] font-extrabold leading-tight">Warehouse</h1>
      <nav aria-label="Warehouse portal" className="mt-4 flex gap-1 overflow-x-auto border-b border-line" data-testid="wh-portal-tabs">
        {TABS.map((t) => t.key === 'overview' ? (
          <span key={t.key} aria-current="page" className="px-4 min-h-11 inline-flex items-center border-b-2 border-ink font-semibold whitespace-nowrap">{t.label}</span>
        ) : t.key === 'support' ? (
          <Link key={t.key} href="/account/support" className="px-4 min-h-11 inline-flex items-center text-black/75 hover:text-ink whitespace-nowrap">{t.label}</Link>
        ) : (
          <span key={t.key} aria-disabled="true" title={`Coming ${t.ships}`} className="px-4 min-h-11 inline-flex items-center gap-1.5 text-black/60 whitespace-nowrap">
            {t.label}<span className="text-[10.5px] font-semibold uppercase tracking-wide text-black/60">soon</span>
          </span>
        ))}
      </nav>
      <section aria-label="Overview" className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="card p-5" data-testid={`wh-portal-${label.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-black/75">{label}</div>
            <div className="text-[30px] font-bold leading-tight">{value}</div>
            <div className="text-[12.5px] text-black/70">{sub}</div>
          </div>
        ))}
      </section>
      <section className="card p-5 mt-5" aria-labelledby="wh-locs">
        <h2 id="wh-locs" className="text-[18px] font-semibold m-0">Our warehouses</h2>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 list-none p-0 m-0">
          {warehouses.map((w) => (
            <li key={w.code} className="rounded-[10px] border border-line p-3"><div className="font-semibold">{w.name}</div><div className="text-[13px] text-black/70">{w.city}, China</div></li>
          ))}
        </ul>
        <p className="mt-3 mb-0 text-[13.5px] text-black/75">Sending stock and uploading orders open with the next steps. Questions? <Link href="/account/support" className="underline">Contact support</Link>.</p>
      </section>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<PageSkeleton cards={2} table={false} />}><Portal /></Suspense>;
}
