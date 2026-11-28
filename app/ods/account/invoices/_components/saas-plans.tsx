'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, StatusPill } from '@octopus/ui';
import { dateText, moneyText } from '../../orders/_lib/commerce-format';
import { saasPayLater } from '../_lib/invoice-logic';

export type SaasPlanVM = { code: string; service: string; name: string; description: string | null; billing_interval: 'monthly' | 'annual'; price_cents: number; currency: string };
export type SaasSubscriptionVM = { id: string; plan_code: string; status: string; payment_option: string; current_period_start: string; current_period_end: string };
export type SaasVM = { plans: SaasPlanVM[]; subscriptions: SaasSubscriptionVM[]; creditEligible: boolean; creditAvailableCents: number; netDays: number; hasOnlineProvider: boolean };
/** TODAY's subscribeSaasPlanAction (app/account/payment-actions.ts → subscribe_saas_plan RPC), unchanged. */
export type SubscribeSaasAction = (input: { planCode: string; paymentOption: 'pay_now' | 'pay_later'; methodKind: 'card' | 'wallet' }) => Promise<{ ok: boolean; redirectUrl?: string; invoiceNumber?: string; error?: string }>;

/**
 * SaaS plans and recurring subscriptions — the ODS port of today's SaasPlansPanel (components/account/saas-plans-panel.tsx):
 * same data, buttons, wording and calls. Pay now (Online) only with an active provider; Pay now (Wallet) always;
 * Pay later (Net N) only for credit-eligible companies, enabled when available credit ≥ the plan price.
 */
export function SaasPlansCard({ saas, subscribe }: { saas: SaasVM; subscribe: SubscribeSaasAction }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (planCode: string, paymentOption: 'pay_now' | 'pay_later', methodKind: 'card' | 'wallet') => {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await subscribe({ planCode, paymentOption, methodKind });
      if (!res.ok) {
        setError(res.error ?? 'Subscription failed.');
        return;
      }
      if (res.redirectUrl) {
        router.push(res.redirectUrl);
        return;
      }
      setNotice(`Subscription active. Tax invoice ${res.invoiceNumber ?? ''} issued.`);
      router.refresh();
    });
  };

  return (
    <Card
      className="mt-4"
      title="SaaS plans and recurring subscriptions"
      headingLevel={2}
      description={
        saas.creditEligible
          ? `Subscribe with Pay now (online card / wallet) or Pay later (Net ${saas.netDays} credit terms). Payment protection is switched off by default for SaaS subscriptions.`
          : 'Subscribe with Pay now (online card / wallet). Payment protection is switched off by default for SaaS subscriptions.'
      }
      data-testid="saas-plans-panel"
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p className="m-0 rounded-ods-control bg-ods-danger-tint p-3 text-ods-small text-ods-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div aria-live="polite">
          {notice ? (
            <p className="m-0 rounded-ods-control bg-ods-success-tint p-3 text-ods-small text-ods-success" data-testid="saas-sub-notice">
              {notice}
            </p>
          ) : null}
        </div>
        {saas.subscriptions.length > 0 ? (
          <div className="rounded-ods-card border border-ods-line p-4" data-testid="active-saas-subscriptions">
            <h3 className="m-0 mb-2 text-ods-body font-semibold text-ods-navy">Your active subscriptions</h3>
            <ul role="list" className="m-0 flex list-none flex-col gap-2 p-0 text-ods-small">
              {saas.subscriptions.map((sub) => (
                <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <strong className="font-mono text-ods-navy">{sub.plan_code}</strong>
                    <StatusPill tone={sub.status === 'active' ? 'success' : 'neutral'}>{sub.status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</StatusPill>
                    <span className="text-ods-slate">({sub.payment_option.replace('_', ' ')})</span>
                  </span>
                  <span className="text-ods-slate">Current period ends {dateText(sub.current_period_end)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="grid gap-3 ods-tablet:grid-cols-2">
          {saas.plans.map((p) => {
            const later = saasPayLater(saas.creditEligible, saas.creditAvailableCents, p.price_cents);
            return (
              <div key={p.code} className="flex flex-col justify-between rounded-ods-card border border-ods-line bg-ods-canvas p-4" data-testid={`saas-plan-${p.code}`}>
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="m-0 text-ods-body font-semibold text-ods-navy">{p.name}</h3>
                    <span className="font-bold text-ods-navy tabular-nums">
                      {moneyText(p.price_cents, p.currency)} / {p.billing_interval === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </div>
                  {p.description ? <p className="m-0 mt-1 text-ods-small text-ods-slate">{p.description}</p> : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {saas.hasOnlineProvider ? (
                    <Button size="sm" disabled={pending} onClick={() => go(p.code, 'pay_now', 'card')} data-testid={`saas-pay-online-${p.code}`}>
                      Pay now (Online)
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => go(p.code, 'pay_now', 'wallet')} data-testid={`saas-pay-wallet-${p.code}`}>
                    Pay now (Wallet)
                  </Button>
                  {later.show ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || !later.allowed}
                      disabledReason={!later.allowed ? 'Insufficient available credit' : undefined}
                      title={later.allowed ? `Bill on Net ${saas.netDays} credit terms` : 'Insufficient available credit'}
                      onClick={() => go(p.code, 'pay_later', 'wallet')}
                      data-testid={`saas-pay-later-${p.code}`}
                    >
                      Pay later (Net {saas.netDays})
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
