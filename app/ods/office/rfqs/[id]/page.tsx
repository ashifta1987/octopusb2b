// ODS T9 · Back Office › Sales › RFQ record (Part 7.6 record pattern). Replaces the T8 re-export of
// app/office/rfqs/[id]/page.tsx inside the ODS Back Office frame. Same guard as today (requireStaff('requests','view')),
// same reads (rfq + quotes + supplier options + thread) plus all rfq_lines (audit C4, read-only), the customer name and
// the order it led to. Actions = today's: sendQuote (requests:create → RPC send_quote) in the quote drawer, and
// MessageForm → postMessage (RPC post_request_message) when requests:edit. Supplier names only with suppliers:view
// (the suppliers_staff RLS rule today's page relies on). No cost / margin exists on this page today. Switch off → today's page.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { sendQuote } from '@/components/backoffice/quote-actions';
import { MessageForm } from '@/components/account/sourcing-forms';
import { getCurrencyContext } from '@/lib/currency';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { Card } from '@octopus/ui';
import { LinesGrid, QuotesPanel } from '../_components/rfq-grids';
import { FilesPanel, LoadError, MessagesPanel, OverviewPanel, RfqHeader, RfqRecordView, TimelinePanel, timelineItems } from '../_components/rfq-record';
import { isRecordTab, quoteFormGate, rfqPerms, type RecordTab } from '../_lib/rfq-core';
import { loadRfqQuotes, loadRfqRecord, loadRfqThread, loadSupplierOptions } from '../_lib/rfq-data';

export const metadata = { title: 'RFQ' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OfficeRfqPage(props: Props) {
  return (
    <Suspense fallback={<Card title="Loading the request…" headingLevel={2} loading data-testid="rfq-record-loading" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Props) {
  const { id } = await params;
  const s = await requireStaff('requests', 'view', `/office/rfqs/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const perms = rfqPerms((area, action) => can(s, area, action));
  const r = await loadRfqRecord(id);
  if (!r) notFound();
  const sp = await searchParams;
  const rawTab = first(sp.tab);
  const tab: RecordTab = isRecordTab(rawTab) ? rawTab : 'overview';
  const gate = quoteFormGate(r.statusRaw, perms);
  const [quotes, thread, suppliers, cx] = await Promise.all([
    loadRfqQuotes(id, perms).catch(() => null),
    loadRfqThread(id).catch(() => null),
    // today's supplier options read; without suppliers:view RLS returns none, so it isn't asked at all
    gate.ok && perms.canSeeSuppliers ? loadSupplierOptions().catch(() => []) : Promise.resolve([]),
    getCurrencyContext(),
  ]);
  const lines = r.lines?.rows ?? [];
  return (
    <RfqRecordView
      tab={tab}
      counts={{ lines: lines.length, quotes: quotes?.length ?? null, messages: thread?.messages.length ?? null, files: thread?.files.length ?? null }}
      header={<RfqHeader r={r} canOpenCustomer={perms.canOpenCustomer} canAddQuote={gate.ok} quoteHref="?tab=quotes&quote=new" quoteCount={quotes?.length ?? 0} />}
      panels={{
        overview: <OverviewPanel r={r} />,
        lines: <LinesGrid rows={lines} fromLines={!!r.lines?.fromLines} currency={r.currency} />,
        quotes:
          quotes === null ? (
            <LoadError what="the quotes" />
          ) : (
            <QuotesPanel
              quotes={quotes}
              initialOpen={first(sp.quote) === 'new' && gate.ok}
              drawer={{
                rfq: { code: r.code, title: r.title, quantity: r.quantity, unit: r.unit, incoterm: r.incoterm, statusRaw: r.statusRaw },
                gate,
                canSeeSuppliers: perms.canSeeSuppliers,
                suppliers,
                currency: cx.currency,
                action: sendQuote.bind(null, r.id),
              }}
            />
          ),
        messages: <MessagesPanel thread={thread} canReply={perms.canReply} replyForm={<MessageForm kind="rfq" id={r.id} refCode={r.code} label="Reply to the customer" />} />,
        files: <FilesPanel thread={thread} />,
        timeline: <TimelinePanel items={timelineItems(r, quotes, thread, getNowMs())} />,
      }}
    />
  );
}
