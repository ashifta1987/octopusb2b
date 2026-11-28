import { Suspense } from 'react';
import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { buildOrdersList, parseOrdersParams } from './_lib/order-logic';
import { loadOrderRows } from './_lib/loaders';
import type { SearchParamsRecord } from './_lib/commerce-format';
import { OrdersView } from './_components/orders-view';

export const metadata: Metadata = { title: 'Orders', robots: { index: false, follow: false } };

/**
 * ODS /account/orders (Part 6.5). URL state: ?status=all|waiting|production|shipped, ?service=, ?view=list|board, ?sort=,
 * ?page=, ?q= (topbar search). Data: today's orders query (customer-safe columns) + divisions + shipments (loaders.ts).
 * The list fails on its own (ErrorState with Try again; the frame keeps working).
 */
export default function OdsOrdersPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<OrdersView state={parseOrdersParams({})} status="loading" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const state = parseOrdersParams(await searchParams);
  let rows = null;
  try {
    rows = await loadOrderRows();
  } catch (e) {
    unstable_rethrow(e);
    rows = null;
  }
  return <OrdersView state={state} status={rows ? 'ready' : 'error'} list={rows ? buildOrdersList(rows, state) : null} />;
}
