// ODS T9 · Back Office › Accounts › Payments (Part 7.4). New read-only page: /office/accounts/payments exists only on the
// ODS theme (switch off → 404). Same guard and RLS reads as Admin › Finance (finance:view); export = today's payments CSV
// (finance:export).
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { PaymentsScreen, PAYMENTS_PATH } from './_components/payments-screen';
import { loadPaymentById, loadPayments } from './_lib/data';
import { PAYMENTS_SPEC, exportMonth, parseListQuery } from '../_shared/accounts-core';

export const metadata = { title: 'Payments' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('finance', 'view', PAYMENTS_PATH);
  const query = parseListQuery(await searchParams, PAYMENTS_SPEC);
  const nowMs = getNowMs();
  const result = await loadPayments(query, nowMs);
  const onPage = result.kind === 'ok' && query.open ? result.rows.some((r) => r.id === query.open) : false;
  const openRow = query.open && !onPage ? await loadPaymentById(query.open) : null;
  return <PaymentsScreen query={query} result={result} exportMonth={can(s, 'finance', 'export') ? exportMonth(query.f.from, nowMs) : null} openRow={openRow} />;
}

export default function OfficePaymentsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PaymentsScreen query={parseListQuery({}, PAYMENTS_SPEC)} result={{ kind: 'loading' }} exportMonth={null} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
