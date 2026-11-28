import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { LEDGER_SPEC, parseListQuery, type LedgerRow } from '@/app/ods/office/accounts/_shared/accounts-core';
import { LedgerFixture, StateNav } from '../_accounts-c-fixture';
import { ACCOUNTS_C_STATES, SAMPLE_ACCOUNTS, sampleLedger, sampleResult, type AccountsCState } from '../_accounts-c-sample';

export const metadata: Metadata = { title: 'Ledger · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-ledger';
const STATES = [...ACCOUNTS_C_STATES, ['account', 'One account (running balance)']] as const;

/** Staging-only fixture (T9): Accounts › Ledger with SAMPLE lines. ?state=list | drawer | empty | error | loading | no-permission | account. */
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
  const raw = STATES.find(([s]) => s === sp.state)?.[0] ?? 'list';
  const account = raw === 'account';
  const state = (account ? 'list' : raw) as AccountsCState;
  const p = parseListQuery(sp, LEDGER_SPEC);
  const query = { ...p, q: state === 'empty' && !p.q ? 'JRN-999999' : p.q, open: p.open ?? (state === 'drawer' ? '7' : null), f: account ? { ...p.f, account: SAMPLE_ACCOUNTS[0].id } : p.f };
  const rows = sampleLedger(account).filter((r) => !account || r.accountCode === 'cash:bank');
  const result = sampleResult(state, rows, query, (r: LedgerRow, tab) => tab === 'all' || r.accountKind === tab, LEDGER_SPEC.tabs, getNowMs());
  return <LedgerFixture nav={<StateNav base={BASE} state={raw} states={STATES} />} screen={{ basePath: BASE, extraParams: { state: raw }, query, result, accounts: SAMPLE_ACCOUNTS, exportMonth: '2026-11' }} />;
}
