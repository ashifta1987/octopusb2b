import { Suspense } from 'react';
import type { Metadata } from 'next';
import { OrderDetailSkeleton, OrderDetailView, parseOrderTab } from '@/app/ods/account/orders/_components/order-detail-view';
import { CommerceFixture, pick } from '../account-orders/_fixture';
import {
  SAMPLE_ORDER,
  SAMPLE_ORDER_CANCELLED,
  SAMPLE_ORDER_CREDIT,
  SAMPLE_ORDER_DEPOSIT,
  SAMPLE_ORDER_PANEL_ERRORS,
  SAMPLE_ORDER_PROTECTED,
  SAMPLE_ORDER_SHIPPED,
} from '../account-orders/_samples';
import { sampleCancelOrder, sampleConfirmPayLater, sampleOpenDispute, samplePayFromWallet, samplePayWithProtection, sampleStartOnlineCheckout } from '../account-orders/fixture-actions';

export const metadata: Metadata = { title: 'Order detail · ODS fixtures (staging)', robots: { index: false, follow: false } };

const BASE = '/dev/ui/screens/account-order';
const STATES = [
  ['balance-due', 'Balance due'],
  ['deposit-due', 'Deposit due (just accepted)'],
  ['protected', 'Payment protection held'],
  ['credit-eligible', 'Credit-eligible company'],
  ['shipped', 'Shipped'],
  ['cancelled', 'Cancelled'],
  ['panel-errors', 'Panels failed'],
  ['loading', 'Loading'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;

const ORDERS = {
  'balance-due': SAMPLE_ORDER,
  'deposit-due': SAMPLE_ORDER_DEPOSIT,
  protected: SAMPLE_ORDER_PROTECTED,
  'credit-eligible': SAMPLE_ORDER_CREDIT,
  shipped: SAMPLE_ORDER_SHIPPED,
  cancelled: SAMPLE_ORDER_CANCELLED,
  'panel-errors': SAMPLE_ORDER_PANEL_ERRORS,
  loading: SAMPLE_ORDER,
} as const;

/** /account/orders/[ref] with SAMPLE props (?state=, ?tab=). Pay buttons call sample stubs: nothing is charged. */
export default function OrderFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = pick(sp.state, STATES);
  const tab = parseOrderTab(Array.isArray(sp.tab) ? sp.tab[0] : sp.tab);
  return (
    <CommerceFixture path="/account/orders" base={BASE} states={STATES} current={current}>
      {current === 'loading' ? (
        <OrderDetailSkeleton />
      ) : (
        <OrderDetailView
          order={ORDERS[current]}
          tab={tab}
          actions={{
            payFromWallet: samplePayFromWallet,
            cancelOrder: sampleCancelOrder,
            startOnlineCheckout: sampleStartOnlineCheckout,
            payWithProtectionFromWallet: samplePayWithProtection,
            openDispute: sampleOpenDispute,
            confirmPayLater: sampleConfirmPayLater,
          }}
        />
      )}
    </CommerceFixture>
  );
}
