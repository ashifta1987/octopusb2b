import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { parseOrderQuery, queryOrderRows, showSupplierCodes, tabCounts } from '@/app/ods/office/orders/_lib/order-core';
import type { OrdersResult } from '@/app/ods/office/orders/_components/orders-screen';
import { OrdersFixture } from './_fixtures';
import { ORDER_ROLES, SAMPLE_ORDER_KPIS, SAMPLE_ORDER_PERMS, isSampleRole, sampleOrderRows } from './sample-data';

export const metadata: Metadata = { title: 'Orders · ODS Back Office screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-orders';
const STATES = ['list', 'bulk', 'empty', 'error', 'loading', 'no-permission'] as const;
type State = (typeof STATES)[number];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Staging-only fixture (T9 batch 2): Back Office › Orders inside the real ODS Back Office frame, SAMPLE data only.
 * `?state=list | bulk | empty | error | loading | no-permission`, `?role=finance | sales | admin`; tabs, search, Step /
 * Customer filters, sort and pages work on the sample rows with the same pure rules the live page applies on the server.
 */
export default function OfficeOrdersFixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = isSampleRole(one(sp.role)) ? (one(sp.role) as 'finance' | 'sales' | 'admin') : 'sales';
  const state = (STATES.find((s) => s === one(sp.state)) ?? 'list') as State;
  const perms = SAMPLE_ORDER_PERMS[role];
  const parsed = parseOrderQuery(sp);
  const query = state === 'empty' && sp.q === undefined ? { ...parsed, q: 'Nordic' } : parsed;
  const all = sampleOrderRows(showSupplierCodes(perms.canSeeSuppliers));
  const page = queryOrderRows(all, query);
  const result: OrdersResult =
    state === 'loading'
      ? { kind: 'loading' }
      : state === 'error'
        ? { kind: 'error', error: 'We couldn’t load the orders. Try again.', kpis: SAMPLE_ORDER_KPIS }
        : state === 'no-permission'
          ? { kind: 'forbidden' }
          : { kind: 'ok', data: { rows: page.rows, total: page.total, counts: tabCounts(all), kpis: SAMPLE_ORDER_KPIS, updatedAt: new Date(getNowMs() - 120_000).toISOString(), allUsd: page.rows.every((r) => r.currency === 'USD'), supplierColumn: showSupplierCodes(perms.canSeeSuppliers) } };
  const links = [
    ...STATES.map((s) => ({ href: `${BASE}?state=${s}&role=${role}`, text: s, current: s === state })),
    ...ORDER_ROLES.map(([r, label]) => ({ href: `${BASE}?state=${state}&role=${r}`, text: `as ${label}`, current: r === role })),
  ];
  return (
    <OrdersFixture
      role={role}
      links={links}
      screen={{ basePath: BASE, extraParams: { state, role }, query, result, perms: { canPay: perms.canPay }, initialSelected: state === 'bulk' ? [all[0].id, all[1].id] : undefined }}
    />
  );
}
