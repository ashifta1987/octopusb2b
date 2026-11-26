import { Suspense } from 'react';
import { DsCard, DsLinkButton, DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { ORDER_STATUS, SOURCE_TEXT, type OrdersBoard } from '@/lib/warehouse-orders';
import { WhHeader } from '../wh-header';
import { OrdersClient } from './orders-client';

export const metadata = { title: 'Orders · Warehouse' };

const STATUSES = ['open', 'new', 'allocated', 'picking', 'picked', 'packing', 'exception', 'packed', 'cancelled'];
const SOURCES = ['client', 'dropship', 'client_portal', 'client_csv'];

/** Warehouse OS — every order to pick and pack (3PL client orders and Octopus Dropship orders), filtered by warehouse, status, source. */
async function Content({ searchParams }: { searchParams: Promise<{ status?: string; source?: string; q?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/orders');
  const sp = await searchParams;
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : 'open';
  const source = sp.source && SOURCES.includes(sp.source) ? sp.source : '';
  const q = (sp.q ?? '').trim().slice(0, 64);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_orders_board', {
    p_warehouse: access.current?.code ?? null, p_status: status, p_source: source || null, p_q: q || null,
  });
  if (error) throw new Error(`Could not load orders: ${error.message}`);
  const board = data as OrdersBoard;
  return (
    <div className="flex flex-col gap-5" data-testid="wh-orders-page">
      <WhHeader access={access} title="Orders" icon="cart"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · client orders and Octopus Dropship orders, from received to packed.`}
        actions={<>
          <DsLinkButton href="/office/warehouse/pick" variant="secondary" icon="list" testId="wh-go-pick">Picking</DsLinkButton>
          <DsLinkButton href="/office/warehouse/pack" variant="secondary" icon="package" testId="wh-go-pack">Packing station</DsLinkButton>
        </>} />
      <DsCard testId="wh-orders-filters">
        <form method="get" className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col text-[13px]"><span className="ds-label">Status</span>
            <select name="status" defaultValue={status} className="ds-input min-h-[44px]">
              <option value="open">All open</option>
              {STATUSES.filter((s) => s !== 'open').map((s) => <option key={s} value={s}>{ORDER_STATUS[s]?.[0] ?? s}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-[13px]"><span className="ds-label">Source</span>
            <select name="source" defaultValue={source} className="ds-input min-h-[44px]">
              <option value="">All sources</option>
              <option value="client">3PL clients</option>
              {SOURCES.filter((s) => s !== 'client').map((s) => <option key={s} value={s}>{SOURCE_TEXT[s]}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-[13px]"><span className="ds-label">Order number</span>
            <input name="q" defaultValue={q} placeholder="WO-000123, client ref or DSO-…" className="ds-input min-h-[44px]" autoComplete="off" />
          </label>
          <div><button type="submit" className="ds-btn ds-btn-secondary min-h-[44px]" data-testid="wh-orders-filter">Show</button></div>
        </form>
      </DsCard>
      <OrdersClient board={board} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ status?: string; source?: string; q?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
