import { Suspense } from 'react';
import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { payProformaFromWallet } from '@/app/account/invoices/actions';
import { subscribeSaasPlanAction } from '@/app/account/payment-actions';
import type { SearchParamsRecord } from '../orders/_lib/commerce-format';
import { parseInvoiceFilter } from './_lib/invoice-logic';
import { loadInvoices, loadSaas, type InvoiceRowWithKey } from './_lib/loaders';
import type { SaasVM } from './_components/saas-plans';
import { InvoicesView } from './_components/invoices-view';

export const metadata: Metadata = { title: 'Invoices and documents', robots: { index: false, follow: false } };

/**
 * ODS /account/invoices (Part 6.7). URL state: ?filter=all|due|paid|credit|statements. PDFs: today's
 * /api/documents/[id]/pdf; statements: today's /account/ledger/statement (CSV) and /print. Money action: TODAY's
 * payProformaFromWallet (pay_service_proforma) for service proformas, and subscribeSaasPlanAction (subscribe_saas_plan) in
 * the SaaS plans panel (today's SaasPlansPanel rules; Pay later only for credit-eligible companies), unchanged.
 */
export default function OdsInvoicesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<InvoicesView filter="all" status="loading" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const filter = parseInvoiceFilter(await searchParams);
  const [rows, saas] = await Promise.all([
    loadInvoices().catch((e: unknown): InvoiceRowWithKey[] | null => {
      unstable_rethrow(e);
      return null;
    }),
    loadSaas().catch((e: unknown): SaasVM | null => {
      unstable_rethrow(e);
      return null;
    }),
  ]);
  return <InvoicesView filter={filter} status={rows ? 'ready' : 'error'} rows={rows} payProforma={payProformaFromWallet} saas={saas} subscribeSaas={subscribeSaasPlanAction} />;
}
