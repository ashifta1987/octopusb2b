// ODS T9 · Back Office › Accounts › Ledger (Part 7.4). New read-only page: /office/accounts/ledger exists only on the ODS
// theme (switch off → 404). Same guard and RLS reads as Admin › Finance (finance:view); export = today's journals CSV
// (finance:export).
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { LedgerScreen, LEDGER_PATH } from './_components/ledger-screen';
import { loadLedger, loadLedgerAccounts, loadLedgerOpen } from './_lib/data';
import { LEDGER_SPEC, exportMonth, parseListQuery } from '../_shared/accounts-core';

export const metadata = { title: 'Ledger' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('finance', 'view', LEDGER_PATH);
  const query = parseListQuery(await searchParams, LEDGER_SPEC);
  const nowMs = getNowMs();
  const [result, accounts] = await Promise.all([loadLedger(query, nowMs), loadLedgerAccounts().catch(() => [])]);
  const onPage = result.kind === 'ok' && query.open ? result.rows.some((r) => r.id === query.open) : false;
  const openRow = query.open && !onPage ? await loadLedgerOpen(query.open) : null;
  return <LedgerScreen query={query} result={result} accounts={accounts} exportMonth={can(s, 'finance', 'export') ? exportMonth(query.f.from, nowMs) : null} openRow={openRow} />;
}

export default function OfficeLedgerPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<LedgerScreen query={parseListQuery({}, LEDGER_SPEC)} result={{ kind: 'loading' }} accounts={[]} exportMonth={null} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
