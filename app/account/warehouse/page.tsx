import { Suspense } from 'react';
import Link from 'next/link';
import { ServiceStart } from '@/components/account/service-start';
import { PageSkeleton } from '@/components/shell/skeletons';
import { requireCustomer } from '@/lib/auth';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import { createClient } from '@/lib/supabase/server';
import { isWarehouseOsEnabled } from '@/lib/warehouse';
import { SendStock, type PortalAsn, type PortalSku } from './send-stock';

export const metadata = { title: '3PL warehouse' };

/** Warehouse OS client portal tabs (design §5). Overview and Send stock are live (W2a); the others say when they arrive. */
const TABS: { key: string; label: string; ships?: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'inventory', label: 'Inventory', ships: 'with stock receiving' },
  { key: 'orders', label: 'Orders', ships: 'with pick and pack' },
  { key: 'send', label: 'Send stock' },
  { key: 'returns', label: 'Returns', ships: 'with returns' },
  { key: 'invoices', label: 'Invoices', ships: 'with monthly invoicing' },
  { key: 'integrations', label: 'Integrations', ships: 'with store connections' },
  { key: 'support', label: 'Support', ships: '' },
];
const LIVE = new Set(['overview', 'send']);
const OPEN_ASN = ['submitted', 'booked', 'arrived', 'receiving'];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
/** today's date at the warehouse (China time), for the arrival date picker */
const chinaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

type Sb = Awaited<ReturnType<typeof createClient>>;
type LineRow = { id: string; asn_id: string; item_id: string; expected_qty: number; received_good: number | null; status: string };
type LotRow = { asn_line_id: string | null; qty: number };

async function loadInbound(sb: Sb, orgId: string) {
  const [asnRes, skuRes] = await Promise.all([
    sb.from('wh_asns').select('id, code, warehouse_code, expected_date, cartons, pallets, status, booked_slot_at, received_at, created_at')
      .eq('org_id', orgId).order('created_at', { ascending: false }).limit(100),
    sb.from('wh_client_skus').select('id, sku, name, item_id, status').eq('org_id', orgId).order('sku'),
  ]);
  const asnRows = (asnRes.data ?? []) as Omit<PortalAsn, 'lines' | 'checking'>[];
  const ids = asnRows.map((a) => a.id);
  const [lineRes, lotRes] = ids.length
    ? await Promise.all([
      sb.from('wh_asn_lines').select('id, asn_id, item_id, expected_qty, received_good, status').in('asn_id', ids),
      sb.from('wh_lots').select('asn_line_id, qty').eq('org_id', orgId).eq('status', 'blocked'),
    ])
    : [{ data: [] as LineRow[], error: null }, { data: [] as LotRow[], error: null }];
  const skus = (skuRes.data ?? []) as PortalSku[];
  const byItem = new Map(skus.map((s) => [s.item_id, s]));
  const lines = (lineRes.data ?? []) as LineRow[];
  const blockedQty = new Map(((lotRes.data ?? []) as LotRow[]).filter((t) => t.asn_line_id).map((t) => [t.asn_line_id as string, t.qty]));
  const asns: PortalAsn[] = asnRows.map((a) => {
    const own = lines.filter((l) => l.asn_id === a.id);
    return {
      ...a,
      lines: own.map((l) => ({ sku: byItem.get(l.item_id)?.sku ?? null, name: byItem.get(l.item_id)?.name ?? null, expected: l.expected_qty, good: l.received_good, status: l.status })),
      // a blocked lot (count differs) is being checked until a supervisor approves it; it is not in stock yet
      checking: own.filter((l) => l.status === 'blocked').reduce((n, l) => n + (blockedQty.get(l.id) ?? 0), 0),
    };
  });
  const failed = Boolean(asnRes.error || lineRes.error);
  const open = asns.filter((a) => OPEN_ASN.includes(a.status));
  const incoming = failed ? null : open.reduce((n, a) => n + a.lines.reduce((m, l) => m + l.expected, 0), 0);
  return { asns, skus, incoming, openCount: failed ? null : open.length };
}

async function Portal({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireCustomer('/account/warehouse');
  if (!s.org) return <ServiceStart service="warehouse" />;
  const sb = await createClient();
  // W1: an approved 3PL application for this email links to the company on first visit (switches the service on).
  const on = await isWarehouseOsEnabled();
  if (on) await sb.rpc('wh_claim_my_application');
  const [ctx, clientRes] = await Promise.all([
    getAccountContext(s.org.id),
    on ? sb.from('wh_clients').select('org_id, preferred_warehouse').eq('org_id', s.org.id).eq('status', 'active').maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!on || !(serviceOn(ctx.services.warehouse) || clientRes.data)) return <ServiceStart service="warehouse" />;
  const client = clientRes.data as { org_id: string; preferred_warehouse: string | null } | null;
  const sp = await searchParams;
  const tab = sp.tab && LIVE.has(sp.tab) ? sp.tab : 'overview';
  const weekStart = daysAgo(7);
  const [openRes, shippedRes, whRes, inbound] = await Promise.all([
    sb.from('shipments').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id).in('status', ['created', 'label_ready', 'picked_up']),
    sb.from('shipments').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id).in('status', ['in_transit', 'out_for_delivery', 'delivered']).gte('created_at', weekStart),
    sb.from('warehouses').select('code, name, city, is_default').eq('status', 'active').order('is_default', { ascending: false }).order('name'),
    loadInbound(sb, s.org.id),
  ]);
  const warehouses = (whRes.data ?? []) as { code: string; name: string; city: string; is_default: boolean }[];
  const tiles: [string, string, string][] = [
    ['Units in stock', '—', 'Your stock shows here once we receive it'],
    ['Open orders', openRes.count == null ? '—' : String(openRes.count), 'Being picked or packed'],
    ['Shipped this week', shippedRes.count == null ? '—' : String(shippedRes.count), 'Last 7 days'],
    ['Stock on its way in', inbound.incoming == null ? '—' : inbound.incoming.toLocaleString('en-US'),
      inbound.openCount == null ? 'Could not load your stock notices' : `${inbound.openCount} open stock notice${inbound.openCount === 1 ? '' : 's'}`],
  ];
  const defaultWarehouse = client?.preferred_warehouse && warehouses.some((w) => w.code === client.preferred_warehouse)
    ? client.preferred_warehouse : warehouses.find((w) => w.is_default)?.code ?? warehouses[0]?.code ?? '';
  const tabCls = 'px-4 min-h-11 inline-flex items-center whitespace-nowrap';
  return (
    <div className="max-w-[1160px]" data-testid="wh-portal">
      <div className="mono text-[11.5px] font-semibold uppercase tracking-[.1em] text-coral-text">3PL and logistics</div>
      <h1 className="text-[32px] font-extrabold leading-tight">Warehouse</h1>
      <nav aria-label="Warehouse portal" className="mt-4 flex gap-1 overflow-x-auto border-b border-line" data-testid="wh-portal-tabs">
        {TABS.map((t) => LIVE.has(t.key) ? (
          <Link key={t.key} href={t.key === 'overview' ? '/account/warehouse' : `/account/warehouse?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}
            className={`${tabCls} ${tab === t.key ? 'border-b-2 border-ink font-semibold' : 'text-black/75 hover:text-ink'}`} data-testid={`wh-tab-${t.key}`}>{t.label}</Link>
        ) : t.key === 'support' ? (
          <Link key={t.key} href="/account/support" className={`${tabCls} text-black/75 hover:text-ink`}>{t.label}</Link>
        ) : (
          <span key={t.key} aria-disabled="true" title={`Coming ${t.ships}`} className={`${tabCls} gap-1.5 text-black/60`}>
            {t.label}<span className="text-[10.5px] font-semibold uppercase tracking-wide text-black/60">soon</span>
          </span>
        ))}
      </nav>
      {tab === 'send' ? (
        client ? (
          <SendStock skus={inbound.skus} asns={inbound.asns} warehouses={warehouses.map((w) => ({ code: w.code, name: w.name }))}
            defaultWarehouse={defaultWarehouse} today={chinaToday()} />
        ) : (
          <section className="card p-5 mt-5">
            <h2 className="text-[18px] font-semibold m-0">Your 3PL account is being set up</h2>
            <p className="mt-2 mb-0 text-[14px] text-black/75">Stock notices open once your account is approved. Questions? <Link href="/account/support" className="underline">Contact support</Link>.</p>
          </section>
        )
      ) : (
        <>
          <section aria-label="Overview" className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {tiles.map(([label, value, sub]) => (
              <div key={label} className="card p-5" data-testid={`wh-portal-${label.toLowerCase().replace(/ /g, '-')}`}>
                <div className="text-[13px] text-black/75">{label}</div>
                <div className="text-[30px] font-bold leading-tight">{value}</div>
                <div className="text-[12.5px] text-black/70">{sub}</div>
              </div>
            ))}
          </section>
          {client && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/account/warehouse?tab=send" className="btn btn-primary" data-testid="wh-portal-send-shortcut">Send stock</Link>
            </div>
          )}
          <section className="card p-5 mt-5" aria-labelledby="wh-locs">
            <h2 id="wh-locs" className="text-[18px] font-semibold m-0">Our warehouses</h2>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 list-none p-0 m-0">
              {warehouses.map((w) => (
                <li key={w.code} className="rounded-[10px] border border-line p-3"><div className="font-semibold">{w.name}</div><div className="text-[13px] text-black/70">{w.city}, China</div></li>
              ))}
            </ul>
            <p className="mt-3 mb-0 text-[13.5px] text-black/75">Uploading orders opens with the next steps. Questions? <Link href="/account/support" className="underline">Contact support</Link>.</p>
          </section>
        </>
      )}
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ tab?: string }> }) {
  return <Suspense fallback={<PageSkeleton cards={2} table={false} />}><Portal {...props} /></Suspense>;
}
