import Link from 'next/link';
import { Clock, FileText } from 'lucide-react';
import {Card, EmptyState, Icon, Money, Skeleton, StatusPill, Stepper, Tabs, Timeline } from '@octopus/ui';
import { OdsButton } from '../../orders/_components/ods-button';
import { curLabel, dateText, units } from '../../orders/_lib/commerce-format';
import { KV, PageHead, PanelError } from '../../orders/_components/commerce-ui';
import type { RequestDetailVM, QuoteVM } from '../_lib/loaders';
import type { RequestTab } from '../_lib/request-logic';
import { AcceptQuoteButton, DeclineQuoteButton, MarkQuotesViewed, RequestFileUpload, RequestMessageForm, type RequestActions } from './quote-actions';

/** ODS /account/requests/[ref] (6.4, Match: C_Sourcing detail). Presentational; actions are TODAY's server actions. */
export function RequestDetailView({ req: r, tab, actions, demo }: { req: RequestDetailVM; tab: RequestTab; actions: RequestActions; demo?: boolean }) {
  const href = `/account/requests/${encodeURIComponent(r.ref)}`;
  const current = r.steps.findIndex((s) => s.status === 'current');
  const subtitle = [r.typeLabel, `Sent ${dateText(r.createdAt)}`, r.lines.length > 1 ? `${r.lines.length} products` : null].filter(Boolean).join(' · ');
  const best = r.quotes.filter((q) => q.approvable).sort((a, b) => a.unitCents - b.unitCents)[0];
  const demoReason = demo ? 'Sample only' : undefined;

  const quotesPanel =
    r.kind !== 'rfq' ? (
      <Card title="Quotes" headingLevel={2}>
        <p className="m-0 text-ods-body text-ods-slate">This service doesn&apos;t use quotes. Our team replies in Messages.</p>
      </Card>
    ) : (
      <Card title="Quotes to compare" headingLevel={2} description="All from verified suppliers. The factory is shown without its name." bodyClassName="p-0" data-testid="quotes">
        {r.quotes.length === 0 ? (
          <EmptyState title="No quotes yet" description="Matched suppliers usually quote within 24 hours. This page shows them as soon as they arrive." />
        ) : (
          <>
            <QuotesTable quotes={r.quotes} unit={r.unit} bestId={best?.id} />
            {r.expiresSoon ? (
              <p className="m-0 mx-4 mb-3 rounded-ods-card border border-ods-warning bg-ods-warning-tint p-3 text-ods-small text-ods-navy" role="status">
                <strong>This quote expires {dateText(r.expiresSoon.until)}.</strong> Choose an option to get a proforma invoice. Deposit {r.depositPct}%, balance before shipping.
              </p>
            ) : null}
            <div className="flex flex-col gap-3 px-4 pb-4">
              {r.quotes
                .filter((q) => q.approvable)
                .map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center gap-2" data-testid="quote-actions">
                    <span className="min-w-28 font-semibold text-ods-navy">{q.option}</span>
                    <AcceptQuoteButton quote={q} depositPct={r.depositPct} termsVersion={r.termsVersion} approveQuote={actions.approveQuote} label={`Choose ${q.option}`} />
                    <DeclineQuoteButton quote={q} rejectQuote={actions.rejectQuote} />
                  </div>
                ))}
              {r.quotes.some((q) => q.approvable) ? (
                <div>
                  <OdsButton href={`${href}?tab=messages#ask`} variant="ghost" icon="help">
                    Ask a question
                  </OdsButton>
                </div>
              ) : null}
              <p className="m-0 text-ods-small text-ods-slate">
                Accepting creates the order and a proforma invoice; the {r.depositPct}% deposit is held until the goods pass the quality check.{' '}
                <Link href="/legal/terms" className="underline">
                  Terms
                </Link>
                .
              </p>
            </div>
          </>
        )}
      </Card>
    );

  const overview = (
    <div className="grid gap-4 ods-desktop:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Request details" headingLevel={2}>
          <dl className="m-0 text-ods-body">
            {r.details.map(([k, v]) => (
              <KV key={k} k={k}>
                <span className="whitespace-pre-line">{v}</span>
              </KV>
            ))}
          </dl>
        </Card>
        {r.lines.length > 1 ? (
          <Card title={`Products in this request (${r.lines.length})`} headingLevel={2} bodyClassName="p-0">
            <div className="overflow-x-auto" role="region" aria-label="Products in this request" tabIndex={0}>
              <table className="w-full min-w-[420px] border-collapse text-ods-table" data-testid="rfq-lines">
                <caption className="sr-only">Products in this request</caption>
                <thead>
                  <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
                    <th scope="col" className="px-4 text-start font-semibold">#</th>
                    <th scope="col" className="px-3 text-start font-semibold">Product</th>
                    <th scope="col" className="px-3 text-end font-semibold">Quantity</th>
                    <th scope="col" className="px-4 text-start font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.no} className="h-ods-row border-b border-ods-line last:border-b-0">
                      <td className="px-4 tabular-nums">{l.no}</td>
                      <th scope="row" className="px-3 text-start font-normal text-ods-navy">{l.title}</th>
                      <td className="px-3 text-end tabular-nums whitespace-nowrap">
                        {l.quantity.toLocaleString('en-US')} {l.unit}
                      </td>
                      <td className="px-4 text-ods-slate">{l.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {r.order ? (
          <Card title="Order" headingLevel={2}>
            <p className="m-0 text-ods-body text-ods-navy">
              You accepted a quote — order <strong>{r.order.ref}</strong> was created.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill status={r.order.statusName} />
              <OdsButton href={`/account/orders/${encodeURIComponent(r.order.ref)}`} size="sm" data-testid="go-to-order">
                Go to order
              </OdsButton>
            </div>
          </Card>
        ) : null}
        <Card title="Wallet charge" headingLevel={2}>
          {r.fee ? (
            <>
              <p className="m-0 text-ods-h2 font-bold">
                <Money amount={units(r.fee.cents)} currency={curLabel(r.fee.currency)} />
              </p>
              <p className="m-0 mt-1 text-ods-small text-ods-slate">
                {r.fee.label}, charged {dateText(r.createdAt)}.{' '}
                <Link href="/account/ledger" className="font-semibold text-ods-blue underline">
                  See it in your statement
                </Link>
              </p>
            </>
          ) : (
            <p className="m-0 text-ods-body text-ods-slate">No fee was charged for this request.</p>
          )}
        </Card>
        {r.statusName === 'Closed' ? (
          <p className="m-0 rounded-ods-card border border-ods-line bg-ods-canvas p-4 text-ods-body text-ods-navy" role="status">
            This request is closed. Start a new request any time.
          </p>
        ) : null}
      </div>
      {r.kind === 'rfq' && r.quotes.some((q) => q.approvable) ? <div className="min-w-0 ods-desktop:col-span-2">{quotesPanel}</div> : null}
    </div>
  );

  const messages = (
    <Card title="Messages with the sourcing team" headingLevel={2}>
      {r.messages === null ? (
        <PanelError what="the messages" href={`${href}?tab=messages`} />
      ) : (
        <div className="flex flex-col gap-4">
          {r.messages.length === 0 ? (
            <p className="m-0 text-ods-body text-ods-slate">No messages yet. Questions about specs, packaging or samples go here.</p>
          ) : (
            <ul role="list" className="m-0 flex list-none flex-col gap-3 p-0" data-testid="messages">
              {r.messages.map((m) => (
                <li key={m.id} className={`max-w-[85%] rounded-ods-card px-4 py-3 ${m.fromStaff ? 'border border-ods-line bg-ods-canvas' : 'ms-auto bg-ods-blue-tint'}`}>
                  <p className="m-0 text-ods-small text-ods-slate">
                    {m.fromStaff ? 'Octopus sourcing team' : 'You'} · {dateText(m.at)}
                  </p>
                  <p className="m-0 mt-1 whitespace-pre-line text-ods-body text-ods-navy">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
          <RequestMessageForm kind={r.kind} id={r.id} refCode={r.ref} postMessage={actions.postMessage} disabledReason={demoReason} />
        </div>
      )}
    </Card>
  );

  const files = (
    <Card title={<span className="inline-flex items-center gap-2"><Icon icon={FileText} size="md" className="text-ods-blue" />Files</span>} headingLevel={2}>
      {r.files === null ? (
        <PanelError what="the files" href={`${href}?tab=files`} />
      ) : (
        <div className="flex flex-col gap-4">
          {r.files.length + r.docs.length === 0 ? (
            <p className="m-0 text-ods-body text-ods-slate">Photos, specs and invoices for this request appear here.</p>
          ) : (
            <ul role="list" className="m-0 flex list-none flex-col gap-2 p-0" data-testid="files">
              {r.files.map((f) => (
                <li key={f.id} className="flex flex-wrap justify-between gap-2">
                  <a href={`/api/request-files/${f.id}`} className="min-w-0 font-semibold text-ods-blue underline [overflow-wrap:anywhere]">
                    {f.name}
                  </a>
                  <span className="text-ods-small text-ods-slate">
                    {f.kind}
                    {f.fromStaff ? ' · from our team' : ''} · {dateText(f.at)}
                  </span>
                </li>
              ))}
              {r.docs.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-2">
                  <a href={`/api/documents/${d.id}/pdf`} target="_blank" className="font-semibold text-ods-blue underline">
                    {d.number}
                  </a>
                  <span className="text-ods-small text-ods-slate">
                    {d.type} · {dateText(d.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <RequestFileUpload kind={r.kind} id={r.id} refCode={r.ref} uploadFile={actions.uploadFile} disabledReason={demoReason} />
        </div>
      )}
    </Card>
  );

  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="request-detail" data-status={r.statusName}>
      {r.hasNewQuotes && r.kind === 'rfq' && !demo ? <MarkQuotesViewed rfqId={r.id} markQuotesViewed={actions.markQuotesViewed} /> : null}
      <PageHead
        crumbs={[{ label: 'My account', href: '/account' }, { label: 'Sourcing requests', href: '/account/requests' }, { label: r.ref }]}
        title={`${r.ref} · ${r.title}`}
        titleAfter={<StatusPill status={r.statusName} data-testid="request-status" />}
        subtitle={subtitle}
        actions={
          <>
            <OdsButton href={`${href}?tab=messages#ask`} variant="secondary" icon="message">
              Message us
            </OdsButton>
            <OdsButton href="/request/sourcing" variant="ghost" icon="plus">
              New request
            </OdsButton>
          </>
        }
      />
      <Card title={<span className="inline-flex items-center gap-2"><Icon icon={Clock} size="md" className="text-ods-blue" />Progress</span>} headingLevel={2} className="mb-4">
        <Stepper label="Request progress" steps={r.steps.map((s, i) => ({ id: `s${i}`, label: s.label, status: s.status }))} current={current < 0 ? r.steps.length : current} data-testid="request-stepper" />
      </Card>
      <Tabs
        label="Request sections"
        param="tab"
        defaultValue={tab}
        sticky
        data-testid="request-tabs"
        panelClassName="pt-4"
        items={[
          { id: 'overview', label: 'Overview', panel: overview, testId: 'request-tab-overview' },
          { id: 'quotes', label: 'Quotes', count: r.quotes.length, panel: quotesPanel, testId: 'request-tab-quotes' },
          { id: 'messages', label: 'Messages', count: r.messages?.length ?? 0, panel: messages, testId: 'request-tab-messages' },
          { id: 'files', label: 'Files', count: (r.files?.length ?? 0) + r.docs.length, panel: files, testId: 'request-tab-files' },
          {
            id: 'timeline',
            label: 'Timeline',
            panel: (
              <Card title="Timeline" headingLevel={2}>
                <Timeline label="Request timeline" items={r.timeline.map((t, i) => ({ id: t.id, title: t.title, description: t.body, date: t.at, state: i === 0 ? 'current' : 'done' }))} />
              </Card>
            ),
            testId: 'request-tab-timeline',
          },
        ]}
      />
    </div>
  );
}

function QuotesTable({ quotes, unit, bestId }: { quotes: QuoteVM[]; unit: string | null; bestId?: string }) {
  return (
    <>
      <ul role="list" aria-label="Quotes compared" className="m-0 flex list-none flex-col gap-3 p-3 ods-tablet:hidden">
        {quotes.map((q) => {
          const cur = curLabel(q.currency);
          return (
            <li key={q.id} className="rounded-ods-card border border-ods-line p-4" data-testid="quote-row" data-state={q.state}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ods-navy">{q.option}</span>
                {q.id === bestId && quotes.length > 1 ? <StatusPill tone="success">Best price</StatusPill> : null}
                {q.isNew ? <StatusPill tone="info">New</StatusPill> : null}
                {!q.approvable ? <StatusPill tone="neutral">{q.state}</StatusPill> : null}
              </div>
              <p className="m-0 mt-1 text-ods-small text-ods-slate">
                {q.code} · {q.factory}
              </p>
              <dl className="m-0 mt-2 text-ods-small">
                <KV k="Price per unit"><Money amount={units(q.unitCents)} currency={cur} /></KV>
                <KV k="MOQ">{q.moq ? q.moq.toLocaleString('en-US') : '—'}</KV>
                <KV k="Total"><Money amount={units(q.totalCents)} currency={cur} /></KV>
                <KV k="Lead time">{q.leadDays != null ? `${q.leadDays} days` : '—'}</KV>
                <KV k="Sample">{q.sampleCents != null ? <Money amount={units(q.sampleCents)} currency={cur} /> : '—'}</KV>
                <KV k="Valid until">{dateText(q.validUntil)}</KV>
              </dl>
            </li>
          );
        })}
      </ul>
    <div className="hidden overflow-x-auto ods-tablet:block" role="region" aria-label="Quotes compared (table)" tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-ods-table">
        <caption className="sr-only">Quotes compared</caption>
        <thead>
          <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
            <th scope="col" className="px-4 text-start font-semibold">Option</th>
            <th scope="col" className="px-3 text-end font-semibold">Price per unit</th>
            <th scope="col" className="px-3 text-end font-semibold">MOQ</th>
            <th scope="col" className="px-3 text-end font-semibold">Quantity</th>
            <th scope="col" className="px-3 text-end font-semibold">Total</th>
            <th scope="col" className="px-3 text-start font-semibold">Lead time</th>
            <th scope="col" className="px-3 text-end font-semibold">Sample</th>
            <th scope="col" className="px-4 text-start font-semibold">Valid until</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => {
            const cur = curLabel(q.currency);
            return (
              <tr key={q.id} className="h-ods-row border-b border-ods-line last:border-b-0" data-testid="quote-row" data-state={q.state}>
                <th scope="row" className="px-4 py-2 text-start font-normal">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ods-navy">{q.option}</span>
                    {q.id === bestId && quotes.length > 1 ? <StatusPill tone="success">Best price</StatusPill> : null}
                    {q.isNew ? <StatusPill tone="info">New</StatusPill> : null}
                    {!q.approvable ? <StatusPill tone="neutral">{q.state}</StatusPill> : null}
                  </span>
                  <span className="block whitespace-nowrap text-ods-small text-ods-slate">{q.code}</span>
                  <span className="block whitespace-nowrap text-ods-small text-ods-slate">{q.factory}</span>
                </th>
                <td className="px-3 text-end">
                  <Money amount={units(q.unitCents)} currency={cur} />
                </td>
                <td className="px-3 text-end tabular-nums">{q.moq ? q.moq.toLocaleString('en-US') : '—'}</td>
                <td className="px-3 text-end tabular-nums whitespace-nowrap">
                  {q.quantity.toLocaleString('en-US')} {unit ?? ''}
                </td>
                <td className="px-3 text-end">
                  <Money amount={units(q.totalCents)} currency={cur} />
                </td>
                <td className="px-3 whitespace-nowrap">{q.leadDays != null ? `${q.leadDays} days` : '—'}</td>
                <td className="px-3 text-end">{q.sampleCents != null ? <Money amount={units(q.sampleCents)} currency={cur} /> : '—'}</td>
                <td className="px-4 whitespace-nowrap">{dateText(q.validUntil)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function RequestDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="request-detail-loading">
      <h1 className="sr-only">Sourcing request</h1>
      <Skeleton className="h-8 w-80 max-w-full" />
      <div className="mt-5 rounded-ods-card border border-ods-line bg-ods-surface p-5">
        <Skeleton lines={2} label="Loading request" />
      </div>
      <div className="mt-4 rounded-ods-card border border-ods-line bg-ods-surface p-5">
        <Skeleton silent lines={6} />
      </div>
    </div>
  );
}
