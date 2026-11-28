import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { payFromWallet, cancelOrder } from '@/app/account/orders/actions';
import { startOnlineCheckoutAction, payWithProtectionFromWalletAction, openPaymentProtectionDisputeAction, confirmPayLaterAction } from '@/app/account/payment-actions';
import { loadOrderDetail } from '../_lib/loaders';
import { one, type SearchParamsRecord } from '../_lib/commerce-format';
import { OrderDetailSkeleton, OrderDetailView, parseOrderTab } from '../_components/order-detail-view';

export const metadata: Metadata = { title: 'Order', robots: { index: false, follow: false } };

/**
 * ODS /account/orders/[ref] (Part 6.5). `ref` = the order code (OCT-…) or today's id. ?tab= keeps the open tab.
 * Money actions are TODAY's, unchanged: payFromWallet + cancelOrder (app/account/orders/actions.ts) and
 * startOnlineCheckoutAction / payWithProtectionFromWalletAction / openPaymentProtectionDisputeAction
 * (app/account/payment-actions.ts); confirmPayLaterAction (checkout_pay_later) for credit-eligible companies only, with
 * today's ChooseHowToPay conditions (payLaterChoice) — absent for everyone else.
 */
export default function OdsOrderDetailPage(props: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<OrderDetailSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const order = await loadOrderDetail(decodeURIComponent(ref), { created: !!one(sp.created) });
  if (!order) notFound();
  return (
    <OrderDetailView
      order={order}
      tab={parseOrderTab(one(sp.tab))}
      actions={{
        payFromWallet,
        cancelOrder,
        startOnlineCheckout: startOnlineCheckoutAction,
        payWithProtectionFromWallet: payWithProtectionFromWalletAction,
        openDispute: openPaymentProtectionDisputeAction,
        confirmPayLater: confirmPayLaterAction,
      }}
    />
  );
}
