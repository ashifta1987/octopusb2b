import { Suspense } from 'react';
import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import type { SearchParamsRecord } from '../orders/_lib/commerce-format';
import { buildRequestsList, parseRequestsParams, type RequestRowVM } from './_lib/request-logic';
import { loadRequestRows } from './_lib/loaders';
import { RequestsView } from './_components/requests-view';

export const metadata: Metadata = { title: 'Sourcing requests', robots: { index: false, follow: false } };

/**
 * ODS /account/requests (Part 6.4; /account/sourcing, /account/rfqs and /account/services 308 here for ODS visitors).
 * URL state: ?status=all|quoting|ready|accepted|closed, ?service=<type>, ?q= (the topbar search lands here).
 * Data: today's listSourcing() (rfqs + service_requests, RLS). Fails on its own.
 */
export default function OdsRequestsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<RequestsView state={parseRequestsParams({})} status="loading" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const state = parseRequestsParams(await searchParams);
  let rows: RequestRowVM[] | null = null;
  try {
    rows = await loadRequestRows();
  } catch (e) {
    unstable_rethrow(e);
    rows = null;
  }
  return <RequestsView state={state} status={rows ? 'ready' : 'error'} list={rows ? buildRequestsList(rows, state) : null} />;
}
