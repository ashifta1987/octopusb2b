import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import {Card, EmptyState, Icon, Money, Skeleton, StatusPill } from '@octopus/ui';
import { OdsButton, type OdsIconKey } from './ods-button';
import { curLabel, units } from '../_lib/commerce-format';
import {
  ORDERS_PAGE_SIZE,
  ORDER_SERVICES,
  ORDER_SORTS,
  SERVICE_LABEL,
  ordersHref,
  type NextActionKind,
  type OrderRowVM,
  type OrdersListVM,
  type OrdersState,
} from '../_lib/order-logic';
import { PageHead, Pager, PanelError } from './commerce-ui';
import { UrlCardTabs, UrlFilterPills, UrlSegmented, UrlSelect } from './url-controls';
import { OrdersFiltersSheet } from './orders-filters-sheet';

const ACTION_ICON: Record<NextActionKind, OdsIconKey> = { pay_deposit: 'dollar', pay_balance: 'dollar', track: 'truck', view_pool: 'users', view: 'eye' };

export type OrdersViewProps = {
  state: OrdersState;
  status: 'ready' | 'loading' | 'error';
  list?: OrdersListVM | null;
  /** link base for the list's own URL state (fixtures pass their path) */
  base?: string;
};

/** ODS /account/orders (6.5, Match: Nav_AccountOrders + M_). Presentational: data comes from props. */
export function OrdersView({ state, status, list, base = '/account/orders' }: OrdersViewProps) {
  const crumbs = [{ label: 'My account', href: '/account' }, { label: 'Orders' }];
  const head = (
    <PageHead
      crumbs={crumbs}
      title="Orders"
      subtitle="Everything you've ordered, in every service."
      actions={
        <OdsButton href="/request/sourcing" icon="plus" data-testid="new-request">
          New request
        </OdsButton>
      }
    />
  );
  if (status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="orders-page">
        {head}
        <div className="grid grid-cols-2 gap-3 ods-tablet:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="min-h-[96px] rounded-ods-card border border-ods-line bg-ods-surface p-4">
              <Skeleton silent lines={2} />
            </div>
          ))}
        </div>
        <Card className="mt-5" title="Orders" headingLevel={2} loading>
          {null}
        </Card>
        <Skeleton className="sr-only" label="Loading orders" />
      </div>
    );
  }
  if (status === 'error' || !list) {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="orders-page">
        {head}
        <Card>
          <PanelError what="your orders" href={ordersHref(state, {}, base)} headingLevel={2} />
        </Card>
      </div>
    );
  }
  if (list.total === 0) {
    return (
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="orders-page">
        {head}
        <Card>
          <EmptyState
            icon={ShoppingCart}
            title="No orders yet"
            headingLevel={2}
            description="Accept a quote on one of your requests, join an MOQ pool or start a project — your orders appear here."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <OdsButton href="/account/requests">See my requests</OdsButton>
                <OdsButton href="/shop" variant="secondary">
                  Browse products
                </OdsButton>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const cards = [
    { id: 'all', label: 'All orders', value: list.cardCounts.all, hint: 'Every service', testId: 'orders-card-all' },
    { id: 'waiting', label: 'Waiting for you', value: list.cardCounts.waiting, hint: 'Pay deposit or balance', testId: 'orders-card-waiting' },
    { id: 'production', label: 'In production', value: list.cardCounts.production, hint: 'At the factory', testId: 'orders-card-production' },
    { id: 'shipped', label: 'Shipped', value: list.cardCounts.shipped, hint: 'On the way', testId: 'orders-card-shipped' },
  ];
  const cardHrefs = Object.fromEntries(cards.map((c) => [c.id, ordersHref(state, { status: c.id as OrdersState['status'] }, base)]));
  const svcShown = ORDER_SERVICES.filter((s) => (list.serviceCounts[s] ?? 0) > 0 || state.service === s);
  const pills = [
    { id: 'all', label: 'All services', testId: 'orders-service-all' },
    ...svcShown.map((s) => ({ id: s, label: SERVICE_LABEL[s], count: list.serviceCounts[s] ?? 0, testId: `orders-service-${s}` })),
  ];
  const pillHrefs = Object.fromEntries(pills.map((p) => [p.id, ordersHref(state, { service: p.id as OrdersState['service'] }, base)]));
  const viewHrefs = { list: ordersHref(state, { view: 'list' }, base), board: ordersHref(state, { view: 'board' }, base) };
  const sortHrefs = Object.fromEntries(ORDER_SORTS.map(([k]) => [k, ordersHref(state, { sort: k }, base)]));
  const countText = `${list.filteredTotal} of ${list.total} orders`;

  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="orders-page">
      {head}
      <UrlCardTabs items={cards} value={state.status} hrefs={cardHrefs} label="Orders by status" testId="orders-cards" />
      <div className="mt-4 hidden ods-tablet:block">
        <UrlFilterPills items={pills} value={state.service} hrefs={pillHrefs} label="Filter by service" testId="orders-service-pills" />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <div className="min-w-0 flex-1 ods-tablet:hidden">
          <OrdersFiltersSheet state={state} counts={list.serviceCounts} base={base} />
        </div>
        <div className="hidden ods-tablet:block">
          <UrlSegmented
            options={[
              { value: 'list', label: 'List', icon: 'list', testId: 'orders-view-list' },
              { value: 'board', label: 'Board', icon: 'board', testId: 'orders-view-board' },
            ]}
            value={state.view}
            hrefs={viewHrefs}
            label="View"
          />
        </div>
        <UrlSelect id="orders-sort" label="Sort orders" options={ORDER_SORTS} value={state.sort} hrefs={sortHrefs} testId="orders-sort" />
      </div>

      {state.view === 'board' ? (
        <OrdersBoard list={list} />
      ) : (
        <section aria-labelledby="orders-list-h" className="mt-4 rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card" data-testid="orders-list">
          <h2 id="orders-list-h" className="m-0 flex items-center gap-2 px-4 py-4 text-ods-h2 font-bold text-ods-navy">
            <Icon icon={ShoppingCart} size="md" className="text-ods-blue" />
            <span aria-live="polite">{countText}</span>
          </h2>
          {list.rows.length === 0 ? (
            <EmptyState
              title="No orders match"
              description="Try another status or service."
              action={
                <OdsButton href={base} variant="secondary">
                  Show all orders
                </OdsButton>
              }
            />
          ) : (
            <>
              <OrdersTable rows={list.rows} />
              <OrdersCards rows={list.rows} />
            </>
          )}
          <Pager page={list.page} pages={list.pages} total={list.filteredTotal} pageSize={ORDERS_PAGE_SIZE} hrefFor={(p) => ordersHref(state, { page: p }, base)} label="Orders pages" />
        </section>
      )}
    </div>
  );
}

function OrderStatus({ r }: { r: OrderRowVM }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <StatusPill status={r.statusName} />
      {r.dispute ? <StatusPill tone="danger">Dispute open</StatusPill> : null}
    </span>
  );
}

function ActionButton({ r }: { r: OrderRowVM }) {
  return (
    <OdsButton href={r.next.href} variant={r.next.primary ? 'primary' : 'secondary'} size="sm" icon={ACTION_ICON[r.next.kind]} data-testid={`order-action-${r.next.kind}`}>
      {r.next.label}
      <span className="sr-only"> · {r.ref}</span>
    </OdsButton>
  );
}

const orderHref = (r: OrderRowVM) => `/account/orders/${encodeURIComponent(r.ref)}`;

function OrdersTable({ rows }: { rows: OrderRowVM[] }) {
  return (
    <div className="hidden overflow-x-auto ods-tablet:block">
      <table className="w-full border-collapse text-ods-table">
        <caption className="sr-only">Orders</caption>
        <thead>
          <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
            <th scope="col" className="px-4 text-start font-semibold">Order</th>
            <th scope="col" className="px-3 text-start font-semibold">Products</th>
            <th scope="col" className="px-3 text-start font-semibold">Service</th>
            <th scope="col" className="px-3 text-start font-semibold">Status</th>
            <th scope="col" className="px-3 text-end font-semibold">Total</th>
            <th scope="col" className="px-4 text-end font-semibold">
              <span className="sr-only">Next step</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="h-ods-row border-b border-ods-line last:border-b-0" data-testid="order-row" data-status={r.statusName} data-ref={r.ref}>
              <th scope="row" className="px-4 py-2 text-start font-normal">
                <Link href={orderHref(r)} className="font-semibold whitespace-nowrap text-ods-blue underline underline-offset-4">
                  {r.ref}
                </Link>
              </th>
              <td className="px-3 py-2 text-ods-navy">{r.title}</td>
              <td className="px-3 py-2 whitespace-nowrap text-ods-navy">{SERVICE_LABEL[r.service]}</td>
              <td className="px-3 py-2">
                <OrderStatus r={r} />
              </td>
              <td className="px-3 py-2 text-end font-semibold whitespace-nowrap">
                <Money amount={units(r.totalCents)} currency={curLabel(r.currency)} />
              </td>
              <td className="px-4 py-2 text-end">
                <ActionButton r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: stacked cards (never a sideways-scrolling table). */
function OrdersCards({ rows }: { rows: OrderRowVM[] }) {
  return (
    <ul role="list" aria-label="Orders" className="m-0 flex list-none flex-col gap-3 p-3 ods-tablet:hidden">
      {rows.map((r) => (
        <li key={r.id} className="rounded-ods-card border border-ods-line bg-ods-surface p-4" data-testid="order-row" data-status={r.statusName} data-ref={r.ref}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={orderHref(r)} className="font-bold text-ods-navy underline-offset-4 hover:underline">
              {r.ref}
            </Link>
            <OrderStatus r={r} />
          </div>
          <p className="m-0 mt-2 text-ods-body text-ods-navy">{r.title}</p>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-ods-small text-ods-slate">{SERVICE_LABEL[r.service]}</span>
            <Money amount={units(r.totalCents)} currency={curLabel(r.currency)} className="font-bold" />
          </div>
          {r.next.kind !== 'view' ? (
            <div className="mt-3">
              <ActionButton r={r} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Board: the same orders grouped by status in columns (scrolls sideways inside its own box). */
function OrdersBoard({ list }: { list: OrdersListVM }) {
  return (
    <section aria-labelledby="orders-board-h" className="mt-4" data-testid="orders-board">
      <h2 id="orders-board-h" className="sr-only">
        Orders by status ({list.filteredTotal})
      </h2>
      {list.board.length === 0 ? (
        <Card>
          <EmptyState title="No orders match" description="Try another status or service." />
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2" role="region" aria-label="Order board" tabIndex={0}>
          {list.board.map((col) => (
            <section key={col.status} aria-label={`${col.status} (${col.rows.length})`} className="w-72 shrink-0 rounded-ods-card border border-ods-line bg-ods-canvas p-3" data-testid="orders-board-column" data-status={col.status}>
              <h3 className="m-0 mb-3 flex items-center justify-between text-ods-label font-semibold text-ods-navy">
                <StatusPill status={col.status} />
                <span className="tabular-nums text-ods-slate">{col.rows.length}</span>
              </h3>
              <ul role="list" className="m-0 flex list-none flex-col gap-2 p-0">
                {col.rows.map((r) => (
                  <li key={r.id} className="rounded-ods-card border border-ods-line bg-ods-surface p-3" data-testid="order-row" data-status={r.statusName} data-ref={r.ref}>
                    <Link href={orderHref(r)} className="font-semibold text-ods-blue underline underline-offset-4">
                      {r.ref}
                    </Link>
                    <p className="m-0 mt-1 text-ods-small text-ods-navy">{r.title}</p>
                    <div className="mt-2 flex items-baseline justify-between gap-2 text-ods-small">
                      <span className="text-ods-slate">{SERVICE_LABEL[r.service]}</span>
                      <Money amount={units(r.totalCents)} currency={curLabel(r.currency)} />
                    </div>
                    {r.next.primary ? (
                      <div className="mt-2">
                        <ActionButton r={r} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
