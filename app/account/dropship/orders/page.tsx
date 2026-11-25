import { Suspense } from 'react';
import {
  DsBadge,
  DsCard,
  DsEmptyState,
  DsLinkButton,
  DsNotice,
  DsPageHeader,
} from '@/components/dropship-ui';
import { dropshipPausedOrClosed } from '@/lib/core/account';
import { fmtDate, money } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { merchantStatusLabels, tidyStatus } from '@/lib/status-labels';

export const metadata = { title: 'Orders · Octopus Dropship' };

async function Guarded() {
  const { session, ctx } = await requireDropshipV2Merchant('/account/dropship/orders');
  const sb = await createClient();
  const { data: orders } = await sb
    .from('store_orders')
    .select(
      'id, order_number, kind, channel, destination_country, shipping_method, incoterm, total_cents, payment_state, merchant_status, created_at, delivered_at',
    )
    .eq('org_id', session.org!.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const dsState = ctx.services.dropship;
  const rows = orders ?? [];
  const labels = await merchantStatusLabels();

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-orders-page">
      <DsPageHeader
        title="Orders"
        subtitle="Track store orders, sample orders, fulfilment status and delivery progress."
        icon="cart"
        actions={
          <DsLinkButton href="/account/invoices" variant="secondary" icon="file">
            Statements &amp; invoices
          </DsLinkButton>
        }
      />

      {dropshipPausedOrClosed(dsState) && (
        <DsNotice
          tone="info"
          title="Paid orders in progress continue shipping"
          testId="orders-paused-fulfilment-note"
        >
          Your Dropshipping service is currently {dsState.status === 'paused' ? 'paused' : 'closed'}
          {dsState.status_reason ? ` (${dsState.status_reason})` : ''}. Every paid order below
          continues through packing, shipping and delivery as normal.
        </DsNotice>
      )}

      {rows.length === 0 ? (
        <DsEmptyState
          title="No dropship orders yet"
          description="Paid store orders and sample orders appear here as soon as they are placed."
        />
      ) : (
        <DsCard noPadding>
          <div className="ds-scroll">
            <table className="ds-tbl min-w-[740px]" data-testid="merchant-store-orders-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Destination</th>
                  <th scope="col">Method</th>
                  <th scope="col">Total</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id as string} data-testid={`merchant-order-row-${o.order_number}`}>
                    <td className="font-mono font-semibold">{o.order_number as string}</td>
                    <td className="capitalize">{(o.kind as string) ?? 'store'}</td>
                    <td>{o.destination_country as string}</td>
                    <td className="capitalize">
                      {o.shipping_method as string} · {o.incoterm as string}
                    </td>
                    <td className="font-mono">{money(Number(o.total_cents ?? 0), 'USD')}</td>
                    <td>
                      <DsBadge
                        tone={
                          o.merchant_status === 'delivered'
                            ? 'ok'
                            : o.merchant_status === 'on_hold' || o.merchant_status === 'cancelled'
                              ? 'warn'
                              : 'info'
                        }
                      >
                        {labels[String(o.merchant_status ?? 'processing')] ?? tidyStatus(o.merchant_status as string)}
                      </DsBadge>
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(o.created_at as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DsCard>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
