'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CreditCard, ExternalLink, FileText, Truck } from 'lucide-react';
import { Breadcrumbs, Button, Card, EmptyState, MenuButton, Modal, Money, StatusPill, Stepper, Tabs, Textarea, Timeline, formatDate, type StepperStep } from '@octopus/ui';
import { currencyPrefix } from '@/app/ods/office/accounts/invoices/_components/record-payment-drawer';
import type { PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import {
  ORDERS_PATH, ORDER_STEPS, SHIPMENT_HREF, docTypeLabel, isDestructiveMove, moveLabel, orderMoves, orderStepper, paymentBlock, primaryAction, reasonRequired, staffOrderStatus, stepAddsInfo, stepLabel,
  type OrderPerms, type OrderRecordTab,
} from '../_lib/order-core';
import type { OrderRecordData } from '../_lib/types';
import type { MoveResult, OrderPaymentInput } from '../actions';
import { OrderPaymentDrawer } from './order-payment-drawer';

export type OrderRecordActions = {
  recordPayment: (input: OrderPaymentInput) => Promise<PaymentOutcome>;
  move: (orderId: string, to: string, reason: string) => Promise<MoveResult>;
};

export type OrderRecordProps = {
  data: OrderRecordData;
  perms: OrderPerms;
  approvalLimitMinor: number | null;
  tab: OrderRecordTab;
  actions: OrderRecordActions;
  /** ?pay=1 (row menu "Record payment", step-up return) */
  payOpen?: boolean;
  initialPay?: { amount?: string; reference?: string; outcome?: PaymentOutcome };
  /** fixtures: URL tab changes stay on this path */
  fixture?: boolean;
};

const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');
const TICKET_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral'> = { new: 'info', open: 'info', reopened: 'warning', waiting_customer: 'warning', waiting_internal: 'warning', resolved: 'success', closed: 'neutral' };
const PAYMENT_NAME: Record<string, string> = { pending: 'Pending', confirmed: 'Paid', paid: 'Paid', succeeded: 'Paid', held: 'Held', released: 'Released', refunded: 'Refunded', failed: 'Failed', cancelled: 'Failed' };

function PanelError({ what }: { what: string }) {
  return (
    <div role="alert" className="rounded-ods-card border border-ods-danger/30 bg-ods-danger-tint px-3 py-2 text-ods-small font-medium text-ods-danger">
      We couldn’t load {what}. Refresh the page to try again.
    </div>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ods-small text-ods-slate">{k}</dt>
      <dd className="m-0 min-w-0 break-words font-semibold text-ods-text">{children}</dd>
    </div>
  );
}

/**
 * ODS T9 · Order record (Part 7.6 record pattern): header (number, status, customer, product line, primary action for the
 * current step, Actions ▾ with today's moves), Stepper Quote → … → Delivered, sticky Tabs Overview · Items · Documents ·
 * Payments · Shipping · Messages · Timeline. Moves = today's transitionOrder; Record payment = today's recordPaymentStepUp
 * behind the two-person gate (drawer).
 */
export function OrderRecord({ data: o, perms, approvalLimitMinor, tab: tab0, actions, payOpen, initialPay, fixture }: OrderRecordProps) {
  const router = useRouter();
  const [tab, setTabState] = useState<string>(tab0);
  const [payDrawer, setPayDrawer] = useState(!!payOpen && !paymentBlock(o.balanceMinor, perms.canPay));
  const [move, setMove] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, startMove] = useTransition();

  const cur = currencyPrefix(o.currency);
  const st = staffOrderStatus(o.status);
  const stepper = orderStepper(o.status);
  const moves = perms.canEdit ? orderMoves(o.status) : [];
  const primary = primaryAction(o, perms);
  const payBlock = paymentBlock(o.balanceMinor, perms.canPay);
  const money = (minor: number | null, c = cur) => (minor === null ? '—' : <Money amount={minor / 100} currency={c} />);

  const setTab = (t: string) => {
    setTabState(t);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', t);
    u.searchParams.delete('pay');
    window.history.replaceState(null, '', u.toString());
  };
  const openPay = () => {
    setTab('payments');
    setPayDrawer(true);
  };
  const runMove = () => {
    if (!move) return;
    if (reasonRequired(move) && !reason.trim()) return setMoveErr('A reason is required.');
    startMove(async () => {
      const r = await actions.move(o.id, move, reason.trim());
      if (!r.ok) return setMoveErr(r.error);
      setMove(null);
      setReason('');
      setMoveErr(null);
      setNotice(r.message ?? 'Order updated');
      if (!fixture) router.refresh();
    });
  };

  const steps: StepperStep[] = ORDER_STEPS.map((label, i) => ({
    id: label.toLowerCase(),
    label,
    status: stepper.states[i],
    detail: i === stepper.current && stepper.states[i] !== 'done' ? st.step : i === 3 ? 'Optional' : undefined,
    errorText: stepper.states[i] === 'error' ? (stepper.errorText ?? undefined) : undefined,
  }));

  const moveItems = moves.map((to) => ({
    id: to,
    label: moveLabel(to),
    onSelect: () => {
      setMove(to);
      setReason('');
      setMoveErr(null);
    },
  }));
  if (perms.canEdit && o.status === 'ready_to_ship') moveItems.push({ id: 'ship', label: 'Create shipment', onSelect: () => window.location.assign(SHIPMENT_HREF(o.id)) });

  /* ───── panels ───── */
  const summary = (
    <Card title="Summary" headingLevel={2}>
      <dl className="m-0 grid grid-cols-2 gap-3 text-ods-body ods-tablet:grid-cols-3">
        <KV k="Quantity">
          {o.quantity === null ? '—' : o.quantity.toLocaleString('en-US')} × {money(o.unitPriceMinor)}
        </KV>
        <KV k="Shipping">{money(o.shippingMinor)}</KV>
        <KV k="Total">{money(o.totalMinor)}</KV>
        <KV k={`Deposit${o.depositPct !== null ? ` (${o.depositPct}%)` : ''}`}>{money(o.depositMinor)}</KV>
        <KV k="Paid">{money(o.paidMinor)}</KV>
        <KV k="Outstanding">
          <span className={o.balanceMinor > 0 ? 'text-ods-warning' : 'text-ods-success'}>{money(o.balanceMinor)}</span>
        </KV>
        <KV k="Incoterm">{o.incoterm ?? '—'}</KV>
        <KV k="Quote · RFQ">
          <span className="font-mono">{o.quoteCode ?? '—'} · {o.rfqCode ?? '—'}</span>
        </KV>
        {o.supplier ? (
          <KV k="Supplier">
            <span className="font-mono">{o.supplier.code ?? '—'}</span>
            {o.supplier.legalName ? ` · ${o.supplier.legalName}` : ''}
          </KV>
        ) : null}
      </dl>
      {o.deliveredAt ? (
        <p className="m-0 mt-3 text-ods-small text-ods-slate">
          Delivered {formatDate(o.deliveredAt)} · visible-defect claims until {o.claimVisibleUntil ? formatDate(o.claimVisibleUntil) : '—'} · hidden-defect claims until {o.claimHiddenUntil ? formatDate(o.claimHiddenUntil) : '—'}
        </p>
      ) : null}
    </Card>
  );

  const movePanel = (
    <Card title="Move order" headingLevel={2} data-testid="order-moves">
      {!perms.canEdit ? (
        <p className="m-0 text-ods-small text-ods-slate">View only. Moving an order needs the Orders edit permission.</p>
      ) : !moves.length && o.status !== 'ready_to_ship' ? (
        <p className="m-0 text-ods-small text-ods-slate">No further moves from {st.step}.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {moves.map((to) => (
            <Button key={to} size="sm" variant={isDestructiveMove(to) ? 'secondary' : 'primary'} className={isDestructiveMove(to) ? 'text-ods-danger' : undefined} onClick={() => { setMove(to); setReason(''); setMoveErr(null); }}>
              {moveLabel(to)}
            </Button>
          ))}
          {o.status === 'ready_to_ship' ? (
            <a href={SHIPMENT_HREF(o.id)} className="inline-flex h-ods-control items-center gap-1 rounded-ods-control bg-ods-navy px-3 text-ods-small font-semibold text-white no-underline">
              <Truck aria-hidden className="size-4" /> Create shipment
            </a>
          ) : null}
        </div>
      )}
      <p className="m-0 mt-3 text-ods-small text-ods-slate">Moves follow the order state machine; payment steps advance automatically when Finance matches money.</p>
    </Card>
  );

  const payCard = (
    <Card
      title="Record bank payment"
      headingLevel={2}
      actions={
        perms.canPay ? (
          <Button size="sm" iconStart={CreditCard} onClick={openPay} disabled={!!payBlock} disabledReason={payBlock ?? undefined} data-testid="open-record-payment">
            Record payment
          </Button>
        ) : null
      }
    >
      <p className="m-0 text-ods-small text-ods-slate">
        {!perms.canPay ? 'Only Finance can record payments.' : payBlock ?? (o.depositDueMinor > 0 ? <>Deposit due {money(o.depositDueMinor)}</> : <>Balance due {money(o.balanceMinor)}</>)}
      </p>
    </Card>
  );

  const docsPanel = (
    <div className="flex flex-col gap-3" data-testid="order-documents">
      {o.documents === null ? (
        <PanelError what="the documents" />
      ) : !o.documents.length ? (
        <Card><EmptyState headingLevel={2} title="No documents yet" description="Proformas, invoices and confirmations appear here when they are issued." /></Card>
      ) : (
        <Card title="Documents" headingLevel={2} bodyClassName="p-0">
          <ul className="m-0 list-none divide-y divide-ods-line p-0">
            {o.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-ods-body">
                <span className="font-mono font-semibold text-ods-navy">{d.number}</span>
                <span className="text-ods-slate">{docTypeLabel(d.type)}</span>
                {d.supplier ? <StatusPill tone="indigo">Supplier document</StatusPill> : null}
                {d.amountMinor !== null ? money(d.amountMinor, currencyPrefix(d.currency)) : null}
                <span className="text-ods-small text-ods-slate">{human(d.status ?? 'issued')} · {formatDate(d.createdAt, { short: true })}</span>
                <a href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noopener" className="ms-auto inline-flex items-center gap-1 text-ods-small font-semibold text-ods-info underline">
                  <FileText aria-hidden className="size-4" /> PDF<span className="sr-only"> {d.number} (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {o.supplierDocsHidden ? <p className="m-0 text-ods-small text-ods-slate" data-testid="supplier-docs-hidden">Supplier documents (purchase orders, remittances) are shown only to admins, Finance and staff with the Suppliers permission.</p> : null}
    </div>
  );

  const paymentsPanel = (
    <div className="flex flex-col gap-3">
      {payCard}
      {o.payments === null ? (
        <PanelError what="the payments" />
      ) : !o.payments.length ? (
        <Card><EmptyState headingLevel={2} title="No payments recorded" /></Card>
      ) : (
        <Card title="Payments" headingLevel={2} bodyClassName="p-0">
          <ul className="m-0 list-none divide-y divide-ods-line p-0">
            {o.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-ods-body">
                <b className="font-semibold">{money(p.amountMinor, currencyPrefix(p.currency))}</b>
                <span>{human(p.purpose)} · {human(p.method)}</span>
                {p.reference ? <span className="font-mono text-ods-small text-ods-slate">{p.reference}</span> : null}
                <span className="text-ods-small text-ods-slate">{formatDate(p.createdAt)}</span>
                <span className="ms-auto">{PAYMENT_NAME[p.status] ? <StatusPill status={PAYMENT_NAME[p.status]} /> : <StatusPill tone="neutral">{human(p.status)}</StatusPill>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );

  const shippingPanel = (
    <div className="flex flex-col gap-3">
      {o.status === 'ready_to_ship' && perms.canEdit ? (
        <Card title="Ready to ship" headingLevel={2}>
          <p className="m-0 text-ods-small text-ods-slate">Shipping goes through Warehouse OS › B2B shipments.</p>
          <a href={SHIPMENT_HREF(o.id)} className="mt-2 inline-flex items-center gap-1 text-ods-small font-semibold text-ods-info underline">Create shipment <ArrowRight aria-hidden className="size-4" /></a>
        </Card>
      ) : null}
      {o.shipments === null ? (
        <PanelError what="the shipments" />
      ) : !o.shipments.length ? (
        <Card><EmptyState headingLevel={2} title="No shipments" description="Shipments appear here when Warehouse OS creates them for this order." /></Card>
      ) : (
        <Card title="Shipments" headingLevel={2} bodyClassName="p-0">
          <ul className="m-0 list-none divide-y divide-ods-line p-0">
            {o.shipments.map((sh) => (
              <li key={sh.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-ods-body">
                <span className="font-mono font-semibold text-ods-navy">{sh.trackingNo ?? sh.code ?? '—'}</span>
                <span className="text-ods-small text-ods-slate">{[sh.carrier, sh.code, sh.serviceCode].filter(Boolean).join(' · ')}</span>
                <StatusPill tone={sh.status === 'delivered' ? 'success' : 'info'}>{human(sh.status)}</StatusPill>
                <span className="ms-auto flex gap-3">
                  {sh.labelUrl ? <a href={sh.labelUrl} target="_blank" rel="noopener" className="text-ods-small font-semibold text-ods-info underline">Print label<span className="sr-only"> (opens in a new tab)</span></a> : null}
                  {sh.packingSlip && sh.trackingNo ? <a href={`/api/packing-slips/${encodeURIComponent(sh.trackingNo)}`} target="_blank" rel="noopener" className="text-ods-small font-semibold text-ods-info underline">Packing slip<span className="sr-only"> (opens in a new tab)</span></a> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );

  const messagesPanel =
    o.tickets === 'restricted' ? (
      <Card><EmptyState headingLevel={2} title="Messages are in the Support desk" description="Customer messages about an order are support tickets. You need the Support view permission to see them." /></Card>
    ) : o.tickets === null ? (
      <PanelError what="the messages" />
    ) : !o.tickets.length ? (
      <Card><EmptyState headingLevel={2} title="No messages about this order" description="When the customer opens a ticket on this order it appears here." /></Card>
    ) : (
      <Card title="Support tickets" headingLevel={2} bodyClassName="p-0">
        <ul className="m-0 list-none divide-y divide-ods-line p-0">
          {o.tickets.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-ods-body">
              <a href={`/office/support?t=${t.id}`} className="font-mono font-semibold text-ods-info underline">{t.code}</a>
              <span className="min-w-0 flex-1 truncate">{t.subject}</span>
              <StatusPill tone={TICKET_TONE[t.status] ?? 'neutral'}>{human(t.status)}</StatusPill>
              <span className="text-ods-small text-ods-slate">{human(t.priority)} · {formatDate(t.updatedAt, { short: true })}</span>
            </li>
          ))}
        </ul>
      </Card>
    );

  const timelinePanel =
    o.events === null ? (
      <PanelError what="the timeline" />
    ) : !o.events.length ? (
      <Card><EmptyState headingLevel={2} title="No events yet" /></Card>
    ) : (
      <Card title="Order events" headingLevel={2}>
        <Timeline label={`${o.code} events`} showTime items={o.events.map((e) => ({ id: e.id, title: e.title, description: e.body ?? undefined, date: e.createdAt, state: 'done' as const }))} />
      </Card>
    );

  const itemsPanel = (
    <Card title="Items" headingLevel={2} bodyClassName="p-0">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${o.code} items`}>
        <table className="w-full min-w-[520px] border-collapse text-ods-body">
          <thead>
            <tr className="border-b border-ods-line text-start text-ods-small text-ods-slate">
              <th scope="col" className="px-4 py-2 text-start font-semibold">Product</th>
              <th scope="col" className="px-4 py-2 text-end font-semibold">Quantity</th>
              <th scope="col" className="px-4 py-2 text-end font-semibold">Unit price ({cur})</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-ods-line">
              <td className="px-4 py-2">{o.title || '—'}</td>
              <td className="px-4 py-2 text-end tabular-nums">{o.quantity === null ? '—' : o.quantity.toLocaleString('en-US')}</td>
              <td className="px-4 py-2 text-end tabular-nums">{money(o.unitPriceMinor)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="px-4 py-1.5 text-end font-normal text-ods-slate">Shipping</th>
              <td className="px-4 py-1.5 text-end tabular-nums">{money(o.shippingMinor)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={2} className="px-4 py-1.5 text-end font-semibold">Order total</th>
              <td className="px-4 py-1.5 text-end font-bold tabular-nums">{money(o.totalMinor)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="m-0 px-4 pb-3 pt-1 text-ods-small text-ods-slate">Orders carry one product line today; the total is the order’s own figure.</p>
    </Card>
  );

  return (
    <div data-testid="order-record" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={[{ label: 'Orders', href: ORDERS_PATH }, { label: o.code }]} />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="m-0 font-mono text-ods-h1 font-bold text-ods-navy">{o.code}</h1>
            <StatusPill status={st.name} data-testid="order-status" />
            {stepAddsInfo(o.status) ? <span className={st.attention ? 'text-ods-small font-semibold text-ods-danger' : 'text-ods-small text-ods-slate'}>{st.step}</span> : null}
          </div>
          <p className="m-0 mt-1 text-ods-body text-ods-text">{o.title}</p>
          <p className="m-0 text-ods-small text-ods-slate">
            {o.customer ? (
              <a href={`/admin/customers/${o.customer.id}`} className="font-semibold text-ods-info underline">{o.customer.name}</a>
            ) : (
              '—'
            )}
            {o.customer ? ` · ${[o.customer.city, o.customer.country].filter(Boolean).join(', ')}` : ''} · {o.service} · created {formatDate(o.createdAt)}
            {o.supplier ? <> · supplier <span className="font-mono">{o.supplier.code ?? '—'}</span></> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {primary?.kind === 'pay' ? (
            <Button iconStart={CreditCard} onClick={openPay} data-testid="order-primary">{primary.label}</Button>
          ) : primary?.kind === 'ship' ? (
            <a href={primary.href} data-testid="order-primary" className="inline-flex h-ods-control items-center gap-1.5 rounded-ods-control bg-ods-navy px-3 text-ods-body font-semibold text-white no-underline">
              <Truck aria-hidden className="size-4" /> {primary.label}
            </a>
          ) : primary?.kind === 'move' ? (
            <Button iconEnd={ArrowRight} onClick={() => { setMove(primary.to); setReason(''); setMoveErr(null); }} data-testid="order-primary">{primary.label}</Button>
          ) : null}
          {moveItems.length || perms.canPay ? (
            <MenuButton
              label="Actions"
              triggerAriaLabel={`Actions for ${o.code}`}
              align="end"
              triggerClassName="inline-flex h-ods-control items-center gap-1 rounded-ods-control border border-ods-line-strong bg-ods-surface px-3 text-ods-body font-semibold text-ods-navy hover:border-ods-navy"
              items={[
                ...moveItems,
                ...(perms.canPay ? [{ id: 'pay', label: 'Record payment', onSelect: openPay, disabled: !!payBlock, disabledReason: payBlock ?? undefined }] : []),
                { id: 'docs', label: 'Documents', onSelect: () => setTab('documents') },
              ]}
            />
          ) : null}
          <a href={`/office/orders/${o.id}`} target="_blank" rel="noopener" className="inline-flex size-9 items-center justify-center rounded-ods-control border border-ods-line-strong text-ods-navy" aria-label={`Open ${o.code} in a new browser tab`}>
            <ExternalLink aria-hidden className="size-4" />
          </a>
        </div>
      </header>

      <div role="status" className="empty:hidden rounded-ods-control border border-ods-success/30 bg-ods-success-tint px-3 py-2 text-ods-small font-medium text-ods-success">{notice}</div>

      <div className="rounded-ods-card border border-ods-line bg-ods-surface p-4">
        <Stepper data-testid="order-stepper" label={`${o.code} progress`} steps={steps} current={stepper.current} />
      </div>

      <Tabs
        data-testid="order-tabs"
        label={`${o.code} sections`}
        sticky
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Overview', panel: <div className="grid gap-4 ods-desktop:grid-cols-[minmax(0,1fr)_340px]"><div className="flex min-w-0 flex-col gap-4">{summary}</div><div className="flex min-w-0 flex-col gap-4">{movePanel}{payCard}</div></div> },
          { id: 'items', label: 'Items', count: 1, panel: itemsPanel },
          { id: 'documents', label: 'Documents', count: o.documents?.length, panel: docsPanel },
          { id: 'payments', label: 'Payments', count: o.payments?.length, panel: paymentsPanel },
          { id: 'shipping', label: 'Shipping', count: o.shipments?.length, panel: shippingPanel },
          { id: 'messages', label: 'Messages', count: Array.isArray(o.tickets) ? o.tickets.length : undefined, panel: messagesPanel },
          { id: 'timeline', label: 'Timeline', count: o.events?.length, panel: timelinePanel },
        ]}
      />

      <Modal
        open={!!move}
        onClose={() => setMove(null)}
        title={move ? (reasonRequired(move) ? `${moveLabel(move)} ${o.code}` : `Move ${o.code} to ${stepLabel(move)}`) : ''}
        description={move && reasonRequired(move) ? 'This cannot be undone from here. The reason goes on the order timeline.' : 'The note goes on the order timeline.'}
        destructive={!!move && reasonRequired(move)}
        confirmLabel={move ? (reasonRequired(move) ? moveLabel(move) : 'Move') : 'Move'}
        onConfirm={runMove}
        loading={moving}
        loadingText="Saving…"
      >
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          {move && reasonRequired(move) ? 'Reason (required)' : 'Note for the order timeline (optional)'}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required={!!move && reasonRequired(move)} data-testid="move-reason" />
        </label>
        {moveErr ? <p role="alert" className="m-0 mt-2 text-ods-small text-ods-danger">{moveErr}</p> : null}
      </Modal>

      <OrderPaymentDrawer
        open={payDrawer}
        onClose={() => setPayDrawer(false)}
        order={{ id: o.id, code: o.code, customer: o.customer?.name ?? '—', currency: o.currency, totalMinor: o.totalMinor, paidMinor: o.paidMinor, balanceMinor: o.balanceMinor, depositDueMinor: o.depositDueMinor }}
        canPay={perms.canPay}
        payFresh={o.payFresh}
        approvalLimitMinor={approvalLimitMinor}
        onSave={actions.recordPayment}
        onSaved={() => !fixture && router.refresh()}
        initial={initialPay}
      />
    </div>
  );
}
