import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { parseInvoiceQuery, queryRows, tabCounts, type InvoiceQuery } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import type { InvoicesResult } from '@/app/ods/office/accounts/invoices/_components/invoices-screen';
import { InvoicesFixture } from './_fixture';
import { INVOICE_FIXTURE_STATES, SAMPLE_KPIS, SAMPLE_LIMIT, SAMPLE_MANY, SAMPLE_NOW, SAMPLE_ROWS, SAMPLE_SECOND_APPROVER, sampleServiceOf, type InvoiceFixtureState } from './sample-data';

export const metadata: Metadata = { title: 'Invoices · ODS Back Office screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-invoices';

/**
 * Staging-only fixture (T9): Back Office › Accounts › Invoices inside the real ODS Back Office frame, SAMPLE data only.
 * `?state=list | overdue | empty | error | loading | bulk | drawer | second-approver | virtual | no-permission`; tabs,
 * search, filters, sort and pages work on the sample rows with the same pure rules the live page uses on the server.
 */
export default function OfficeInvoicesFixturePage({ searchParams }: { searchParams: SP }) {
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
  await connection(); // request time: the "updated … ago" stamp reads the clock
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = (INVOICE_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'list') as InvoiceFixtureState;
  const parsed = parseInvoiceQuery(sp);
  const query: InvoiceQuery = {
    ...parsed,
    tab: state === 'overdue' && !sp.status ? 'overdue' : parsed.tab,
    q: state === 'empty' && sp.q === undefined ? 'Nordic Lighting' : parsed.q,
    open:
      parsed.open ??
      (state === 'drawer' ? SAMPLE_ROWS[0].id : state === 'second-approver' ? SAMPLE_ROWS.find((r) => r.number === 'PF-2026-0121')!.id : null),
  };
  const all = state === 'virtual' ? SAMPLE_MANY : SAMPLE_ROWS;
  // virtual: every matching row on one page (no pager) so the grid virtualises above 200
  const page = queryRows(all, state === 'virtual' ? { ...query, page: 0, size: all.length as InvoiceQuery['size'] } : query, SAMPLE_NOW, sampleServiceOf);
  const result: InvoicesResult =
    state === 'loading'
      ? { kind: 'loading' }
      : state === 'error'
        ? { kind: 'error', error: 'We couldn’t load the invoices.', kpis: SAMPLE_KPIS }
        : state === 'no-permission'
          ? { kind: 'forbidden' }
          : {
              kind: 'ok',
              data: {
                rows: page.rows,
                total: page.total,
                counts: tabCounts(all),
                kpis: SAMPLE_KPIS,
                allUsd: true,
                updatedAt: new Date(getNowMs() - 120_000).toISOString(),
              },
            };

  const nav = (
    <nav aria-label="Fixture states (sample data)" className="mb-4">
      <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
        {INVOICE_FIXTURE_STATES.map(([id, label]) => (
          <li key={id}>
            <a
              href={`${BASE}?state=${id}`}
              aria-current={state === id ? 'page' : undefined}
              className={`inline-flex min-h-8 items-center rounded-ods-control border px-3 text-ods-small font-semibold no-underline ${state === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <InvoicesFixture
      nav={nav}
      screen={{
        basePath: BASE,
        extraParams: { state },
        query,
        result,
        perms: { canRecord: true, canExport: true },
        approvalLimitMinor: SAMPLE_LIMIT,
        initialSelected: state === 'bulk' ? [SAMPLE_ROWS[0].id, SAMPLE_ROWS[1].id] : undefined,
        initialDrawer: state === 'second-approver' ? { amount: '3200.00', reference: 'FT2611270042', outcome: SAMPLE_SECOND_APPROVER } : undefined,
        noPagination: state === 'virtual',
      }}
    />
  );
}
