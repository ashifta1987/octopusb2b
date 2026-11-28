import { Suspense } from 'react';
import type { Metadata } from 'next';
import { OrdersView } from '@/app/ods/account/orders/_components/orders-view';
import { buildOrdersList, parseOrdersParams } from '@/app/ods/account/orders/_lib/order-logic';
import { CommerceFixture, pick } from './_fixture';
import { SAMPLE_ORDER_ROWS } from './_samples';

export const metadata: Metadata = { title: 'Orders · ODS fixtures (staging)', robots: { index: false, follow: false } };

const BASE = '/dev/ui/screens/account-orders';
const STATES = [
  ['list', 'List'],
  ['board', 'Board'],
  ['waiting', 'Waiting for you'],
  ['no-match', 'No match'],
  ['empty', 'No orders yet'],
  ['error', 'Failed to load'],
  ['loading', 'Loading'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;

/** /account/orders with SAMPLE props in every state (?state=). Filters, view, sort and page also work (URL). */
export default function OrdersFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = pick(sp.state, STATES);
  const base = parseOrdersParams(sp);
  const state = current === 'board' ? { ...base, view: 'board' as const } : current === 'waiting' ? { ...base, status: 'waiting' as const } : current === 'no-match' ? { ...base, q: 'teapot' } : base;
  const rows = current === 'empty' ? [] : SAMPLE_ORDER_ROWS;
  return (
    <CommerceFixture path="/account/orders" base={BASE} states={STATES} current={current}>
      <OrdersView state={state} status={current === 'loading' ? 'loading' : current === 'error' ? 'error' : 'ready'} list={current === 'error' ? null : buildOrdersList(rows, state)} base={BASE} />
    </CommerceFixture>
  );
}
