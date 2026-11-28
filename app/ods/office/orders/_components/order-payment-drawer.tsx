'use client';

import { useRef, useState, useTransition } from 'react';
import { Button, Drawer, Field, Input, Kbd, Money, NumberInput, Select, cx, formatDate } from '@octopus/ui';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { currencyPrefix } from '@/app/ods/office/accounts/invoices/_components/record-payment-drawer';
import { amountToMinor, secondApproverNote, type PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import { ORDER_REFERENCE_MAX, defaultPaymentMinor, paymentBlock, validateOrderPayment } from '../_lib/order-core';
import type { OrderPaymentInput } from '../actions';

function Note({ tone, children, testId }: { tone: 'warning' | 'danger' | 'success' | 'info'; children: React.ReactNode; testId?: string }) {
  const t = { warning: 'border-ods-warning/30 bg-ods-warning-tint text-ods-warning', danger: 'border-ods-danger/30 bg-ods-danger-tint text-ods-danger', success: 'border-ods-success/30 bg-ods-success-tint text-ods-success', info: 'border-ods-blue/30 bg-ods-info-tint text-ods-info' }[tone];
  return (
    <div data-testid={testId} className={cx('rounded-ods-control border px-3 py-2 text-ods-small font-medium', t)}>
      {children}
    </div>
  );
}

export type OrderPaymentDrawerProps = {
  open: boolean;
  onClose: () => void;
  order: { id: string; code: string; customer: string; currency: string; totalMinor: number; paidMinor: number; balanceMinor: number; depositDueMinor: number };
  canPay: boolean;
  /** mfa_fresh(): false → today's "Recording a payment needs a fresh 2FA code" note */
  payFresh: boolean | null;
  approvalLimitMinor: number | null;
  onSave: (input: OrderPaymentInput) => Promise<PaymentOutcome>;
  onSaved?: () => void;
  initial?: { amount?: string; reference?: string; outcome?: PaymentOutcome };
};

/**
 * Order record › Record payment (460 px drawer, same layout and rules as the Invoices drawer: amount, method, bank
 * reference — only what today's record-payment step stores; date = the day it is recorded). Save → onSave =
 * recordOrderPaymentAction (two-person gate + TODAY's recordPaymentStepUp → record_payment).
 */
export function OrderPaymentDrawer(props: OrderPaymentDrawerProps) {
  return props.open ? <Body key={props.order.id} {...props} /> : null;
}

function Body({ onClose, order, canPay, payFresh, approvalLimitMinor, onSave, onSaved, initial }: OrderPaymentDrawerProps) {
  const block = paymentBlock(order.balanceMinor, canPay);
  const max = order.balanceMinor;
  const cur = currencyPrefix(order.currency);
  const startAmount = block ? '' : (defaultPaymentMinor(order) / 100).toFixed(2);
  const [amount, setAmount] = useState(initial?.amount ?? startAmount);
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [touched, setTouched] = useState(false);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(initial?.outcome ?? null);
  const [pending, start] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);

  const errs = touched && !block ? validateOrderPayment({ amount, reference, method }, max) : {};
  const amountMinor = amountToMinor(amount);
  const overLimit = approvalLimitMinor !== null && order.currency === 'USD' && Number.isFinite(amountMinor) && amountMinor > approvalLimitMinor;
  const limitText = secondApproverNote(approvalLimitMinor);
  const saved = outcome?.kind === 'saved';
  const dirty = !saved && (reference.trim() !== '' || amount !== startAmount);

  const save = () => {
    if (block || pending || saved) return;
    setTouched(true);
    const e = validateOrderPayment({ amount, reference, method }, max);
    if (e.amount || e.reference || e.method) {
      if (e.amount) amountRef.current?.focus();
      return;
    }
    start(async () => {
      const r = await onSave({ orderId: order.id, amount: (amountToMinor(amount) / 100).toFixed(2), method, reference: reference.trim() });
      setOutcome(r);
      if (r.kind === 'step-up') window.location.assign(r.redirect);
      if (r.kind === 'saved') onSaved?.();
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="office-record-payment"
      title={`Record payment · ${order.code}`}
      description={`${order.customer} · locked in ${order.currency}`}
      dirty={dirty}
      onSave={save}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} loading={pending} loadingText="Saving…" disabled={!!block || saved} disabledReason={block ?? (saved ? 'This payment is saved.' : undefined)} data-testid="save-payment">
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
      <div className="flex flex-col gap-4 pt-1">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 rounded-ods-control border border-ods-line bg-ods-canvas p-3 text-ods-small">
          <div>
            <dt className="text-ods-slate">Total</dt>
            <dd className="m-0 font-semibold"><Money amount={order.totalMinor / 100} currency={cur} /></dd>
          </div>
          <div>
            <dt className="text-ods-slate">Paid</dt>
            <dd className="m-0 font-semibold"><Money amount={order.paidMinor / 100} currency={cur} /></dd>
          </div>
          <div className="col-span-2">
            <dt className="text-ods-slate">{order.depositDueMinor > 0 ? 'Deposit due' : 'Balance due'}</dt>
            <dd className="m-0 text-ods-h2 font-bold text-ods-navy"><Money amount={(order.depositDueMinor || order.balanceMinor) / 100} currency={cur} /></dd>
          </div>
        </dl>
        {block ? <Note tone="info">{block}</Note> : null}
        {!block && payFresh === false ? (
          <Note tone="warning" testId="step-up-note">
            Recording a payment needs a fresh 2-step code (yours is older than 10 minutes).{' '}
            <a className="font-semibold underline" href={stepUpRedirect(`/office/orders/${order.id}?tab=payments&pay=1`)}>Confirm with your code</a>
          </Note>
        ) : null}
        <Field label={`Amount (${cur})`} required error={errs.amount} hint={`This order is locked in ${order.currency}; record the amount received in ${order.currency}.`}>
          <NumberInput ref={amountRef} data-testid="payment-amount" value={amount} onValueChange={(raw) => setAmount(raw)} min={0.01} max={max / 100} decimals={2} prefix={cur} className="text-end" disabled={saved || !!block} />
        </Field>
        <Field label="Date received" hint="Today’s record-payment step records the payment with today’s date." readOnly>
          <Input value={formatDate(new Date())} readOnly />
        </Field>
        <Field label="Method" required error={errs.method}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={saved || !!block}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Bank reference" required hint="e.g. SWIFT reference or PI number — must match the bank statement line." error={errs.reference}>
          <Input data-testid="payment-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={ORDER_REFERENCE_MAX} autoComplete="off" className="font-mono" disabled={saved || !!block} />
        </Field>
        {limitText && !block ? (
          <Note tone={overLimit ? 'warning' : 'info'}>
            {limitText}
            {overLimit ? ' This one goes to Approvals when you save.' : null}
          </Note>
        ) : null}
        <p className="m-0 text-ods-small text-ods-slate">It posts to the ledger and cannot be edited. Payment steps advance automatically when Finance matches money.</p>
        <div aria-live="polite">
          {outcome?.kind === 'second-approver' ? (
            <Note tone="warning" testId="second-approver-needed">
              <b>Second approver needed ({outcome.code}).</b> A different Finance user must approve it in Approvals. Nothing is recorded yet; once it is approved, open this order and save the payment again.
            </Note>
          ) : outcome?.kind === 'saved' ? (
            <Note tone="success" testId="payment-saved">
              {outcome.message}
              {outcome.approvalCode ? ` · approval ${outcome.approvalCode} used` : ''}
              {outcome.warning ? <span className="mt-1 block text-ods-warning">{outcome.warning}</span> : null}
            </Note>
          ) : outcome?.kind === 'error' || outcome?.kind === 'step-up' ? (
            <Note tone="danger">{outcome.message}</Note>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
