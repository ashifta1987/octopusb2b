import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RequestsView } from '@/app/ods/account/requests/_components/requests-view';
import { buildRequestsList, parseRequestsParams } from '@/app/ods/account/requests/_lib/request-logic';
import { CommerceFixture, pick } from '../account-orders/_fixture';
import { SAMPLE_REQUEST_ROWS } from '../account-orders/_samples';

export const metadata: Metadata = { title: 'Sourcing requests · ODS fixtures (staging)', robots: { index: false, follow: false } };

const BASE = '/dev/ui/screens/account-requests';
const STATES = [
  ['list', 'All requests'],
  ['quote-ready', 'Quote ready'],
  ['search', 'Search results'],
  ['empty', 'No requests yet'],
  ['error', 'Failed to load'],
  ['loading', 'Loading'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;

/** /account/requests with SAMPLE props in every state (?state=). Card tabs, service pills and ?q= work (URL). */
export default function RequestsFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = pick(sp.state, STATES);
  const base = parseRequestsParams(sp);
  const state = current === 'quote-ready' ? { ...base, status: 'ready' as const } : current === 'search' ? { ...base, q: 'pet' } : base;
  return (
    <CommerceFixture path="/account/requests" base={BASE} states={STATES} current={current}>
      <RequestsView
        state={state}
        status={current === 'loading' ? 'loading' : current === 'error' ? 'error' : 'ready'}
        list={current === 'error' ? null : buildRequestsList(current === 'empty' ? [] : SAMPLE_REQUEST_ROWS, state)}
        base={BASE}
      />
    </CommerceFixture>
  );
}
