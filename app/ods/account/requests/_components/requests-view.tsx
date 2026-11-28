import Link from 'next/link';
import { Send } from 'lucide-react';
import {Card, EmptyState, Icon, Skeleton, StatusPill } from '@octopus/ui';
import { OdsButton } from '../../orders/_components/ods-button';
import { SOURCING_TYPES, TYPE_LABEL } from '@/lib/sourcing';
import { dateText } from '../../orders/_lib/commerce-format';
import { PageHead, PanelError } from '../../orders/_components/commerce-ui';
import { UrlCardTabs, UrlFilterPills } from '../../orders/_components/url-controls';
import { REQUEST_CARDS, requestsHref, type RequestRowVM, type RequestsListVM, type RequestsState } from '../_lib/request-logic';

export type RequestsViewProps = { state: RequestsState; status: 'ready' | 'loading' | 'error'; list?: RequestsListVM | null; base?: string };

/** ODS /account/requests (6.4, Match: C_Sourcing + M_). Presentational. */
export function RequestsView({ state, status, list, base = '/account/requests' }: RequestsViewProps) {
  const head = (
    <PageHead
      title="Sourcing requests"
      subtitle="Ask us to find a product. We get quotes from verified suppliers and you choose."
      actions={
        <OdsButton href="/request/sourcing" icon="plus" data-testid="new-request">
          New sourcing request
        </OdsButton>
      }
    />
  );
  if (status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="requests-page">
        {head}
        <Card title="Your requests" headingLevel={2} loading>
          {null}
        </Card>
        <Skeleton className="sr-only" label="Loading requests" />
      </div>
    );
  }
  if (status === 'error' || !list) {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="requests-page">
        {head}
        <Card>
          <PanelError what="your requests" href={requestsHref(state, {}, base)} headingLevel={2} />
        </Card>
      </div>
    );
  }
  if (list.total === 0) {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="requests-page">
        {head}
        <Card>
          <EmptyState
            icon={Send}
            headingLevel={2}
            title="No sourcing requests yet"
            description="Tell us the product, quantity and destination. Verified factories quote within 24 hours."
            action={<OdsButton href="/request/sourcing">Start a sourcing request</OdsButton>}
          />
        </Card>
      </div>
    );
  }
  const cards = REQUEST_CARDS.map(([id, label, hint]) => ({ id, label, value: list.cardCounts[id], hint, testId: `requests-card-${id}` }));
  const cardHrefs = Object.fromEntries(REQUEST_CARDS.map(([id]) => [id, requestsHref(state, { status: id }, base)]));
  const types = SOURCING_TYPES.filter((t) => (list.serviceCounts[t] ?? 0) > 0 || state.service === t);
  const pills = [{ id: 'all', label: 'All services' }, ...types.map((t) => ({ id: t, label: TYPE_LABEL[t], count: list.serviceCounts[t] ?? 0, testId: `requests-service-${t}` }))];
  const pillHrefs = Object.fromEntries(pills.map((p) => [p.id, requestsHref(state, { service: p.id as RequestsState['service'] }, base)]));
  const countText = `${list.rows.length} of ${list.total} requests`;

  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="requests-page">
      {head}
      {list.newQuotes > 0 ? (
        <p className="m-0 mb-4 rounded-ods-card bg-ods-info-tint p-4 text-ods-body text-ods-info" role="status">
          <strong>
            {list.newQuotes} new quote{list.newQuotes === 1 ? '' : 's'}
          </strong>{' '}
          waiting for you — open the request to compare.
        </p>
      ) : null}
      {state.q ? (
        <p className="m-0 mb-3 text-ods-small text-ods-slate">
          Results for “{state.q}” ·{' '}
          <Link href={requestsHref(state, { q: '' }, base)} className="font-semibold text-ods-blue underline">
            Clear search
          </Link>
        </p>
      ) : null}
      <UrlCardTabs items={cards} value={state.status} hrefs={cardHrefs} label="Requests by status" testId="requests-cards" />
      {pills.length > 2 || state.service !== 'all' ? (
        <div className="mt-4">
          <UrlFilterPills items={pills} value={state.service} hrefs={pillHrefs} label="Filter by service" resultText={countText} testId="requests-service-pills" />
        </div>
      ) : null}
      <section aria-labelledby="requests-h" className="mt-4 rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card" data-testid="requests-list">
        <h2 id="requests-h" className="m-0 flex items-center gap-2 px-4 py-4 text-ods-h2 font-bold text-ods-navy">
          <Icon icon={Send} size="md" className="text-ods-blue" />
          Your requests <span className="sr-only">({countText})</span>
        </h2>
        {list.rows.length === 0 ? (
          <EmptyState
            title="No requests match"
            description="Try another status, service or search."
            action={
              <OdsButton href={base} variant="secondary">
                Show all requests
              </OdsButton>
            }
          />
        ) : (
          <>
            <RequestsTable rows={list.rows} />
            <RequestsCards rows={list.rows} />
          </>
        )}
      </section>
      <p className="m-0 mt-3 text-ods-small text-ods-slate">Quotes show a verified factory and its region only. Supplier names, codes and contacts stay with our sourcing team.</p>
    </div>
  );
}

const href = (r: RequestRowVM) => `/account/requests/${encodeURIComponent(r.ref)}`;
const qty = (r: RequestRowVM) => (r.quantity != null ? `${r.quantity.toLocaleString('en-US')}${r.unit ? ` ${r.unit}` : ''}` : '—');

function QuotesCell({ r }: { r: RequestRowVM }) {
  if (r.kind !== 'rfq') return <span className="text-ods-slate">—</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {r.quotes} quote{r.quotes === 1 ? '' : 's'}
      {r.newQuotes > 0 ? <StatusPill tone="danger">{r.newQuotes} new</StatusPill> : null}
    </span>
  );
}

function RequestsTable({ rows }: { rows: RequestRowVM[] }) {
  return (
    <div className="hidden overflow-x-auto ods-tablet:block">
      <table className="w-full border-collapse text-ods-table">
        <caption className="sr-only">Your requests</caption>
        <thead>
          <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
            <th scope="col" className="px-4 text-start font-semibold">Request</th>
            <th scope="col" className="px-3 text-start font-semibold">Product</th>
            <th scope="col" className="px-3 text-end font-semibold">Quantity</th>
            <th scope="col" className="px-3 text-start font-semibold">Status</th>
            <th scope="col" className="px-3 text-start font-semibold">Quotes</th>
            <th scope="col" className="px-3 text-start font-semibold">Sent</th>
            <th scope="col" className="px-4 text-end font-semibold">
              <span className="sr-only">Next step</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="h-ods-row border-b border-ods-line last:border-b-0" data-testid="request-row" data-status={r.statusName} data-ref={r.ref}>
              <th scope="row" className="px-4 py-2 text-start font-normal">
                <Link href={href(r)} className="font-semibold whitespace-nowrap text-ods-blue underline underline-offset-4">
                  {r.ref}
                </Link>
              </th>
              <td className="min-w-48 px-3 py-2 text-ods-navy">
                {r.title}
                <span className="block text-ods-small text-ods-slate">{r.typeLabel}</span>
              </td>
              <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap">{qty(r)}</td>
              <td className="px-3 py-2">
                <StatusPill status={r.statusName} />
              </td>
              <td className="px-3 py-2">
                <QuotesCell r={r} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-ods-slate">{dateText(r.createdAt)}</td>
              <td className="px-4 py-2 text-end">
                <OdsButton href={r.action.href} size="sm" variant={r.action.label === 'Compare quotes' ? 'primary' : 'secondary'}>
                  {r.action.label}
                  <span className="sr-only"> · {r.ref}</span>
                </OdsButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestsCards({ rows }: { rows: RequestRowVM[] }) {
  return (
    <ul role="list" aria-label="Your requests" className="m-0 flex list-none flex-col gap-3 p-3 ods-tablet:hidden">
      {rows.map((r) => (
        <li key={r.id} className="rounded-ods-card border border-ods-line bg-ods-surface p-4" data-testid="request-row" data-status={r.statusName} data-ref={r.ref}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={href(r)} className="font-bold text-ods-navy underline-offset-4 hover:underline">
              {r.ref}
            </Link>
            <StatusPill status={r.statusName} />
          </div>
          <p className="m-0 mt-2 text-ods-body text-ods-navy">{r.title}</p>
          <p className="m-0 mt-1 text-ods-small text-ods-slate">
            {r.typeLabel} · {qty(r)} · {dateText(r.createdAt)}
          </p>
          {r.kind === 'rfq' ? (
            <div className="mt-2 text-ods-small">
              <QuotesCell r={r} />
            </div>
          ) : null}
          {r.action.label !== 'Open' ? (
            <div className="mt-3">
              <OdsButton href={r.action.href} size="sm" variant={r.action.label === 'Compare quotes' ? 'primary' : 'secondary'}>
                {r.action.label}
                <span className="sr-only"> · {r.ref}</span>
              </OdsButton>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
