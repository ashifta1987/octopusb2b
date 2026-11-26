import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getOrderDetail, type OrderDetail } from '@/lib/dropship-problems';
import { COUNTRY_NAMES } from '@/lib/format';
import { OrderDetailClient } from './order-detail-client';

export const metadata = { title: 'Order detail · Octopus Dropship' };

/**
 * Release 4 · Step 10 — Order detail and problems (screens/OrderDetail.html, mobile/M_OrderDetail.html, states/States-Orders.html).
 * Data: ds10_order_detail() — own organisation only. Items (Octopus lines + "not from Octopus" count), progress + timeline
 * (Dropship events, warehouse milestones, carrier tracking, claim / return steps, re-weigh), cost lines with Processing on its
 * own line, payment, ship-to, what can be done now (cancel until packed, address until the label, lost / damaged after
 * handover, return after delivery) and why not, claims with their stepper, the re-weigh charge with photo + dispute.
 */
async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session } = await requireDropshipV2Merchant('/account/dropship/orders');
  let d: OrderDetail | null = null;
  let error: string | null = null;
  let missing = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!missing) {
    try {
      d = await getOrderDetail(id);
    } catch (e) {
      if (/NOT_FOUND/.test(e instanceof Error ? e.message : '')) missing = true;
      else error = rpcMessage(e);
    }
  }
  if (!d) {
    return (
      <div className="flex flex-col gap-5" data-testid="order-detail-page">
        <h1 className="m-0 text-[26px] font-bold text-ink">Order detail</h1>
        {missing ? (
          <DsNotice tone="info" title="This order was not found" testId="order-detail-missing"
            action={<DsLinkButton href="/account/dropship/orders" variant="secondary">Back to orders</DsLinkButton>}>
            It may belong to another company or the link is wrong. Your orders are on the Orders page.
          </DsNotice>
        ) : (
          <DsNotice tone="bad" title="This order could not be loaded" testId="order-detail-error"
            action={<DsLinkButton href={`/account/dropship/orders/${id}`} variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
        )}
      </div>
    );
  }
  return <OrderDetailClient detail={d} orgId={session.org!.id} countryNames={COUNTRY_NAMES} />;
}

export default function Page(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="order-detail-loading"><DsSkeleton /></div>}>
      <Detail {...props} />
    </Suspense>
  );
}
