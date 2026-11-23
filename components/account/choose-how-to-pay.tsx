'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, fmtDate } from '@/lib/format';
import type {
  CustomerCreditStatus,
  PaymentOptionCode,
  PaymentOptionMatrixRow,
  PaymentProviderSettingRow,
  PaymentServiceCode,
  PaymentTargetType,
} from '@/lib/payments';
import {
  confirmPayLaterAction,
  openPaymentProtectionDisputeAction,
  payWithProtectionFromWalletAction,
  startOnlineCheckoutAction,
} from '@/app/account/payment-actions';

export type EscrowHoldSummary = {
  id: string;
  amount_cents: number;
  released_cents: number;
  refunded_cents: number;
  currency: string;
  release_rule: string;
  milestone_label: string;
  status: 'held' | 'partially_released' | 'disputed' | 'released' | 'refunded';
  dispute_reason: string | null;
  events: {
    id: string;
    step: string;
    title: string;
    body: string | null;
    amount_cents: number | null;
    created_at: string;
  }[];
};

function releaseLabelForRule(rule: string | null, autoDays: number | null, service: PaymentServiceCode): string {
  switch (rule) {
    case 'delivery_plus_days':
      return `tracking shows delivered (+${autoDays ?? 7} days dispute window)`;
    case 'pool_close':
      return 'the MOQ pool closes successfully';
    case 'service_month_end':
      return 'the end of the service month';
    case 'customer_confirmation':
      return 'your delivery confirmation';
    case 'milestones':
    default:
      if (service === 'dropship') return `tracking shows delivered (+${autoDays ?? 7} days dispute window)`;
      if (service === 'pools') return 'the MOQ pool closes successfully';
      if (service === 'warehouse') return 'the end of the service month';
      return '30% at production start, 70% at QC passed and shipped';
  }
}

export function ChooseHowToPay({
  service,
  targetType,
  targetId,
  amountCents,
  currency,
  reference,
  walletBalanceCents,
  walletEnabled,
  bankLines,
  bankNotes,
  optionSettings,
  activeProvider,
  creditStatus,
  existingHold,
  existingPayLaterReservation,
  onPayNowWalletAction,
}: {
  service: PaymentServiceCode;
  targetType: PaymentTargetType;
  targetId: string;
  amountCents: number;
  currency: 'USD' | 'CNY' | 'HKD';
  reference: string;
  walletBalanceCents: number;
  walletEnabled: boolean;
  bankLines: [string, string][];
  bankNotes?: string | null;
  optionSettings: PaymentOptionMatrixRow[];
  activeProvider: PaymentProviderSettingRow | null;
  creditStatus: CustomerCreditStatus;
  existingHold?: EscrowHoldSummary | null;
  existingPayLaterReservation?: {
    id: string;
    status: string;
    net_days: number;
    invoice_trigger: string;
    amount_cents: number;
  } | null;
  onPayNowWalletAction?: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeForm, setShowDisputeForm] = useState(false);

  const byOpt = Object.fromEntries(optionSettings.map((r) => [r.option, r])) as Record<
    PaymentOptionCode,
    PaymentOptionMatrixRow | undefined
  >;

  const payNowCfg = byOpt.pay_now;
  const protCfg = byOpt.payment_protection;
  const laterCfg = byOpt.pay_later;

  const isOptionEnabled = (cfg: PaymentOptionMatrixRow | undefined) => {
    if (!cfg || !cfg.enabled) return false;
    if (amountCents < Number(cfg.min_amount_cents ?? 0)) return false;
    if (cfg.max_amount_cents != null && amountCents > Number(cfg.max_amount_cents)) return false;
    return true;
  };

  const payNowEnabled = isOptionEnabled(payNowCfg);
  const protEnabled = isOptionEnabled(protCfg);
  const laterMatrixEnabled = isOptionEnabled(laterCfg);

  const defaultTab: PaymentOptionCode = payNowEnabled
    ? 'pay_now'
    : protEnabled
      ? 'payment_protection'
      : 'pay_later';

  const [selected, setSelected] = useState<PaymentOptionCode>(defaultTab);

  // Surcharge calculation if active provider has fee_mode === 'surcharge'
  const surchargeCents =
    activeProvider && activeProvider.fee_mode === 'surcharge'
      ? Math.round((amountCents * activeProvider.fee_bp) / 10000) + Number(activeProvider.fee_fixed_cents)
      : 0;
  const onlineTotalCents = amountCents + surchargeCents;

  const milestoneText = releaseLabelForRule(
    protCfg?.release_rule ?? null,
    protCfg?.auto_release_days ?? null,
    service,
  );

  const payLaterAllowed =
    laterMatrixEnabled && creditStatus.eligible && creditStatus.available_cents >= amountCents;

  const payLaterDisabledReason = !laterMatrixEnabled
    ? 'Not enabled for this service'
    : !creditStatus.eligible
      ? creditStatus.reason ?? 'Ask your account manager to set up credit'
      : creditStatus.available_cents < amountCents
        ? `Insufficient available credit (${money(creditStatus.available_cents, currency)} available)`
        : null;

  function handleOnlineCheckout(option: 'pay_now' | 'payment_protection', methodKind: 'card' | 'local_transfer' = 'card') {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await startOnlineCheckoutAction({
        service,
        paymentOption: option,
        targetType,
        targetId,
        amountCents,
        currency,
        methodKind,
        description: `${service} · ${reference}`,
        returnUrl: `/account/orders/${targetId}`,
      });
      if (!res.ok || !res.redirectUrl) {
        setError(res.error ?? 'Could not start online checkout.');
        return;
      }
      router.push(res.redirectUrl);
    });
  }

  function handlePayNowWallet() {
    if (!onPayNowWalletAction) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await onPayNowWalletAction();
      if (!res.ok) {
        setError(res.error ?? 'Wallet payment failed.');
        return;
      }
      setNotice('Paid from wallet.');
      router.refresh();
    });
  }

  function handleProtectionWallet() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await payWithProtectionFromWalletAction({
        service,
        targetType,
        targetId,
        amountCents,
        currency,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not fund Payment protection from wallet.');
        return;
      }
      setNotice('Payment protection funded and held until milestone completion.');
      router.refresh();
    });
  }

  function handleConfirmPayLater() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await confirmPayLaterAction({
        service,
        targetType,
        targetId,
        amountCents,
        currency,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not confirm Pay later.');
        return;
      }
      setNotice(
        res.invoiceNumber
          ? `Confirmed on Net ${res.netDays} terms. Invoice ${res.invoiceNumber} issued.`
          : `Confirmed on Net ${res.netDays} credit terms. Amount reserved against your credit limit; tax invoice issues at shipment.`,
      );
      router.refresh();
    });
  }

  function handleOpenDispute(holdId: string) {
    setError(null);
    startTransition(async () => {
      const res = await openPaymentProtectionDisputeAction({
        holdId,
        reason: disputeReason,
        orderId: targetType === 'order' ? targetId : null,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not open dispute.');
        return;
      }
      setShowDisputeForm(false);
      setDisputeReason('');
      setNotice('Dispute opened — your held funds are frozen while Finance reviews your case.');
      router.refresh();
    });
  }

  // If there is already an active Payment protection hold on this order, render the status timeline + dispute controls
  if (existingHold) {
    const remainingHeld =
      Number(existingHold.amount_cents) -
      Number(existingHold.released_cents) -
      Number(existingHold.refunded_cents);
    const canDispute =
      (existingHold.status === 'held' || existingHold.status === 'partially_released') &&
      remainingHeld > 0;

    return (
      <div className="space-y-4" data-testid="payment-protection-active-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div>
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
              Payment protection
            </span>
            <h3 className="mt-1 text-base font-semibold text-ink">
              Payment protection — we hold your payment until {existingHold.milestone_label}
            </h3>
          </div>
          <div className="text-right font-mono text-sm">
            <div className="text-xs text-muted">Currently held</div>
            <div className="font-bold text-ink" data-testid="protection-remaining-held">
              {money(remainingHeld, existingHold.currency)}
            </div>
          </div>
        </div>

        {/* 4-Step Status Bar: Paid → Held → Milestone reached → Released / Refunded */}
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="protection-steps">
          {[
            { key: 'paid', label: '1. Paid', done: true },
            { key: 'held', label: '2. Held', done: true },
            {
              key: 'milestone',
              label: '3. Milestone reached',
              done: existingHold.released_cents > 0 || existingHold.status === 'released',
            },
            {
              key: 'closed',
              label: existingHold.status === 'refunded' ? '4. Refunded' : '4. Released',
              done: existingHold.status === 'released' || existingHold.status === 'refunded',
            },
          ].map((s) => (
            <li
              key={s.key}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                s.done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  : 'border-line bg-surface text-muted'
              }`}
            >
              {s.label}
            </li>
          ))}
        </ol>

        {existingHold.status === 'disputed' && (
          <div
            className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
            data-testid="protection-disputed-banner"
          >
            <strong>Dispute open — held funds frozen:</strong> {existingHold.dispute_reason}
          </div>
        )}

        {existingHold.events.length > 0 && (
          <ul className="space-y-2 border-t border-line pt-3 text-xs">
            {existingHold.events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap justify-between gap-2 text-muted">
                <span>
                  <strong className="text-ink">{ev.title}</strong>
                  {ev.body ? ` — ${ev.body}` : ''}
                </span>
                <span className="font-mono">{fmtDate(ev.created_at)}</span>
              </li>
            ))}
          </ul>
        )}

        {canDispute && (
          <div className="border-t border-line pt-3">
            {!showDisputeForm ? (
              <button
                type="button"
                onClick={() => setShowDisputeForm(true)}
                data-testid="open-dispute-btn"
                className="inline-flex min-h-10 items-center rounded-lg border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-ink hover:bg-surface"
              >
                Open a dispute (freeze held payment)
              </button>
            ) : (
              <div className="space-y-2 rounded-xl border border-line bg-surface p-3" data-testid="dispute-form">
                <label className="block text-xs font-semibold text-ink">
                  Tell us what went wrong (freezes {money(remainingHeld, existingHold.currency)} until resolved)
                </label>
                <textarea
                  rows={2}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  data-testid="dispute-reason-input"
                  placeholder="Describe the quality, quantity or delivery issue…"
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleOpenDispute(existingHold.id)}
                    data-testid="submit-dispute-btn"
                    className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white"
                  >
                    {pending ? 'Freezing hold…' : 'Freeze held payment & submit dispute'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDisputeForm(false)}
                    className="inline-flex min-h-10 items-center rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // If there is already an active Pay-later reservation awaiting shipment invoice
  if (existingPayLaterReservation && existingPayLaterReservation.status === 'reserved') {
    return (
      <div
        className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950"
        data-testid="pay-later-reserved-banner"
      >
        <div className="font-semibold">
          Confirmed on Pay later (Net {existingPayLaterReservation.net_days} days)
        </div>
        <p className="mt-1 text-xs text-emerald-900">
          {money(existingPayLaterReservation.amount_cents, currency)} is reserved against your credit limit. Your{' '}
          <span className="font-mono">OCT-</span> tax invoice and due date will be issued automatically at{' '}
          <strong>{existingPayLaterReservation.invoice_trigger.replace('_', ' ')}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="choose-how-to-pay">
      <div>
        <h3 className="text-base font-semibold text-ink">Choose how to pay</h3>
        <p className="text-xs text-muted">
          Amount due: <strong className="font-mono text-ink">{money(amountCents, currency)}</strong> · Reference{' '}
          <span className="font-mono">{reference}</span>
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900" role="alert" data-testid="payment-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-950" data-testid="payment-notice">
          {notice}
        </div>
      )}

      {/* Three mobile-first option cards */}
      <div className="grid gap-3 md:grid-cols-3">
        {payNowEnabled && (
          <button
            type="button"
            onClick={() => setSelected('pay_now')}
            data-testid="option-card-pay_now"
            className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
              selected === 'pay_now'
                ? 'border-ink bg-surface ring-1 ring-ink'
                : 'border-line bg-canvas hover:border-ink/40'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">1. Pay now</span>
                <span className="font-mono text-xs font-semibold text-ink">{money(amountCents, currency)}</span>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Pay immediately via online card/local rails, wallet balance, or bank transfer.
              </p>
            </div>
            <div className="mt-3 text-[11px] font-medium text-ink">
              {surchargeCents > 0
                ? `Online fee: +${money(surchargeCents, currency)} · Wallet/Bank: no fee`
                : 'No payment surcharge'}
            </div>
          </button>
        )}

        {protEnabled && (
          <button
            type="button"
            onClick={() => setSelected('payment_protection')}
            data-testid="option-card-payment_protection"
            className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
              selected === 'payment_protection'
                ? 'border-ink bg-surface ring-1 ring-ink'
                : 'border-line bg-canvas hover:border-ink/40'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">2. Payment protection</span>
                <span className="font-mono text-xs font-semibold text-ink">{money(amountCents, currency)}</span>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Payment protection — we hold your payment until <strong>{milestoneText}</strong>.
              </p>
            </div>
            <div className="mt-3 text-[11px] font-medium text-emerald-800">
              Dispute protection included before release
            </div>
          </button>
        )}

        {laterMatrixEnabled && (
          <button
            type="button"
            onClick={() => setSelected('pay_later')}
            data-testid="option-card-pay_later"
            className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
              selected === 'pay_later'
                ? 'border-ink bg-surface ring-1 ring-ink'
                : 'border-line bg-canvas hover:border-ink/40'
            } ${!payLaterAllowed ? 'opacity-75' : ''}`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">
                  3. Pay later {creditStatus.eligible ? `(Net ${creditStatus.net_days})` : ''}
                </span>
                <span className="font-mono text-xs font-semibold text-ink">{money(amountCents, currency)}</span>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {payLaterAllowed
                  ? `Confirm order now and pay within ${creditStatus.net_days} days of invoice.`
                  : payLaterDisabledReason}
              </p>
            </div>
            <div className="mt-3 text-[11px] font-medium text-ink">
              {creditStatus.eligible
                ? `Available credit: ${money(creditStatus.available_cents, currency)} of ${money(creditStatus.credit_limit_cents, currency)}`
                : 'Ask your account manager to set up credit'}
            </div>
          </button>
        )}
      </div>

      {/* Selected Option Action Panel */}
      {selected === 'pay_now' && payNowEnabled && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-4" data-testid="panel-pay_now">
          <div className="grid gap-4 md:grid-cols-3">
            {/* 1. Online Aggregator */}
            <div className="rounded-xl border border-line bg-canvas p-4 flex flex-col justify-between">
              <div>
                <div className="text-sm font-semibold text-ink">
                  Pay online ({activeProvider?.display_name ?? 'Card & Local Rails'})
                </div>
                <p className="mt-1 text-xs text-muted">
                  Instant confirmation via signature-verified webhook.
                </p>
                {surchargeCents > 0 && (
                  <p className="mt-2 text-xs text-amber-900" data-testid="checkout-surcharge-line">
                    Includes {money(surchargeCents, currency)} aggregator surcharge · Total{' '}
                    <strong>{money(onlineTotalCents, currency)}</strong>
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={pending || !activeProvider}
                onClick={() => handleOnlineCheckout('pay_now', 'card')}
                data-testid="pay-now-online-btn"
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                {pending ? 'Opening checkout…' : `Pay ${money(onlineTotalCents, currency)} online`}
              </button>
            </div>

            {/* 2. Wallet Balance */}
            {walletEnabled && (
              <div className="rounded-xl border border-line bg-canvas p-4 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-semibold text-ink">Pay from {currency} wallet</div>
                  <p className="mt-1 text-xs text-muted">
                    Real wallet balance: <strong className="font-mono text-ink">{money(walletBalanceCents, currency)}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending || walletBalanceCents < amountCents || !onPayNowWalletAction}
                  onClick={handlePayNowWallet}
                  data-testid="pay-now-wallet-btn"
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-ink bg-ink px-4 py-2 text-xs font-semibold text-canvas hover:opacity-95 disabled:opacity-40"
                >
                  {walletBalanceCents < amountCents
                    ? 'Insufficient wallet balance'
                    : `Pay ${money(amountCents, currency)} from wallet`}
                </button>
              </div>
            )}

            {/* 3. Bank Transfer */}
            <div className="rounded-xl border border-line bg-canvas p-4">
              <div className="text-sm font-semibold text-ink">Bank transfer</div>
              <dl className="mt-2 space-y-1 text-xs">
                {bankLines.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-mono font-medium text-right text-ink">{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Reference</dt>
                  <dd className="font-mono font-semibold text-ink">{reference}</dd>
                </div>
              </dl>
              {bankNotes && <p className="mt-2 text-[11px] text-muted">{bankNotes}</p>}
            </div>
          </div>
        </div>
      )}

      {selected === 'payment_protection' && protEnabled && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-4" data-testid="panel-payment_protection">
          <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 text-xs text-emerald-950">
            <strong>Payment protection — we hold your payment until {milestoneText}.</strong>
            <p className="mt-1 text-emerald-900">
              Your funds are held in a dedicated protection liability account and are only released to revenue and
              invoiced once the milestone is reached. You can open a dispute at any time before release to freeze the
              held payment.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-canvas p-4 flex flex-col justify-between">
              <div>
                <div className="text-sm font-semibold text-ink">
                  Fund Payment protection online ({activeProvider?.display_name ?? 'Card & Local Rails'})
                </div>
                <p className="mt-1 text-xs text-muted">
                  Held until {milestoneText}.
                </p>
              </div>
              <button
                type="button"
                disabled={pending || !activeProvider}
                onClick={() => handleOnlineCheckout('payment_protection', 'card')}
                data-testid="protection-online-btn"
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                {pending
                  ? 'Opening checkout…'
                  : `Pay & Hold ${money(onlineTotalCents, currency)} online`}
              </button>
            </div>

            {walletEnabled && (
              <div className="rounded-xl border border-line bg-canvas p-4 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-semibold text-ink">Fund Payment protection from wallet</div>
                  <p className="mt-1 text-xs text-muted">
                    Available wallet balance: <strong className="font-mono text-ink">{money(walletBalanceCents, currency)}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending || walletBalanceCents < amountCents}
                  onClick={handleProtectionWallet}
                  data-testid="protection-wallet-btn"
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-ink bg-ink px-4 py-2 text-xs font-semibold text-canvas hover:opacity-95 disabled:opacity-40"
                >
                  {walletBalanceCents < amountCents
                    ? 'Insufficient wallet balance'
                    : `Pay & Hold ${money(amountCents, currency)} from wallet`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {selected === 'pay_later' && laterMatrixEnabled && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-4" data-testid="panel-pay_later">
          {payLaterAllowed ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 text-xs">
                <div className="text-sm font-semibold text-ink">
                  Confirm on Net {creditStatus.net_days} credit terms
                </div>
                <p className="text-muted">
                  Available credit:{' '}
                  <strong className="font-mono text-ink">
                    {money(creditStatus.available_cents, currency)}
                  </strong>{' '}
                  (Limit {money(creditStatus.credit_limit_cents, currency)} · Unpaid invoices{' '}
                  {money(creditStatus.unpaid_invoices_cents, currency)} · Reserved orders{' '}
                  {money(creditStatus.reserved_cents, currency)})
                </p>
                <p className="text-muted">
                  What happens next: we reserve{' '}
                  <strong className="font-mono text-ink">{money(amountCents, currency)}</strong> against your credit
                  limit now. For goods orders, your <span className="font-mono">OCT-</span> tax invoice is issued at{' '}
                  <strong>shipment</strong> (due {creditStatus.net_days} days from the invoice date).
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirmPayLater}
                data-testid="confirm-pay-later-btn"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                {pending
                  ? 'Reserving credit…'
                  : `Confirm with Pay later (${money(amountCents, currency)} · Net ${creditStatus.net_days})`}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" data-testid="pay-later-disabled-msg">
              <strong>Pay later unavailable:</strong> {payLaterDisabledReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
