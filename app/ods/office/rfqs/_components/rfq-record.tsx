/**
 * ODS T9 · RFQ record (Part 7.6 record pattern: header + stepper + sticky underline tabs + panels). Server-safe: panels are
 * ReactNodes (the real page passes Suspense-wrapped loaders, fixtures pass sample panels), so every tab loads and fails
 * on its own. No supplier / cost data here — quotes (with the supplier column only for suppliers:view) are in rfq-grids.
 */
import type { ReactNode } from 'react';
import { ExternalLink, FilePlus2 } from 'lucide-react';
import { Breadcrumbs, Card, EmptyState, ErrorState, Money, StatusPill, Stepper, Tabs, Timeline, buttonClass, formatDate, formatNumber, formatTime, type TabItem, type TimelineItem } from '@octopus/ui';
import { closedNote, currencyLabel, rfqSteps, type RecordTab } from '../_lib/rfq-core';
import type { QuoteRowVM, RfqRecordVM, ThreadVM } from '../_lib/rfq-data';

const date = (iso: string | null | undefined, time = false) => (iso ? (time ? `${formatDate(iso)}, ${formatTime(iso)}` : formatDate(iso)) : '—');
const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');

export function LoadError({ what }: { what: string }) {
  return <ErrorState title={`We couldn't load ${what}`} description="Reload the page to try again. The rest of the request still works." headingLevel={3} />;
}

export function PanelLoading({ title }: { title: string }) {
  return <Card as="section" title={title} headingLevel={2} loading />;
}

function KeyValues({ rows, testId }: { rows: [string, ReactNode][]; testId?: string }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(7rem,38%)_1fr] text-ods-table" data-testid={testId}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-ods-line py-2 pe-3 text-ods-slate">{k}</dt>
          <dd className="m-0 min-w-0 break-words border-b border-ods-line py-2 text-ods-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────── header + stepper ───────── */

export function RfqHeader({ r, canOpenCustomer, quoteHref, canAddQuote, quoteCount }: { r: RfqRecordVM; canOpenCustomer: boolean; quoteHref: string; canAddQuote: boolean; quoteCount: number }) {
  const lines = r.lines?.rows ?? [];
  const steps = rfqSteps(r.statusRaw, { hasOrder: !!r.order, quotes: quoteCount });
  const current = steps.findIndex((s) => s.status === 'current');
  const note = closedNote(r.statusRaw);
  const customer =
    canOpenCustomer && r.customer.id ? (
      <a href={`/admin/customers/${r.customer.id}`} data-testid="rfq-customer-link" className="font-semibold text-ods-blue hover:underline">
        {r.customer.name}
      </a>
    ) : (
      <b className="text-ods-navy">{r.customer.name}</b>
    );
  return (
    <header data-testid="rfq-header" className="grid gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 shadow-ods-card">
      <div className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-start">
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={[{ label: 'Sourcing requests', href: '/office/rfqs' }, { label: r.code }]} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 font-mono text-ods-h1 font-bold text-ods-navy">{r.code}</h1>
            <StatusPill status={r.status} data-testid="rfq-status" />
            <span className="min-w-0 text-ods-body font-semibold text-ods-navy">{r.title}</span>
          </div>
          <p className="m-0 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-ods-small text-ods-slate">
            <span>Customer {customer}{r.customer.place ? ` · ${r.customer.place}` : ''}</span>
            <span>
              Products <b className="text-ods-navy">{lines.length === 1 ? lines[0].title : `${lines.length} products`}</b>
              {lines.length > 1 ? ` · ${lines[0].title} +${lines.length - 1} more` : ''}
            </span>
            <span>Received <b className="text-ods-navy">{date(r.createdAt, true)}</b></span>
            {r.expiresAt ? <span>Expires <b className="text-ods-navy">{date(r.expiresAt)}</b></span> : null}
            <span>Owner <b className="text-ods-navy">{r.owner ?? 'Not assigned'}</b></span>
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {r.order ? (
            <a href={`/office/orders/${r.order.id}`} className={`${buttonClass('secondary')} gap-1.5`}>
              <ExternalLink aria-hidden className="size-4" /> Order {r.order.code}
            </a>
          ) : null}
          {canAddQuote ? (
            <a href={quoteHref} className={`${buttonClass('primary')} gap-1.5`} data-testid="rfq-add-quote">
              <FilePlus2 aria-hidden className="size-4" /> Add a quote
            </a>
          ) : null}
        </div>
      </div>
      <div>
        <Stepper
          data-testid="rfq-stepper"
          label="Request progress"
          current={current < 0 ? steps.length : current}
          steps={steps.map((s, i) => ({ id: `s${i}`, label: s.label, status: s.status }))}
        />
      </div>
      {note ? <p className="m-0 text-ods-small font-semibold text-ods-slate" data-testid="rfq-closed-note">{note}</p> : null}
    </header>
  );
}

/* ───────── record frame ───────── */

const LABEL: Record<RecordTab, string> = { overview: 'Overview', lines: 'Lines', quotes: 'Quotes', messages: 'Messages', files: 'Files', timeline: 'Timeline' };

export function RfqRecordView({ header, tab, panels, counts }: { header: ReactNode; tab: RecordTab; panels: Record<RecordTab, ReactNode>; counts: Partial<Record<RecordTab, number | null>> }) {
  const items: TabItem[] = (Object.keys(LABEL) as RecordTab[]).map((id) => ({ id, label: LABEL[id], count: counts[id] ?? undefined, panel: panels[id], testId: `rfq-tab-${id}` }));
  return (
    <div data-testid="rfq-record" className="grid min-w-0 gap-3">
      {header}
      <Tabs key={tab} label="Request record" items={items} defaultValue={tab} param="tab" sticky data-testid="rfq-tabs" panelClassName="pt-3" />
    </div>
  );
}

/* ───────── panels ───────── */

export function OverviewPanel({ r }: { r: RfqRecordVM }) {
  const lines = r.lines?.rows ?? [];
  return (
    <div className="grid gap-4 ods-desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="rfq-overview">
      <Card as="section" title="Request" headingLevel={2}>
        <KeyValues
          rows={[
            ['Quantity (line 1)', `${formatNumber(r.quantity)} ${r.unit}`],
            ['Target price', r.targetMinor ? <Money amount={r.targetMinor / 100} currency={currencyLabel(r.currency)} suffix={` / ${r.unit}`} /> : '—'],
            ['Incoterm', r.incoterm ?? '—'],
            ['Customer', <span key="c">{r.customer.place || '—'} <span className="text-ods-small text-ods-slate">· KYC {humanize(r.customer.kyc)}</span></span>],
            ['Ship to', r.shipTo || '—'],
            ['Category', r.category ?? '—'],
            ['Products', lines.length === 1 ? '1 product' : `${lines.length} products — see Lines`],
          ]}
        />
      </Card>
      <Card as="section" title="Requested specs" headingLevel={2}>
        <p className="m-0 whitespace-pre-line text-ods-body">{r.details || <span className="text-ods-slate">No details given.</span>}</p>
        {r.product ? (
          <div className="mt-3 rounded-ods-control bg-ods-canvas p-3">
            <p className="m-0 text-ods-small">
              Linked product:{' '}
              <a href={`/p/${r.product.slug}`} target="_blank" rel="noreferrer" className="font-semibold text-ods-blue hover:underline">
                {r.product.title}
              </a>
            </p>
            {r.product.specs.length ? (
              <dl className="m-0 mt-2 grid gap-x-6 text-ods-small ods-tablet:grid-cols-2">
                {r.product.specs.map((sp) => (
                  <div key={sp.name} className="flex justify-between gap-2 border-b border-ods-line py-1">
                    <dt className="text-ods-slate">{sp.name}</dt>
                    <dd className="m-0">{sp.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function MessagesPanel({ thread, replyForm, canReply }: { thread: ThreadVM | null; replyForm: ReactNode; canReply: boolean }) {
  if (!thread) return <LoadError what="the messages" />;
  return (
    <Card as="section" title={`Messages with the customer · ${thread.messages.length}`} headingLevel={2} data-testid="rfq-messages">
      <div className="grid gap-3">
        {thread.messages.length === 0 ? <p className="m-0 text-ods-small text-ods-slate">No messages yet.</p> : null}
        {thread.messages.map((m) => (
          <div key={m.id} className={`rounded-ods-control px-3 py-2 text-ods-body ${m.fromStaff ? 'border border-ods-line bg-ods-canvas' : 'bg-ods-blue-tint'}`}>
            <div className="text-ods-small text-ods-slate">
              {m.fromStaff ? 'Octopus team' : 'Customer'} · {date(m.at, true)}
            </div>
            <p className="m-0 mt-0.5 whitespace-pre-line">{m.body}</p>
          </div>
        ))}
        {canReply ? replyForm : <p className="m-0 text-ods-small text-ods-slate">You can read the thread; replying needs the Requests edit permission.</p>}
      </div>
    </Card>
  );
}

export function FilesPanel({ thread }: { thread: ThreadVM | null }) {
  if (!thread) return <LoadError what="the files" />;
  return (
    <Card as="section" title={`Files · ${thread.files.length}`} headingLevel={2} data-testid="rfq-files">
      {thread.files.length === 0 ? (
        <EmptyState headingLevel={3} title="No files yet" description="Photos, specs and drawings the customer or the team attach to this request appear here." />
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0 text-ods-body">
          {thread.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 border-b border-ods-line py-1.5">
              <a href={`/api/request-files/${f.id}`} className="font-semibold text-ods-blue hover:underline">
                {f.name}
              </a>
              <span className="text-ods-small text-ods-slate">
                {humanize(f.kind)} · {f.fromStaff ? 'team' : 'customer'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Timeline from today's data: received, each quote sent (no supplier), messages, order, expiry. */
export function timelineItems(r: RfqRecordVM, quotes: QuoteRowVM[] | null, thread: ThreadVM | null, nowMs: number): TimelineItem[] {
  const items: (TimelineItem & { at: number })[] = [{ id: 'rx', title: 'Request received', date: r.createdAt, state: 'done', at: Date.parse(r.createdAt) }];
  for (const q of quotes ?? []) items.push({ id: `q-${q.id}`, title: `Quote ${q.code} sent to the buyer`, date: q.createdAt, state: 'done', at: Date.parse(q.createdAt) });
  for (const m of thread?.messages ?? []) items.push({ id: `m-${m.id}`, title: m.fromStaff ? 'Team replied' : 'Customer message', description: m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body, date: m.at, state: 'done', at: Date.parse(m.at) });
  items.sort((a, b) => a.at - b.at);
  if (r.order) items.push({ id: 'ord', title: `Order ${r.order.code} created`, state: 'done', at: Infinity });
  if (r.expiresAt) {
    const past = Date.parse(r.expiresAt) <= nowMs;
    items.push({ id: 'exp', title: past ? 'Request expired' : 'Request expires', date: r.expiresAt, state: past ? 'done' : 'next', at: Infinity });
  }
  return items.map((x) => ({ id: x.id, title: x.title, description: x.description, date: x.date, state: x.state }));
}

export function TimelinePanel({ items }: { items: TimelineItem[] }) {
  return (
    <Card as="section" title="Timeline" headingLevel={2} data-testid="rfq-timeline">
      <Timeline items={items} label="Request timeline" showTime />
    </Card>
  );
}
