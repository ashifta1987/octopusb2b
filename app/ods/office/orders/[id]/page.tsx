// ODS T9 · Order record (Part 7.6 record pattern: header + stepper + sticky tabs). Replaces the T8 re-export of
// app/office/orders/[id]/page.tsx inside the ODS Back Office frame. Same guard (requireStaff('orders','view')), same reads
// as today's order page (supplier, carrier, labels and supplier documents behind today's permissions), same actions:
// moves = today's transitionOrder, Record payment = today's recordPaymentStepUp behind the T8 two-person gate.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { approvalReadiness } from '@/lib/office/approvals';
import { OrderRecord } from '../_components/order-record';
import { OrderRecordSkeleton } from '../_components/order-record-skeleton';
import { loadOrderRecord } from '../_lib/order-data';
import { isOrderRecordTab, orderPerms } from '../_lib/order-core';
import { moveOrderAction, recordOrderPaymentAction } from '../actions';

export const metadata = { title: 'Order' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function OrderContent({ params, searchParams }: Props) {
  const { id } = await params;
  const s = await requireStaff('orders', 'view', `/office/orders/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const perms = orderPerms({ isAdmin: s.isAdmin, can: (a, x) => can(s, a, x) });
  const [data, readiness] = await Promise.all([loadOrderRecord(id, perms), perms.canPay ? approvalReadiness() : Promise.resolve(null)]);
  if (!data) notFound();
  const sp = await searchParams;
  const rawTab = first(sp.tab);
  return (
    <OrderRecord
      data={data}
      perms={perms}
      // two-person limit from settings; null while migration 255 is not applied (then today's flow runs as today)
      approvalLimitMinor={readiness && readiness.ok ? readiness.data.limitMinor : null}
      tab={isOrderRecordTab(rawTab) ? rawTab : 'overview'}
      payOpen={first(sp.pay) === '1'}
      actions={{ recordPayment: recordOrderPaymentAction, move: moveOrderAction }}
    />
  );
}

export default function OfficeOrderPage(props: Props) {
  return (
    <Suspense fallback={<OrderRecordSkeleton />}>
      <OrderContent {...props} />
    </Suspense>
  );
}
