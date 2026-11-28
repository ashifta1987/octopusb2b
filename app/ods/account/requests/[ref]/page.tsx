import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { approveQuote, rejectQuote } from '@/app/account/rfqs/actions';
import { postMessage, uploadFile, markQuotesViewed } from '@/app/account/sourcing/actions';
import { one, type SearchParamsRecord } from '../../orders/_lib/commerce-format';
import { parseRequestTab } from '../_lib/request-logic';
import { loadRequestDetail } from '../_lib/loaders';
import { RequestDetailSkeleton, RequestDetailView } from '../_components/request-detail-view';

export const metadata: Metadata = { title: 'Sourcing request', robots: { index: false, follow: false } };

/**
 * ODS /account/requests/[ref] (Part 6.4). ref = RFQ-n / SRV- code or today's id. ?tab=overview|quotes|messages|files|timeline.
 * Actions are TODAY's, unchanged: approveQuote / rejectQuote (app/account/rfqs/actions.ts — approve_quote creates the
 * order + proforma exactly as today; nothing is added to a cart) and postMessage / uploadFile / markQuotesViewed
 * (app/account/sourcing/actions.ts).
 */
export default function OdsRequestDetailPage(props: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<RequestDetailSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const req = await loadRequestDetail(decodeURIComponent(ref));
  if (!req) notFound();
  return <RequestDetailView req={req} tab={parseRequestTab(one(sp.tab))} actions={{ approveQuote, rejectQuote, postMessage, uploadFile, markQuotesViewed }} />;
}
