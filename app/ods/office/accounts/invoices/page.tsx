// ODS T9 · Back Office › Accounts › Invoices (Part 7.4, board backoffice/ERP_Invoices). New page: /office/accounts/invoices
// exists only on the ODS theme (switch off → 404, as today). Data = today's documents (proformas, tax invoices, credit
// notes) read with the session client after the same guard as Admin › Finance › Receivables.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { approvalReadiness } from '@/lib/office/approvals';
import { InvoicesScreen, INVOICES_PATH } from './_components/invoices-screen';
import { loadInvoiceById, loadInvoiceList } from './_lib/invoice-data';
import { DEFAULT_QUERY, parseInvoiceQuery } from './_lib/invoice-core';

export const metadata = { title: 'Invoices' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function InvoicesContent({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('finance', 'view', INVOICES_PATH);
  const query = parseInvoiceQuery(await searchParams);
  const nowMs = getNowMs();
  const [list, readiness] = await Promise.all([loadInvoiceList(query, nowMs), approvalReadiness()]);
  const onPage = list.ok && query.open ? list.data.rows.some((r) => r.id === query.open) : false;
  const openRow = query.open && !onPage ? await loadInvoiceById(query.open, nowMs) : null;
  return (
    <InvoicesScreen
      query={query}
      result={list.ok ? { kind: 'ok', data: list.data } : { kind: 'error', error: list.error, kpis: list.kpis }}
      // same permissions as today: record payment = finance:approve (record_payment / pay_service_proforma), export = finance:export
      perms={{ canRecord: can(s, 'finance', 'approve'), canExport: can(s, 'finance', 'export') }}
      // two-person limit from settings (office.second_approver_over_cents); null while migration 255 is not applied
      approvalLimitMinor={readiness.ok ? readiness.data.limitMinor : null}
      openRow={openRow}
    />
  );
}

/** Request-time content streams inside Suspense (Cache Components), with the screen's own loading state as fallback. */
export default function OfficeInvoicesPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<InvoicesScreen query={DEFAULT_QUERY} result={{ kind: 'loading' }} perms={{ canRecord: false, canExport: false }} approvalLimitMinor={null} />}>
      <InvoicesContent searchParams={searchParams} />
    </Suspense>
  );
}
