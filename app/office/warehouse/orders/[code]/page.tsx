import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { signEvidence } from '@/lib/warehouse-evidence';
import type { OrderDetail } from '@/lib/warehouse-orders';
import { WhHeader } from '../../wh-header';
import { OrderDetailClient } from './order-detail-client';

export const metadata = { title: 'Order · Warehouse' };

/** Warehouse OS board 3 — one order: lines, picks, box, expected / measured / volumetric weight, proof and history. */
async function Content({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ref = decodeURIComponent(code);
  const access = await requireWarehouseStaff(`/office/warehouse/orders/${encodeURIComponent(ref)}`);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_order_detail', { p_ref: ref });
  if (error) {
    if (/NOT_FOUND/.test(error.message)) notFound();
    throw new Error(`Could not load the order: ${error.message}`);
  }
  const d = data as OrderDetail;
  const urls = await signEvidence(sb, d.evidence.map((e) => e.path));
  d.evidence = d.evidence.map((e) => ({ ...e, url: urls.get(e.path) ?? null }));
  const wh = access.warehouses.find((w) => w.code === d.order.warehouse_code);
  return (
    <div className="flex flex-col gap-4" data-testid="wh-order-page">
      <WhHeader access={access} title={`Order ${d.order.code}`} icon="cart"
        subtitle={`${d.order.owner} · ${wh?.name ?? d.order.warehouse_code}${d.order.store_order ? ` · Dropship ${d.order.store_order}` : d.order.external_ref ? ` · client ref ${d.order.external_ref}` : ''}`} />
      <OrderDetailClient detail={d} />
    </div>
  );
}

export default function Page(props: { params: Promise<{ code: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
