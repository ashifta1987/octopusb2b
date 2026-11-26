import { Suspense } from 'react';
import { DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSupOrders, type SupOrders } from '@/lib/dropship-ds14';
import { SupplierFrame } from '../frame';
import { OrdersClient } from './orders-client';

export const metadata = { title: 'Orders to ship · Supplier portal' };

/** SupplierOrders.html: orders to ship with the buyer's address (never the merchant), carrier, tracking, Octopus packing slip, mark shipped. */
async function Guarded() {
  let data: SupOrders | null = null;
  let error: string | null = null;
  try { data = await getSupOrders(); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <SupplierFrame testId="supplier-orders-page">
        <DsPageHeader title="Orders to ship" icon="truck" />
        <DsNotice tone="bad" title="Orders could not be loaded" testId="supplier-error">{error}</DsNotice>
      </SupplierFrame>
    );
  }
  return <OrdersClient data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-v2 ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
