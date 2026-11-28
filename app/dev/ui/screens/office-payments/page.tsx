import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { PAYMENTS_SPEC, parseListQuery, type PaymentRow } from '@/app/ods/office/accounts/_shared/accounts-core';
import { PaymentsFixture, StateNav } from '../_accounts-c-fixture';
import { ACCOUNTS_C_STATES, SAMPLE_PAYMENTS, sampleResult, type AccountsCState } from '../_accounts-c-sample';

export const metadata: Metadata = { title: 'Payments · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-payments';
const inTab = (r: PaymentRow, tab: string) => (tab === 'proformas' ? r.source === 'document_payment' : r.source === 'payment');

/** Staging-only fixture (T9): Accounts › Payments with SAMPLE rows. ?state=list | drawer | empty | error | loading | no-permission. */
export default function Page({ searchParams }: { searchParams: SP }) {
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
  const state = (ACCOUNTS_C_STATES.find(([s]) => s === sp.state)?.[0] ?? 'list') as AccountsCState;
  const p = parseListQuery(sp, PAYMENTS_SPEC);
  const query = { ...p, q: state === 'empty' && !p.q ? 'FT0000000000' : p.q, open: p.open ?? (state === 'drawer' ? SAMPLE_PAYMENTS[0].id : null) };
  const result = sampleResult(state, SAMPLE_PAYMENTS, query, inTab, PAYMENTS_SPEC.tabs, getNowMs());
  return <PaymentsFixture nav={<StateNav base={BASE} state={state} states={ACCOUNTS_C_STATES} />} screen={{ basePath: BASE, extraParams: { state }, query, result, exportMonth: '2026-11' }} />;
}
