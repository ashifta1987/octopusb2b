// ODS T9 · Back Office › Accounts › Credit notes (Part 7.4). New read-only page: /office/accounts/credit-notes exists only
// on the ODS theme (switch off → 404). Same guard and RLS reads as Admin › Finance (finance:view).
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { CreditNotesScreen, CREDIT_NOTES_PATH } from './_components/credit-notes-screen';
import { loadCreditById, loadCreditNotes } from './_lib/data';
import { CREDIT_SPEC, parseListQuery } from '../_shared/accounts-core';

export const metadata = { title: 'Credit notes' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function Content({ searchParams }: { searchParams: SP }) {
  await requireStaff('finance', 'view', CREDIT_NOTES_PATH);
  const query = parseListQuery(await searchParams, CREDIT_SPEC);
  const result = await loadCreditNotes(query, getNowMs());
  const onPage = result.kind === 'ok' && query.open ? result.rows.some((r) => r.id === query.open) : false;
  const openRow = query.open && !onPage ? await loadCreditById(query.open) : null;
  return <CreditNotesScreen query={query} result={result} openRow={openRow} />;
}

export default function OfficeCreditNotesPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<CreditNotesScreen query={parseListQuery({}, CREDIT_SPEC)} result={{ kind: 'loading' }} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
