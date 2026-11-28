import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { isOrderRecordTab, ORDER_RECORD_TABS } from '@/app/ods/office/orders/_lib/order-core';
import { OrderFixture } from '../office-orders/_fixtures';
import { ORDER_ROLES, ORDER_STATES, SAMPLE_LIMIT, SAMPLE_ORDER_PERMS, isSampleRole, sampleOrderRecord, type OrderState } from '../office-orders/sample-data';

export const metadata: Metadata = { title: 'Order record · ODS Back Office screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-order';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Staging-only fixture (T9 batch 2): the ODS Order record inside the real Back Office frame, SAMPLE data.
 * `?tab=overview|items|documents|payments|shipping|messages|timeline`, `?role=finance|sales|admin`,
 * `?state=default|pay|second-approver|step-up|ready|delivered|disputed|cancelled|loading|error`.
 */
export default function OfficeOrderFixturePage({ searchParams }: { searchParams: SP }) {
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
  const role = isSampleRole(one(sp.role)) ? (one(sp.role) as 'finance' | 'sales' | 'admin') : 'finance';
  const state = (ORDER_STATES.find((s) => s === one(sp.state)) ?? 'default') as OrderState;
  const rawTab = one(sp.tab);
  const tab = isOrderRecordTab(rawTab) ? rawTab : state === 'pay' || state === 'second-approver' || state === 'step-up' ? 'payments' : 'overview';
  const perms = SAMPLE_ORDER_PERMS[role];
  const data = sampleOrderRecord(role, state);
  const link = (p: Record<string, string>) => `${BASE}?${new URLSearchParams({ role, state, tab, ...p }).toString()}`;
  const links = [
    ...ORDER_STATES.map((s) => ({ href: link({ state: s }), text: s, current: s === state })),
    ...ORDER_ROLES.map(([r, label]) => ({ href: link({ role: r }), text: `as ${label}`, current: r === role })),
    ...ORDER_RECORD_TABS.map((t) => ({ href: link({ tab: t }), text: `tab ${t}`, current: t === tab })),
  ];
  return (
    <OrderFixture
      role={role}
      links={links}
      loading={state === 'loading'}
      record={{
        data,
        perms,
        approvalLimitMinor: SAMPLE_LIMIT,
        tab,
        payOpen: state === 'pay' || state === 'second-approver' || state === 'step-up',
        initialPay:
          state === 'second-approver'
            ? { amount: '5520.00', reference: 'FT2611AE0091', outcome: { kind: 'second-approver', code: 'APR-00031', message: 'Second approver needed (APR-00031).' } }
            : undefined,
      }}
    />
  );
}
