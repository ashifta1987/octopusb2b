import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RequestDetailSkeleton, RequestDetailView } from '@/app/ods/account/requests/_components/request-detail-view';
import { parseRequestTab } from '@/app/ods/account/requests/_lib/request-logic';
import { CommerceFixture, pick } from '../account-orders/_fixture';
import { SAMPLE_REQUEST, SAMPLE_REQUEST_ACCEPTED, SAMPLE_REQUEST_CLOSED, SAMPLE_REQUEST_PANEL_ERRORS, SAMPLE_REQUEST_QUOTING, SAMPLE_REQUEST_SERVICE } from '../account-orders/_samples';
import { sampleApproveQuote, sampleMarkQuotesViewed, samplePostMessage, sampleRejectQuote, sampleUploadFile } from '../account-orders/fixture-actions';

export const metadata: Metadata = { title: 'Sourcing request · ODS fixtures (staging)', robots: { index: false, follow: false } };

const BASE = '/dev/ui/screens/account-request';
const STATES = [
  ['quote-ready', 'Quote ready (expires in 2 days)'],
  ['quoting', 'Quoting'],
  ['accepted', 'Accepted · ordered'],
  ['closed', 'Closed'],
  ['service', 'Service request'],
  ['panel-errors', 'Panels failed'],
  ['loading', 'Loading'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;
const REQS = {
  'quote-ready': SAMPLE_REQUEST,
  quoting: SAMPLE_REQUEST_QUOTING,
  accepted: SAMPLE_REQUEST_ACCEPTED,
  closed: SAMPLE_REQUEST_CLOSED,
  service: SAMPLE_REQUEST_SERVICE,
  'panel-errors': SAMPLE_REQUEST_PANEL_ERRORS,
  loading: SAMPLE_REQUEST,
} as const;

/** /account/requests/[ref] with SAMPLE props (?state=, ?tab=). Accept / Decline / Send call sample stubs only. */
export default function RequestFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = pick(sp.state, STATES);
  const tab = parseRequestTab(Array.isArray(sp.tab) ? sp.tab[0] : sp.tab);
  return (
    <CommerceFixture path="/account/requests" base={BASE} states={STATES} current={current}>
      {current === 'loading' ? (
        <RequestDetailSkeleton />
      ) : (
        <RequestDetailView
          req={REQS[current]}
          tab={tab}
          demo
          actions={{ approveQuote: sampleApproveQuote, rejectQuote: sampleRejectQuote, postMessage: samplePostMessage, uploadFile: sampleUploadFile, markQuotesViewed: sampleMarkQuotesViewed }}
        />
      )}
    </CommerceFixture>
  );
}
