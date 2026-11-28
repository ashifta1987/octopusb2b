import Link from 'next/link';
import { CheckCircle2, Clock, FileText, Package, Truck } from 'lucide-react';
import {Card, EmptyState, Icon, Money, Skeleton, StatusPill, Stepper, Tabs, Timeline } from '@octopus/ui';
import { OdsButton } from './ods-button';
import { curLabel, dateText, docPdfHref, moneyText, units } from '../_lib/commerce-format';
import { SERVICE_LABEL, nextSteps, stepsForService } from '../_lib/order-logic';
import type { OrderDetailVM } from '../_lib/order-types';
import { KV, PageHead, PanelError } from './commerce-ui';
import { OrderPaymentCard, PayNowButton, type OrderPayActions } from './order-payment';
import { CancelOrderButton } from './order-cancel';

export type OrderDetailActions = OrderPayActions & {
  /** app/account/orders/actions.ts cancelOrder → transition_order RPC */
  cancelOrder: (id: string, reason?: string) => Promise<{ ok: true; data?: undefined } | { ok: false; error: string }>;
};

export const ORDER_TABS = ['overview', 'items', 'documents', 'payments', 'shipping', 'messages', 'timeline'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];
export const parseOrderTab = (t: string | undefined): OrderTab => ((ORDER_TABS as readonly string[]).includes(t ?? '') ? (t as OrderTab) : 'overview');

/** ODS /account/orders/[ref] (6.5, Match: Nav_OrderDetail + M_). Presentational; actions are TODAY's server actions. */
export function OrderDetailView({ order: o, tab, actions }: { order: OrderDetailVM; tab: OrderTab; actions: OrderDetailActions }) {
  const href = `/account/orders/${encodeURIComponent(o.ref)}`;
  const productLine = [o.title, `${o.quantity.toLocaleString('en-US')} units`, o.incoterm, o.rfqRef ? `from ${o.rfqRef}` : null, SERVICE_LABEL[o.service]].filter(Boolean).join(' · ');
  const showHeaderPay = !!o.payment?.choices.wallet && !!o.money.due;
  const nexts = nextSteps(stepsForService(o.service), o.current);

  const overview = (
    <div className="grid gap-4 ods-desktop:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <OrderPaymentCard order={o} actions={actions} />
        <ItemsCard o={o} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <QcCard o={o} />
        <Card title="What happens next" headingLevel={2}>
          {nexts.length ? (
            <Timeline label="What happens next" items={nexts.map((n) => ({ id: n.key, title: n.title, state: n.state }))} />
          ) : (
            <p className="m-0 text-ods-body text-ods-slate">{o.rawStatus === 'cancelled' ? 'This order was cancelled.' : 'All steps are done.'}</p>
          )}
        </Card>
        <ShippingCard o={o} compact />
        {o.claim ? (
          <Card title="Claim window" headingLevel={2}>
            <p className="m-0 text-ods-small text-ods-slate">Delivered {dateText(o.claim.deliveredAt)}.</p>
            <dl className="m-0 mt-2 text-ods-small">
              <KV k="Visible defects or shortage">until {dateText(o.claim.visibleUntil) || '—'}</KV>
              <KV k="Hidden defects">until {dateText(o.claim.hiddenUntil) || '—'}</KV>
            </dl>
          </Card>
        ) : null}
        <Card title="Need help?" headingLevel={2}>
          <p className="m-0 text-ods-small text-ods-slate">Message us about {o.ref}. Your reference is attached automatically.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <OdsButton href={`/account/support?order=${o.id}`} variant="secondary" size="sm">
              Report a problem
            </OdsButton>
            {o.cancellable ? <CancelOrderButton orderId={o.id} orderRef={o.ref} cancelOrder={actions.cancelOrder} /> : null}
          </div>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="order-detail" data-status={o.statusName}>
      <PageHead
        crumbs={[{ label: 'My account', href: '/account' }, { label: 'Orders', href: '/account/orders' }, { label: o.ref }]}
        title={o.ref}
        titleAfter={
          <span className="inline-flex flex-wrap gap-1">
            <StatusPill status={o.statusName} data-testid="order-status" />
            {o.dispute ? <StatusPill tone="danger">Dispute open</StatusPill> : null}
          </span>
        }
        subtitle={productLine}
        actions={
          <>
            {showHeaderPay ? <PayNowButton label={`Pay ${o.money.due!.purpose} ${moneyText(o.money.due!.amount, o.currency)}`} /> : null}
            <OdsButton href={`/account/support?order=${o.id}`} variant="secondary" icon="message" data-testid="message-us">
              Message us
            </OdsButton>
          </>
        }
      />
      {o.justCreated ? (
        <p className="m-0 mb-4 rounded-ods-card bg-ods-success-tint p-4 text-ods-body text-ods-success" role="status">
          Quote accepted. Proforma invoice {o.piNumber ?? ''} is issued — pay the {o.money.depositPct}% deposit to confirm the order.
        </p>
      ) : null}

      {o.current < 0 ? (
        <p className="m-0 mb-4 rounded-ods-card border border-ods-line bg-ods-canvas p-4 text-ods-body text-ods-navy" role="status" data-testid="order-cancelled">
          This order was cancelled. Nothing more is due.
        </p>
      ) : (
        <Card title={<span className="inline-flex items-center gap-2"><Icon icon={Clock} size="md" className="text-ods-blue" />Progress</span>} headingLevel={2} className="mb-4">
          <Stepper label="Order progress" steps={o.steps.map((s) => ({ id: s.key, label: s.label, detail: s.detail }))} current={o.current} data-testid="order-stepper" />
        </Card>
      )}

      <Tabs
        label="Order sections"
        param="tab"
        defaultValue={tab}
        sticky
        data-testid="order-tabs"
        panelClassName="pt-4"
        items={[
          { id: 'overview', label: 'Overview', panel: overview, testId: 'order-tab-overview' },
          { id: 'items', label: 'Items', count: o.items.length, panel: <ItemsCard o={o} />, testId: 'order-tab-items' },
          { id: 'documents', label: 'Documents', count: o.documents?.length ?? 0, panel: <DocumentsCard o={o} href={href} />, testId: 'order-tab-documents' },
          { id: 'payments', label: 'Payments', count: o.payments?.length ?? 0, panel: <PaymentsCard o={o} href={href} />, testId: 'order-tab-payments' },
          { id: 'shipping', label: 'Shipping', panel: <ShippingCard o={o} />, testId: 'order-tab-shipping' },
          { id: 'messages', label: 'Messages', count: o.tickets?.length ?? 0, panel: <MessagesCard o={o} href={href} />, testId: 'order-tab-messages' },
          {
            id: 'timeline',
            label: 'Timeline',
            panel: (
              <Card title="Timeline" headingLevel={2}>
                {o.timeline === null ? (
                  <PanelError what="the timeline" href={`${href}?tab=timeline`} />
                ) : o.timeline.length === 0 ? (
                  <EmptyState title="No updates yet" description="Every step of this order appears here as it happens." />
                ) : (
                  <Timeline label="Order timeline" items={o.timeline.map((t, i) => ({ id: t.id, title: t.title, description: t.body ?? undefined, date: t.at, state: i === 0 ? 'current' : 'done' }))} />
                )}
              </Card>
            ),
            testId: 'order-tab-timeline',
          },
        ]}
      />
    </div>
  );
}

function ItemsCard({ o }: { o: OrderDetailVM }) {
  const cur = curLabel(o.currency);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Icon icon={Package} size="md" className="text-ods-blue" />Items</span>} headingLevel={2} bodyClassName="p-0">
      <div className="overflow-x-auto" role="region" aria-label="Items" tabIndex={0}>
        <table className="w-full min-w-[420px] border-collapse text-ods-table">
          <caption className="sr-only">Items in {o.ref}</caption>
          <thead>
            <tr className="h-ods-head border-y border-ods-line bg-ods-canvas text-ods-label text-ods-slate">
              <th scope="col" className="px-4 text-start font-semibold">Item</th>
              <th scope="col" className="px-3 text-end font-semibold">Qty</th>
              <th scope="col" className="px-3 text-end font-semibold">Unit</th>
              <th scope="col" className="px-4 text-end font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((it, i) => (
              <tr key={`${it.title}-${i}`} className="h-ods-row border-b border-ods-line">
                <th scope="row" className="px-4 text-start font-normal text-ods-navy">{it.title}</th>
                <td className="px-3 text-end tabular-nums">{it.quantity.toLocaleString('en-US')}</td>
                <td className="px-3 text-end">{it.unitCents != null ? <Money amount={units(it.unitCents)} currency={cur} /> : '—'}</td>
                <td className="px-4 text-end">{it.totalCents != null ? <Money amount={units(it.totalCents)} currency={cur} /> : '—'}</td>
              </tr>
            ))}
            <tr className="h-ods-row font-bold">
              <th scope="row" colSpan={3} className="px-4 text-start text-ods-navy">Order total</th>
              <td className="px-4 text-end">
                <Money amount={units(o.money.totalCents)} currency={cur} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function QcCard({ o }: { o: OrderDetailVM }) {
  if (!o.qc && !o.qcReached) {
    return (
      <Card title="Quality check" headingLevel={2}>
        <p className="m-0 text-ods-body text-ods-slate">We check your goods at the factory before the balance is due. The QC report appears here when it&apos;s ready.</p>
      </Card>
    );
  }
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Icon icon={CheckCircle2} size="md" className="text-ods-success" />{o.qc ? `Quality check report · ${dateText(o.qc.date)}` : 'Quality check done'}</span>} headingLevel={2} data-testid="qc-card">
      {o.qc ? (
        <>
          <p className="m-0 text-ods-body text-ods-slate">Report {o.qc.number}. Open it for the findings and photos.</p>
          <div className="mt-3">
            <OdsButton href={docPdfHref(o.qc.docId)} target="_blank" variant="secondary" icon="arrowRight" data-testid="qc-report">
              Open QC report (PDF)
            </OdsButton>
          </div>
        </>
      ) : (
        <p className="m-0 text-ods-body text-ods-slate">The quality check step is complete. Ask us for the report in Messages if you need it.</p>
      )}
    </Card>
  );
}

function ShippingCard({ o, compact }: { o: OrderDetailVM; compact?: boolean }) {
  const s = o.shipment;
  const title = <span className="inline-flex items-center gap-2"><Icon icon={Truck} size="md" className="text-ods-blue" />Shipping</span>;
  if (o.shippingFailed) {
    return (
      <Card title={title} headingLevel={2}>
        <PanelError what="shipping" href={`/account/orders/${encodeURIComponent(o.ref)}?tab=shipping`} />
      </Card>
    );
  }
  if (!s) {
    return (
      <Card title={title} headingLevel={2} data-testid="shipping-card">
        <p className="m-0 text-ods-body text-ods-slate">We book shipping after the balance is paid. Tracking appears here as soon as your goods leave.</p>
      </Card>
    );
  }
  return (
    <Card title={title} headingLevel={2} data-testid="shipping-card">
      <dl className="m-0 text-ods-small">
        <KV k="Method">{s.method}</KV>
        <KV k="Carrier">{s.carrier}</KV>
        <KV k="Status">{s.status}</KV>
        <KV k="Waybill">
          <span className="font-mono">{s.trackingNo ?? 'Pending'}</span>
        </KV>
        {s.location ? <KV k="Current location">{s.location}</KV> : null}
        <KV k="Estimated delivery">{dateText(s.eta) || '—'}</KV>
        {s.parcels || s.weightKg ? <KV k="Cartons">{[s.parcels ? `${s.parcels} cartons` : null, s.weightKg ? `${s.weightKg} kg` : null].filter(Boolean).join(' · ')}</KV> : null}
      </dl>
      {!compact && o.tracking.length ? (
        <div className="mt-4">
          <h3 className="m-0 mb-2 text-ods-body font-semibold text-ods-navy">Tracking history</h3>
          <Timeline label="Tracking history" items={o.tracking.map((t, i) => ({ id: t.id, title: t.title, description: t.location ?? undefined, date: t.at, state: i === 0 ? 'current' : 'done' }))} />
        </div>
      ) : null}
    </Card>
  );
}

function DocumentsCard({ o, href }: { o: OrderDetailVM; href: string }) {
  const cur = curLabel(o.currency);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Icon icon={FileText} size="md" className="text-ods-blue" />Documents</span>} headingLevel={2} description="Proformas, invoices, receipts and the QC report as PDFs." bodyClassName="p-0">
      {o.documents === null ? (
        <PanelError what="the documents" href={`${href}?tab=documents`} />
      ) : o.documents.length === 0 ? (
        <EmptyState title="No documents yet" description="Your proforma, invoices and the QC report appear here as soon as they're issued." />
      ) : (
        <ul role="list" className="m-0 list-none p-0" data-testid="documents-list">
          {o.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3" data-testid="document-row" data-type={d.type}>
              <div className="min-w-0">
                <p className="m-0 font-semibold text-ods-navy">{d.typeLabel}</p>
                <p className="m-0 text-ods-small text-ods-slate">
                  <span className="font-mono">{d.number}</span> · {dateText(d.createdAt)}
                  {d.amountCents != null ? (
                    <>
                      {' '}
                      · <Money amount={units(d.amountCents)} currency={curLabel(d.currency) || cur} />
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={d.statusName} />
                <OdsButton href={docPdfHref(d.id)} target="_blank" variant="secondary" size="sm" icon="download">
                  PDF<span className="sr-only"> · {d.number}</span>
                </OdsButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PaymentsCard({ o, href }: { o: OrderDetailVM; href: string }) {
  return (
    <Card title="Payments" headingLevel={2} bodyClassName="p-0">
      {o.payments === null ? (
        <PanelError what="the payments" href={`${href}?tab=payments`} />
      ) : o.payments.length === 0 ? (
        <EmptyState title="No payments yet" description="Deposits and balance payments for this order appear here." />
      ) : (
        <ul role="list" className="m-0 list-none p-0" data-testid="payments-list">
          {o.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3">
              <div>
                <p className="m-0 font-semibold text-ods-navy">
                  {p.purpose} · {p.method}
                </p>
                <p className="m-0 text-ods-small text-ods-slate">{dateText(p.at)}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill status={p.statusName} />
                <Money amount={units(p.amountCents)} currency={curLabel(p.currency)} className="font-semibold" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MessagesCard({ o, href }: { o: OrderDetailVM; href: string }) {
  return (
    <Card
      title="Messages"
      headingLevel={2}
      actions={
        <OdsButton href={`/account/support?order=${o.id}`} size="sm" icon="message">
          Message us
        </OdsButton>
      }
      bodyClassName="p-0"
    >
      {o.tickets === null ? (
        <PanelError what="your messages" href={`${href}?tab=messages`} />
      ) : o.tickets.length === 0 ? (
        <EmptyState title="No messages about this order" description="Questions about this order go to our team with the reference attached." />
      ) : (
        <ul role="list" className="m-0 list-none p-0">
          {o.tickets.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ods-line px-4 py-3">
              <Link href={`/account/support/${t.id}`} className="font-semibold text-ods-blue underline underline-offset-4">
                {t.subject}
              </Link>
              <span className="inline-flex items-center gap-2 text-ods-small text-ods-slate">
                <StatusPill tone={t.open ? 'info' : 'neutral'}>{t.open ? 'Open' : 'Closed'}</StatusPill>
                {dateText(t.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Loading state of the detail (skeleton header, stepper and tabs). */
export function OrderDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-ods-content p-ods-pad-page" data-testid="order-detail-loading">
      <h1 className="sr-only">Order</h1>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-5 rounded-ods-card border border-ods-line bg-ods-surface p-5">
        <Skeleton lines={2} label="Loading order" />
      </div>
      <div className="mt-4 grid gap-4 ods-desktop:grid-cols-2">
        <div className="rounded-ods-card border border-ods-line bg-ods-surface p-5">
          <Skeleton silent lines={5} />
        </div>
        <div className="rounded-ods-card border border-ods-line bg-ods-surface p-5">
          <Skeleton silent lines={5} />
        </div>
      </div>
    </div>
  );
}
