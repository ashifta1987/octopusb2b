import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InvoicesView } from '@/app/ods/account/invoices/_components/invoices-view';
import { parseInvoiceFilter, type InvoiceFilter } from '@/app/ods/account/invoices/_lib/invoice-logic';
import { CommerceFixture, pick } from '../account-orders/_fixture';
import { SAMPLE_INVOICES, SAMPLE_SAAS, SAMPLE_SAAS_CREDIT } from '../account-orders/_samples';
import { samplePayProforma, sampleSubscribeSaas } from '../account-orders/fixture-actions';

export const metadata: Metadata = { title: 'Invoices · ODS fixtures (staging)', robots: { index: false, follow: false } };

const BASE = '/dev/ui/screens/account-invoices';
const STATES = [
  ['all', 'All'],
  ['due', 'Due'],
  ['credit', 'Credit notes'],
  ['statements', 'Statements'],
  ['saas', 'SaaS plans'],
  ['saas-credit', 'SaaS plans · credit-eligible'],
  ['empty', 'No documents yet'],
  ['error', 'Failed to load'],
  ['loading', 'Loading'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;

/** /account/invoices with SAMPLE props (?state=; ?filter= also works). Pay calls a sample stub — nothing is charged. */
export default function InvoicesFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = pick(sp.state, STATES);
  const filter: InvoiceFilter = current === 'due' || current === 'credit' || current === 'statements' ? current : parseInvoiceFilter(sp);
  return (
    <CommerceFixture path="/account/invoices" base={BASE} states={STATES} current={current}>
      <InvoicesView
        filter={filter}
        status={current === 'loading' ? 'loading' : current === 'error' ? 'error' : 'ready'}
        rows={current === 'empty' ? [] : SAMPLE_INVOICES}
        payProforma={samplePayProforma}
        saas={current === 'saas' ? SAMPLE_SAAS : current === 'saas-credit' ? SAMPLE_SAAS_CREDIT : undefined}
        subscribeSaas={sampleSubscribeSaas}
        base={BASE}
      />
    </CommerceFixture>
  );
}
