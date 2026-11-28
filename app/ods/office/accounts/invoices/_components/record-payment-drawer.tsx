'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Button, Drawer, Field, IconButton, Input, Kbd, Money, NumberInput, Select, Skeleton, StatusPill, Tabs, formatDate, cx } from '@octopus/ui';
import type { InvoiceActivityItem } from '../actions';
import { amountToMinor, payableMinor, secondApproverNote, validatePayment, type InvoiceRow, type PaymentOutcome } from '../_lib/invoice-core';

export const currencyPrefix = (c: string | null | undefined) => ({ USD: 'US$', CNY: 'CN¥', HKD: 'HK$' } as Record<string, string>)[(c ?? 'USD').trim()] ?? (c ?? 'USD');

export type RecordPaymentInput = { documentId: string; amount: string; method: string; reference: string };

export type RecordPaymentDrawerProps = {
  row: InvoiceRow | null;
  onClose: () => void;
  canRecord: boolean;
  /** USD cents from settings (staff_approvals_readiness); null when two-person approvals are not switched on yet */
  approvalLimitMinor: number | null;
  onSave: (input: RecordPaymentInput) => Promise<PaymentOutcome>;
  loadActivity: (id: string) => Promise<{ ok: true; items: InvoiceActivityItem[] } | { ok: false; error: string }>;
  onOpenInTab: (row: InvoiceRow) => void;
  /** after a payment was recorded (refresh the list) */
  onSaved?: () => void;
  /** fixtures */
  initial?: { amount?: string; reference?: string; outcome?: PaymentOutcome };
};

function Note({ tone, children, testId, live }: { tone: 'warning' | 'danger' | 'success' | 'info'; children: React.ReactNode; testId?: string; live?: boolean }) {
  const t = { warning: 'border-ods-warning/30 bg-ods-warning-tint text-ods-warning', danger: 'border-ods-danger/30 bg-ods-danger-tint text-ods-danger', success: 'border-ods-success/30 bg-ods-success-tint text-ods-success', info: 'border-ods-blue/30 bg-ods-info-tint text-ods-info' }[tone];
  return (
    <div role={live ? 'status' : undefined} data-testid={testId} className={cx('rounded-ods-control border px-3 py-2 text-ods-small font-medium', t)}>
      {children}
    </div>
  );
}

/**
 * Record payment drawer (Part 7.4, 460 px). Header: number, status, open in a tab, close. Tabs: Record payment · Details ·
 * Activity (n). Save payment calls the page's `onSave` = recordInvoicePaymentAction (two-person gate + TODAY's action).
 * Fields are only what today's record-payment step stores: amount, method, bank reference (date = the day it is recorded).
 */
export function RecordPaymentDrawer({ row, onClose, canRecord, approvalLimitMinor, onSave, loadActivity, onOpenInTab, onSaved, initial }: RecordPaymentDrawerProps) {
  return row ? (
    <DrawerBody
      key={row.id}
      row={row}
      onClose={onClose}
      canRecord={canRecord}
      approvalLimitMinor={approvalLimitMinor}
      onSave={onSave}
      loadActivity={loadActivity}
      onOpenInTab={onOpenInTab}
      onSaved={onSaved}
      initial={initial}
    />
  ) : null;
}

function DrawerBody({ row, onClose, canRecord, approvalLimitMinor, onSave, loadActivity, onOpenInTab, onSaved, initial }: RecordPaymentDrawerProps & { row: InvoiceRow }) {
  const recordable = canRecord && !!row.payTarget;
  const reason = !canRecord ? 'Only Finance can record payments.' : row.payBlockedReason;
  const max = payableMinor(row);
  const cur = currencyPrefix(row.currency);
  const [tab, setTab] = useState(recordable ? 'record' : 'details');
  const [amount, setAmount] = useState(initial?.amount ?? (max > 0 ? (max / 100).toFixed(2) : ''));
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [touched, setTouched] = useState(false);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(initial?.outcome ?? null);
  const [pending, start] = useTransition();
  const [activity, setActivity] = useState<{ ok: true; items: InvoiceActivityItem[] } | { ok: false; error: string } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadActivity(row.id).then((r) => live && setActivity(r), () => live && setActivity({ ok: false, error: 'We couldn’t load the activity.' }));
    return () => {
      live = false;
    };
  }, [row.id, loadActivity]);

  const errs = touched && recordable ? validatePayment({ amount, reference, method }, max, row.payTarget ?? 'order') : {};
  const amountMinor = amountToMinor(amount);
  const overLimit = approvalLimitMinor !== null && row.currency === 'USD' && Number.isFinite(amountMinor) && amountMinor > approvalLimitMinor;
  const limitText = secondApproverNote(approvalLimitMinor);
  const saved = outcome?.kind === 'saved';
  const dirty = !saved && (reference.trim() !== '' || amount !== (max > 0 ? (max / 100).toFixed(2) : ''));

  const save = () => {
    if (!recordable || pending || saved) return;
    setTouched(true);
    const e = validatePayment({ amount, reference, method }, max, row.payTarget ?? 'order');
    if (e.amount || e.reference || e.method) {
      if (e.amount) amountRef.current?.focus();
      return;
    }
    start(async () => {
      // plain "1234.56": today's actions parse it the same way (toCents / ×100)
      const r = await onSave({ documentId: row.id, amount: (amountToMinor(amount) / 100).toFixed(2), method, reference: reference.trim() });
      setOutcome(r);
      if (r.kind === 'step-up') window.location.assign(r.redirect);
      if (r.kind === 'saved') onSaved?.();
    });
  };

  const recordPanel = (
    <div className="flex flex-col gap-4 pt-3">
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 rounded-ods-control border border-ods-line bg-ods-canvas p-3 text-ods-small">
        <div className="col-span-2 min-w-0">
          <dt className="text-ods-slate">Customer</dt>
          <dd className="m-0 truncate font-semibold text-ods-navy">{row.customer}</dd>
        </div>
        <div>
          <dt className="text-ods-slate">Total</dt>
          <dd className="m-0 font-semibold">
            <Money amount={row.amountMinor / 100} currency={cur} />
          </dd>
        </div>
        <div>
          <dt className="text-ods-slate">Paid</dt>
          <dd className="m-0 font-semibold">{row.paidMinor === null ? '—' : <Money amount={row.paidMinor / 100} currency={cur} />}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ods-slate">Balance due{row.dueAt ? ` · due ${formatDate(row.dueAt)}` : ''}</dt>
          <dd className="m-0 text-ods-h2 font-bold text-ods-navy">
            <Money amount={row.balanceMinor / 100} currency={cur} />
          </dd>
        </div>
        {row.payTarget === 'order' ? (
          <div className="col-span-2">
            <dt className="text-ods-slate">Recorded on order</dt>
            <dd className="m-0">
              <b className="text-ods-navy">{row.orderCode ?? '—'}</b> · order balance <Money amount={max / 100} currency={cur} /> (as on the order page)
            </dd>
          </div>
        ) : null}
      </dl>
      <Field label={`Amount (${cur})`} required error={errs.amount}>
        <NumberInput
          ref={amountRef}
          data-testid="payment-amount"
          value={amount}
          onValueChange={(raw) => setAmount(raw)}
          min={0.01}
          max={max / 100}
          decimals={2}
          prefix={cur}
          className="text-end"
          disabled={saved}
        />
      </Field>
      <Field label="Date received" hint="Today’s record-payment step records the payment with today’s date." readOnly>
        <Input value={formatDate(new Date())} readOnly />
      </Field>
      <Field
        label="Method"
        required
        error={errs.method}
        disabled={row.payTarget === 'proforma'}
        disabledReason={row.payTarget === 'proforma' ? 'Service proformas are recorded here as bank transfers (as on Finance › Transfers).' : undefined}
      >
        <Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={saved || row.payTarget === 'proforma'}>
          <option value="bank_transfer">Bank transfer</option>
          {row.payTarget === 'order' ? (
            <>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </>
          ) : null}
        </Select>
      </Field>
      <Field label="Bank reference" required hint="Must match the bank statement line." error={errs.reference}>
        <Input data-testid="payment-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} autoComplete="off" className="font-mono" disabled={saved} />
      </Field>
      {limitText ? (
        <Note tone={overLimit ? 'warning' : 'info'}>
          {limitText}
          {overLimit ? ' This one goes to Approvals when you save.' : null}
        </Note>
      ) : null}
      <div aria-live="polite">
        {outcome?.kind === 'second-approver' ? (
          <Note tone="warning" testId="second-approver-needed">
            <b>Second approver needed ({outcome.code}).</b> A different Finance user must approve it in Approvals. Nothing is recorded yet; once it is approved, open this invoice and save the payment again.
          </Note>
        ) : outcome?.kind === 'saved' ? (
          <Note tone="success">
            {outcome.message}
            {outcome.approvalCode ? ` · approval ${outcome.approvalCode} used` : ''}
            {outcome.warning ? <span className="mt-1 block text-ods-warning">{outcome.warning}</span> : null}
          </Note>
        ) : outcome?.kind === 'error' || outcome?.kind === 'step-up' ? (
          <Note tone="danger">{outcome.message}</Note>
        ) : null}
      </div>
    </div>
  );

  const detail = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 border-b border-ods-line py-2 text-ods-small last:border-b-0">
      <dt className="text-ods-slate">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-ods-text">{v}</dd>
    </div>
  );
  const typeLabel = row.docType === 'proforma_invoice' ? 'Proforma invoice' : row.docType === 'credit_note' ? 'Credit note' : 'Tax invoice';
  const detailsPanel = (
    <div className="pt-2">
      <dl className="m-0">
        {detail('Type', typeLabel)}
        {detail('Number', <span className="font-mono">{row.number}</span>)}
        {detail('Service', row.service)}
        {detail('Customer', row.customer)}
        {detail('Issued', formatDate(row.issuedAt))}
        {detail('Due', row.dueAt ? formatDate(row.dueAt) : '—')}
        {detail('Currency', row.currency)}
        {detail('Payment option', row.paymentOption ? row.paymentOption.replace(/_/g, ' ') : '—')}
        {detail('Order', row.orderId ? <a href={`/office/orders/${row.orderId}`} className="font-semibold text-ods-info underline">{row.orderCode ?? 'Open order'}</a> : '—')}
        {detail('Last reminder', row.lastReminder ? row.lastReminder.replace(/_/g, ' ') : '—')}
        {detail('Emailed', row.emailedAt ? formatDate(row.emailedAt) : '—')}
        {detail('Owner', row.owner?.name ?? '—')}
      </dl>
      <a href={`/api/documents/${row.id}/pdf`} target="_blank" rel="noopener" className="mt-3 inline-flex items-center gap-1 text-ods-small font-semibold text-ods-info underline">
        <FileText aria-hidden className="size-4" /> View document<span className="sr-only"> {row.number} (opens in a new tab)</span>
      </a>
    </div>
  );
  const activityPanel = (
    <div className="pt-2">
      {!activity ? (
        <Skeleton lines={4} label="Loading activity" />
      ) : !activity.ok ? (
        <Note tone="danger">{activity.error}</Note>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {activity.items.map((a) => (
            <li key={a.id} className="border-b border-ods-line py-2 text-ods-small last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ods-navy">{a.title}</span>
                {a.amountMinor !== null ? <Money amount={a.amountMinor / 100} currency={currencyPrefix(a.currency)} /> : null}
              </div>
              <div className="text-ods-slate">
                {a.at ? formatDate(a.at) : null}
                {a.detail ? `${a.at ? ' · ' : ''}${a.detail}` : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="record-payment-drawer"
      title={row.number}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            {typeLabel} · {row.service}
          </span>
          <StatusPill status={row.status} />
        </span>
      }
      dirty={dirty}
      onSave={tab === 'record' ? save : undefined}
      actions={<IconButton icon={ExternalLink} label="Open in a tab" tooltipSide="bottom" onClick={() => onOpenInTab(row)} />}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} loading={pending} loadingText="Saving…" disabled={!recordable || saved} disabledReason={!recordable ? (reason ?? undefined) : saved ? 'This payment is saved.' : undefined} data-testid="save-payment">
            Save payment
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {saved ? 'Close' : 'Cancel'}
          </Button>
          <span className="ms-auto hidden items-center gap-1 text-ods-small text-ods-slate ods-tablet:inline-flex">
            Save <Kbd>Ctrl</Kbd> <Kbd>S</Kbd> · Close <Kbd>Esc</Kbd>
          </span>
        </div>
      }
    >
      <Tabs
        label={`${row.number} sections`}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'record', label: 'Record payment', disabled: !recordable, disabledReason: reason ?? undefined, panel: recordPanel },
          { id: 'details', label: 'Details', panel: detailsPanel },
          { id: 'activity', label: 'Activity', count: activity?.ok ? activity.items.length : undefined, panel: activityPanel },
        ]}
      />
    </Drawer>
  );
}
