// ODS T9 · Back Office › Orders (Part 7.6 list pattern, grid per 7.2). Replaces the T8 re-export of app/office/orders/page.tsx
// inside the ODS Back Office frame. Same guard as today (requireStaff('orders','view')), same division scope (header
// switcher), same orders columns read with the session client; supplier code only with the supplier permission.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { getDivisionScope } from '@/lib/divisions/scope';
import { OrdersScreen } from './_components/orders-screen';
import { loadOrderList } from './_lib/order-data';
import { DEFAULT_QUERY, ORDERS_PATH, orderPerms, parseOrderQuery } from './_lib/order-core';

export const metadata = { title: 'Orders' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function OrdersContent({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('orders', 'view', ORDERS_PATH);
  const scope = await getDivisionScope(s); // divisions step 4: header switcher, as today
  const query = parseOrderQuery(await searchParams);
  const perms = orderPerms({ isAdmin: s.isAdmin, can: (a, x) => can(s, a, x) });
  const list = await loadOrderList(query, scope, perms);
  return (
    <OrdersScreen
      query={query}
      result={list.ok ? { kind: 'ok', data: list.data } : { kind: 'error', error: list.error, kpis: list.kpis }}
      perms={{ canPay: perms.canPay }}
    />
  );
}

export default function OfficeOrdersPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<OrdersScreen query={DEFAULT_QUERY} result={{ kind: 'loading' }} perms={{ canPay: false }} />}>
      <OrdersContent searchParams={searchParams} />
    </Suspense>
  );
}
