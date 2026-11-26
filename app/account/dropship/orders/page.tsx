import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getOrdersPage, type OrdersPageData } from '@/lib/dropship-orders';
import { COUNTRY_NAMES } from '@/lib/format';
import { OrdersClient } from './orders-client';

export const metadata = { title: 'Orders · Octopus Dropship' };

/**
 * Release 3 · Step 8 — Orders (screens/Orders.html, mobile/M_Orders.html, states/States-Orders.html).
 * Data: ds_orders_page() — the merchant's own orders (Octopus lines only), the wallet bar (Available, Held), how each order
 * is paid and its hold with the exact reason. "Charge and ship" per order or in bulk, cancel, fix address — each through one
 * RPC. Orders reach this page from any source (store webhook / catch-up once a store is connected, CSV, API, staff test path).
 */
async function Orders() {
  const { ctx } = await requireDropshipV2Merchant('/account/dropship/orders');
  let data: OrdersPageData | null = null;
  let error: string | null = null;
  try {
    data = await getOrdersPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="dropship-orders-page">
        <h1 className="m-0 text-[26px] font-bold text-ink">Orders</h1>
        <DsNotice tone="bad" title="Orders could not be loaded" testId="orders-error"
          action={<DsLinkButton href="/account/dropship/orders" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  const ds = ctx.services.dropship;
  return (
    <OrdersClient
      data={data}
      countryNames={COUNTRY_NAMES}
      paused={data.dropship_status !== 'on' ? { status: data.dropship_status as 'paused' | 'off', reason: (ds?.status_reason as string | null | undefined) ?? null } : null}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="orders-loading"><DsSkeleton immediate /></div>}>
      <Orders />
    </Suspense>
  );
}
