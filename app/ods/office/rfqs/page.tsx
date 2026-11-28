// ODS T9 · Back Office › Sales › Sourcing requests (Part 7.6 list pattern, Match ERP_Invoices). Replaces the T8 re-export
// of app/office/rfqs/page.tsx inside the ODS Back Office frame. Same guard as today (requireStaff('requests','view')),
// same division scope, same read per tab (?f=open|to_quote|accepted|closed keep working) + all rfq_lines (audit C4).
// Switch off → today's page, unchanged.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { getDivisionScope } from '@/lib/divisions/scope';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { RfqsScreen } from './_components/rfqs-screen';
import { DEFAULT_RFQ_QUERY, RFQS_PATH, parseRfqQuery } from './_lib/rfq-core';
import { loadRfqList } from './_lib/rfq-data';

export const metadata = { title: 'RFQs & quotes' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function RfqsContent({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('requests', 'view', RFQS_PATH);
  const scope = await getDivisionScope(s); // divisions step 4: header switcher (as today)
  const query = parseRfqQuery(await searchParams);
  const list = await loadRfqList(scope, query, getNowMs());
  return (
    <RfqsScreen
      query={query}
      result={list.ok ? { kind: 'ok', rows: list.rows, kpis: list.kpis } : { kind: 'error', error: list.error, kpis: list.kpis }}
      // today: sendQuote needs requests:create; the customer record is customers:view
      perms={{ canQuote: can(s, 'requests', 'create'), canOpenCustomer: can(s, 'customers', 'view') }}
    />
  );
}

export default function OfficeRfqsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<RfqsScreen query={DEFAULT_RFQ_QUERY} result={{ kind: 'loading' }} perms={{ canQuote: false, canOpenCustomer: false }} />}>
      <RfqsContent searchParams={searchParams} />
    </Suspense>
  );
}
