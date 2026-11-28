'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, DollarSign, Landmark, ShieldCheck, CreditCard } from 'lucide-react';
import { Button, Card, Field, Modal, Money, StatusPill, Textarea } from '@octopus/ui';
import type { PaymentServiceCode, PaymentTargetType } from '@/lib/payments';
import { curLabel, moneyText, units } from '../_lib/commerce-format';
import { walletCovers } from '../_lib/order-logic';
import type { OrderDetailVM, OrderPaymentPanelVM } from '../_lib/order-types';
import { KV, PanelError } from './commerce-ui';

type Cur = 'USD' | 'CNY' | 'HKD';
/** TODAY's server actions, passed in by the page (fixtures pass sample stubs). The signatures are today's. */
export type OrderPayActions = {
  /** app/account/orders/actions.ts payFromWallet → record_payment RPC */
  payFromWallet: (orderId: string) => Promise<{ ok: true; data?: undefined } | { ok: false; error: string }>;
  /** app/account/payment-actions.ts startOnlineCheckoutAction → create_payment_checkout RPC + provider page */
  startOnlineCheckout: (input: {
    service: PaymentServiceCode;
    paymentOption: 'pay_now' | 'payment_protection';
    targetType: PaymentTargetType;
    targetId: string;
    amountCents: number;
    currency: Cur;
    methodKind?: 'card' | 'local_transfer';
    description?: string;
    returnUrl?: string;
  }) => Promise<{ ok: boolean; redirectUrl?: string; error?: string }>;
  /** app/account/payment-actions.ts payWithProtectionFromWalletAction → pay_with_protection_wallet RPC */
  payWithProtectionFromWallet: (input: { service: PaymentServiceCode; targetType: PaymentTargetType; targetId: string; amountCents: number; currency: Cur }) => Promise<{ ok: boolean; error?: string }>;
  /** app/account/payment-actions.ts openPaymentProtectionDisputeAction → open_escrow_dispute RPC */
  openDispute: (input: { holdId: string; reason: string; orderId?: string | null }) => Promise<{ ok: boolean; error?: string }>;
  /** app/account/payment-actions.ts confirmPayLaterAction → checkout_pay_later RPC (credit-eligible companies only) */
  confirmPayLater: (input: { service: PaymentServiceCode; targetType: PaymentTargetType; targetId: string; amountCents: number; currency: Cur }) => Promise<{
    ok: boolean;
    status?: string;
    invoiceNumber?: string | null;
    netDays?: number;
    error?: string;
  }>;
};

export const ORDER_PAY_EVENT = 'ods:order-pay';

/**
 * Overview › Payment card (6.5): total, deposit, paid, balance due + the pay buttons for the current step.
 * Every button calls TODAY's action with the same arguments today's order page sends (ChooseHowToPay + quick wallet
 * checkout); nothing is calculated here except the wallet-cover check that today's confirm dialog also shows.
 * Pay later shows ONLY when the loader set `payment.payLater` (credit-eligible company + today's conditions); for
 * everyone else nothing about it is rendered. The header's primary button opens the same wallet dialog (window event ORDER_PAY_EVENT).
 */
export function OrderPaymentCard({ order, actions }: { order: Pick<OrderDetailVM, 'id' | 'ref' | 'currency' | 'money' | 'payment' | 'showPayment' | 'rawStatus'>; actions: OrderPayActions }) {
  const router = useRouter();
  const p = order.payment;
  const m = order.money;
  const cur = curLabel(order.currency);
  const [walletOpen, setWalletOpen] = useState(false);
  const [protOpen, setProtOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const open = () => {
      if (p?.choices.wallet) setWalletOpen(true);
      else document.getElementById('payment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(ORDER_PAY_EVENT, open);
    return () => window.removeEventListener(ORDER_PAY_EVENT, open);
  }, [p?.choices.wallet]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; redirectUrl?: string }>, done: string, close: () => void) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'The payment could not be made. Please try again or message us.');
        return;
      }
      close();
      if (r.redirectUrl) {
        router.push(r.redirectUrl);
        return;
      }
      setNotice(done);
      router.refresh();
    });
  };

  const online = (option: 'pay_now' | 'payment_protection', pp: OrderPaymentPanelVM) =>
    run(
      async () => {
        const r = await actions.startOnlineCheckout({
          service: pp.service,
          paymentOption: option,
          targetType: 'order',
          targetId: order.id,
          amountCents: pp.amountCents,
          currency: pp.currencyCode,
          methodKind: 'card',
          description: `${pp.service} · ${pp.reference}`,
          returnUrl: `/account/orders/${order.id}`,
        });
        return r.ok && !r.redirectUrl ? { ok: false, error: r.error ?? 'Could not start online checkout.' } : r;
      },
      'Opening the payment page…',
      () => setProtOpen(false),
    );

  const purposeWord = p?.duePurpose === 'deposit' ? 'deposit' : 'balance';
  const covers = p ? walletCovers(p.amountCents, p.walletBalanceCents, p.walletCreditCents) : false;

  return (
    <Card title="Payment" headingLevel={2} id="payment" data-testid="payment-card" className="scroll-mt-24">
      <dl className="m-0 text-ods-body">
        <KV k="Order total">
          <Money amount={units(m.totalCents)} currency={cur} />
        </KV>
        <KV k={`Deposit ${m.depositPct}%`}>
          <Money amount={units(m.depositCents)} currency={cur} />
        </KV>
        <KV k="Paid so far">
          <Money amount={units(m.paidCents)} currency={cur} />
        </KV>
        <KV k={m.due ? `${m.due.purpose === 'deposit' ? 'Deposit' : 'Balance'} due now` : 'Balance'} strong>
          <Money amount={units(m.due ? m.due.amount : m.balanceCents)} currency={cur} />
        </KV>
      </dl>

      {!order.showPayment ? null : !p ? (
        <div className="mt-3">
          <PanelError what="the payment options" href={`/account/orders/${encodeURIComponent(order.ref)}`} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {p.hold ? (
            <div className="rounded-ods-card border border-ods-line bg-ods-canvas p-4" data-testid="protection-status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-semibold text-ods-navy">
                  <ShieldCheck aria-hidden="true" className="size-ods-icon text-ods-success" /> Payment protection
                </span>
                <StatusPill status={p.hold.statusName} />
              </div>
              <p className="m-0 mt-2 text-ods-small text-ods-slate">
                We hold <Money amount={units(p.hold.heldCents)} currency={curLabel(p.hold.currency)} /> until {p.hold.milestone}.
              </p>
              {p.hold.disputed ? (
                <p className="m-0 mt-2 rounded-ods-control bg-ods-warning-tint p-3 text-ods-small text-ods-warning" role="status">
                  <strong>Dispute open — held money is frozen.</strong> {p.hold.disputeReason}
                </p>
              ) : null}
              {p.hold.canDispute ? (
                <div className="mt-3">
                  <Button variant="secondary" size="sm" onClick={() => setDisputeOpen(true)} data-testid="open-dispute">
                    Open a dispute
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {p.reservation ? (
            <div className="m-0 rounded-ods-card bg-ods-success-tint p-3 text-ods-small text-ods-success" role="status" data-testid="pay-later-reserved-banner">
              <p className="m-0 font-semibold">Confirmed on Pay later (Net {p.reservation.netDays} days)</p>
              <p className="m-0 mt-1">
                {moneyText(p.reservation.amountCents, order.currency)} is reserved against your credit limit. Your <span className="font-mono">OCT-</span> tax invoice and due date will be issued automatically at{' '}
                <strong>{p.reservation.trigger}</strong>.
              </p>
            </div>
          ) : null}

          {p.choices.wallet || p.choices.online || p.choices.protection || p.payLater ? (
            <div className="flex flex-wrap gap-2">
              {p.choices.wallet ? (
                <Button iconStart={DollarSign} onClick={() => setWalletOpen(true)} data-testid="pay-button">
                  Pay {purposeWord}
                </Button>
              ) : null}
              {p.choices.online ? (
                <Button variant="secondary" iconStart={CreditCard} loading={pending} onClick={() => online('pay_now', p)} data-testid="pay-online">
                  Pay online
                </Button>
              ) : null}
              {p.choices.protection ? (
                <Button variant="secondary" iconStart={ShieldCheck} onClick={() => setProtOpen(true)} data-testid="pay-protection">
                  Pay with Payment protection
                </Button>
              ) : null}
              {p.payLater ? (
                <Button
                  variant="secondary"
                  iconStart={CalendarClock}
                  onClick={() => setLaterOpen(true)}
                  disabled={!p.payLater.allowed}
                  disabledReason={p.payLater.disabledReason ? `Pay later unavailable: ${p.payLater.disabledReason}` : undefined}
                  data-testid="option-card-pay_later"
                >
                  Pay later (Net {p.payLater.netDays})
                </Button>
              ) : null}
            </div>
          ) : null}
          {p.payLater ? (
            <p className="m-0 text-ods-small text-ods-slate" data-testid="pay-later-credit">
              {p.payLater.allowed ? `Confirm order now and pay within ${p.payLater.netDays} days of invoice. ` : null}
              Available credit: {moneyText(p.payLater.availableCents, order.currency)} of {moneyText(p.payLater.limitCents, order.currency)}
            </p>
          ) : null}
          {p.choices.online && p.providerSurcharge ? <p className="m-0 text-ods-small text-ods-slate">Paying online may add a card fee; the payment page shows it before you pay. Wallet and bank transfer: no fee.</p> : null}

          {p.amountCents > 0 && !p.hold && !p.reservation ? (
            <details className="rounded-ods-card border border-ods-line p-3" data-testid="bank-transfer">
              <summary className="flex min-h-ods-control cursor-pointer items-center gap-2 font-semibold text-ods-navy">
                <Landmark aria-hidden="true" className="size-ods-icon" /> Pay by bank transfer
              </summary>
              <dl className="m-0 mt-2 text-ods-small">
                {p.bankLines.map(([k, v]) => (
                  <KV key={k} k={k}>
                    <span className="font-mono">{v}</span>
                  </KV>
                ))}
                <KV k="Reference" strong>
                  <span className="font-mono">{p.reference}</span>
                </KV>
              </dl>
              {p.bankNotes ? <p className="m-0 mt-2 text-ods-small text-ods-slate">{p.bankNotes}</p> : null}
              <p className="m-0 mt-2 text-ods-small text-ods-slate">Quote the reference so finance can match your payment.</p>
            </details>
          ) : null}

          <div aria-live="polite">
            {notice ? (
              <p className="m-0 rounded-ods-control bg-ods-success-tint p-3 text-ods-small text-ods-success" role="status">
                {notice}
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="m-0 rounded-ods-control bg-ods-danger-tint p-3 text-ods-small text-ods-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}

      {p ? (
        <>
          <Modal
            open={walletOpen}
            onClose={() => setWalletOpen(false)}
            title={`Pay the ${purposeWord} from your ${order.currency} wallet`}
            description="The amount is taken from your wallet straight away."
            footer={
              <>
                <Button variant="secondary" onClick={() => setWalletOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => run(() => actions.payFromWallet(order.id), `Paid from your wallet. Thank you.`, () => setWalletOpen(false))}
                  loading={pending}
                  loadingText="Paying…"
                  disabled={!covers}
                  disabledReason={!covers ? 'Not enough in your wallet' : undefined}
                  data-testid="confirm-wallet-pay"
                >
                  Pay {moneyText(p.amountCents, order.currency)}
                </Button>
              </>
            }
          >
            <dl className="m-0 text-ods-body">
              <KV k="Amount">
                <Money amount={units(p.amountCents)} currency={cur} />
              </KV>
              <KV k="Wallet balance">
                <Money amount={units(p.walletBalanceCents)} currency={cur} />
              </KV>
              {p.walletCreditCents > 0 ? (
                <KV k="Credit limit">
                  <Money amount={units(p.walletCreditCents)} currency={cur} />
                </KV>
              ) : null}
            </dl>
            {!covers ? (
              <p className="m-0 mt-3 text-ods-small text-ods-danger">
                Your {order.currency} wallet doesn&apos;t cover this payment.{' '}
                <a href="/account/wallet" className="font-semibold underline">
                  Add funds
                </a>{' '}
                or pay by bank transfer.
              </p>
            ) : null}
            {error ? (
              <p className="m-0 mt-3 text-ods-small text-ods-danger" role="alert">
                {error}
              </p>
            ) : null}
          </Modal>

          <Modal
            open={protOpen}
            onClose={() => setProtOpen(false)}
            title="Pay with Payment protection"
            description={`We hold ${moneyText(p.amountCents, order.currency)} and release it to us only when the milestone is reached. You can open a dispute before release.`}
            footer={
              <Button variant="secondary" onClick={() => setProtOpen(false)} disabled={pending}>
                Cancel
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {p.choices.protectionWallet ? (
                <Button
                  fullWidth
                  onClick={() =>
                    run(
                      () => actions.payWithProtectionFromWallet({ service: p.service, targetType: 'order', targetId: order.id, amountCents: p.amountCents, currency: p.currencyCode }),
                      'Payment protection is funded. We hold the money until the milestone.',
                      () => setProtOpen(false),
                    )
                  }
                  loading={pending}
                  disabled={p.walletBalanceCents < p.amountCents}
                  disabledReason={p.walletBalanceCents < p.amountCents ? 'Not enough in your wallet' : undefined}
                  data-testid="protection-wallet"
                >
                  Pay and hold {moneyText(p.amountCents, order.currency)} from wallet
                </Button>
              ) : null}
              {p.choices.protectionOnline ? (
                <Button fullWidth variant="secondary" onClick={() => online('payment_protection', p)} loading={pending} data-testid="protection-online">
                  Pay and hold online{p.providerName ? ` (${p.providerName})` : ''}
                </Button>
              ) : null}
              {error ? (
                <p className="m-0 text-ods-small text-ods-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </Modal>

          {p.payLater && p.payLater.allowed ? (
            <Modal
              open={laterOpen}
              onClose={() => setLaterOpen(false)}
              title={`Confirm on Net ${p.payLater.netDays} credit terms`}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setLaterOpen(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button
                    loading={pending}
                    loadingText="Reserving credit…"
                    data-testid="confirm-pay-later-btn"
                    onClick={() => {
                      const pl = p.payLater!;
                      setError(null);
                      setNotice(null);
                      start(async () => {
                        const res = await actions.confirmPayLater({ service: p.service, targetType: 'order', targetId: order.id, amountCents: p.amountCents, currency: p.currencyCode });
                        if (!res.ok) {
                          setError(res.error ?? 'Could not confirm Pay later.');
                          return;
                        }
                        setLaterOpen(false);
                        setNotice(
                          res.invoiceNumber
                            ? `Confirmed on Net ${res.netDays ?? pl.netDays} terms. Invoice ${res.invoiceNumber} issued.`
                            : `Confirmed on Net ${res.netDays ?? pl.netDays} credit terms. Amount reserved against your credit limit; tax invoice issues at shipment.`,
                        );
                        router.refresh();
                      });
                    }}
                  >
                    Confirm with Pay later ({moneyText(p.amountCents, order.currency)} · Net {p.payLater.netDays})
                  </Button>
                </>
              }
            >
              <div className="flex flex-col gap-2 text-ods-small text-ods-slate" data-testid="panel-pay_later">
                <p className="m-0">
                  Available credit: <strong className="font-mono text-ods-navy">{moneyText(p.payLater.availableCents, order.currency)}</strong> (Limit {moneyText(p.payLater.limitCents, order.currency)} · Unpaid invoices{' '}
                  {moneyText(p.payLater.unpaidCents, order.currency)} · Reserved orders {moneyText(p.payLater.reservedCents, order.currency)})
                </p>
                <p className="m-0">
                  What happens next: we reserve <strong className="font-mono text-ods-navy">{moneyText(p.amountCents, order.currency)}</strong> against your credit limit now. For goods orders, your{' '}
                  <span className="font-mono">OCT-</span> tax invoice is issued at <strong>shipment</strong> (due {p.payLater.netDays} days from the invoice date).
                </p>
                {error ? (
                  <p className="m-0 text-ods-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </Modal>
          ) : null}

          {p.hold ? (
            <Modal
              open={disputeOpen}
              onClose={() => setDisputeOpen(false)}
              title="Open a dispute"
              description={`This freezes ${moneyText(p.hold.heldCents, p.hold.currency)} until our team decides.`}
              destructive
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDisputeOpen(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    loading={pending}
                    disabled={!reason.trim()}
                    disabledReason={!reason.trim() ? 'Tell us what went wrong first' : undefined}
                    onClick={() => run(() => actions.openDispute({ holdId: p.hold!.id, reason, orderId: order.id }), 'Dispute opened. Your held money is frozen while we review it.', () => setDisputeOpen(false))}
                    data-testid="submit-dispute"
                  >
                    Freeze payment and open dispute
                  </Button>
                </>
              }
            >
              <Field label="What went wrong?" required>
                {(c) => <Textarea {...c} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
              {error ? (
                <p className="m-0 mt-2 text-ods-small text-ods-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </Modal>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** Header primary button for the current step: opens the Payment card's wallet dialog (or scrolls to the card). */
export function PayNowButton({ label }: { label: string }) {
  return (
    <Button iconStart={DollarSign} onClick={() => window.dispatchEvent(new Event(ORDER_PAY_EVENT))} data-testid="header-pay-button">
      {label}
    </Button>
  );
}
