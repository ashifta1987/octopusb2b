'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, fmtDate } from '@/lib/format';
import { subscribeSaasPlanAction } from '@/app/account/payment-actions';

export type SaasPlanRow = {
  code: string;
  service: string;
  name: string;
  description: string | null;
  billing_interval: 'monthly' | 'annual';
  price_cents: number;
  currency: string;
};

export type SaasSubscriptionRow = {
  id: string;
  plan_code: string;
  status: string;
  payment_option: string;
  current_period_start: string;
  current_period_end: string;
};

export function SaasPlansPanel({
  plans,
  subscriptions,
  creditEligible,
  creditAvailableCents,
  netDays,
  hasOnlineProvider = false,
}: {
  plans: SaasPlanRow[];
  subscriptions: SaasSubscriptionRow[];
  creditEligible: boolean;
  creditAvailableCents: number;
  netDays: number;
  hasOnlineProvider?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handleSubscribe(planCode: string, paymentOption: 'pay_now' | 'pay_later', methodKind: 'card' | 'wallet') {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await subscribeSaasPlanAction({ planCode, paymentOption, methodKind });
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
  }

  return (
    <div className="card p-5 mt-6 space-y-4" data-testid="saas-plans-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">SaaS Plans &amp; Recurring Subscriptions</h2>
          <p className="text-xs text-muted">
            {creditEligible
              ? `Subscribe with Pay now (online card / wallet) or Pay later (Net ${netDays} credit terms). Payment protection is switched off by default for SaaS subscriptions.`
              : 'Subscribe with Pay now (online card / wallet). Payment protection is switched off by default for SaaS subscriptions.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-bad/40 bg-bad-bg p-3 text-xs text-bad" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[10px] border border-ok-line bg-ok-bg p-3 text-xs text-ok" data-testid="saas-sub-notice">
          {notice}
        </div>
      )}

      {subscriptions.length > 0 && (
        <div className="rounded-[16px] border border-line bg-white p-3.5 text-xs" data-testid="active-saas-subscriptions">
          <div className="font-semibold text-ink mb-2">Your active subscriptions</div>
          <ul className="space-y-1.5">
            {subscriptions.map((sub) => (
              <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong className="font-mono text-ink">{sub.plan_code}</strong> ·{' '}
                  <span className="uppercase font-semibold text-ok">{sub.status}</span> (
                  {sub.payment_option.replace('_', ' ')})
                </span>
                <span className="text-muted">
                  Current period ends {fmtDate(sub.current_period_end)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {plans.map((p) => {
          const canPayLater = creditEligible && creditAvailableCents >= p.price_cents;
          return (
            <div
              key={p.code}
              data-testid={`saas-plan-${p.code}`}
              className="rounded-[16px] border border-line bg-pearl p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-sm text-ink">{p.name}</div>
                  <div className="font-mono text-sm font-bold text-ink">
                    {money(p.price_cents, p.currency)} / {p.billing_interval === 'annual' ? 'yr' : 'mo'}
                  </div>
                </div>
                {p.description && <p className="mt-1 text-xs text-muted">{p.description}</p>}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {hasOnlineProvider && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleSubscribe(p.code, 'pay_now', 'card')}
                    data-testid={`saas-pay-online-${p.code}`}
                    className="btn btn-primary"
                  >
                    Pay now (Online)
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleSubscribe(p.code, 'pay_now', 'wallet')}
                  data-testid={`saas-pay-wallet-${p.code}`}
                  className="btn btn-ghost"
                >
                  Pay now (Wallet)
                </button>
                {creditEligible && (
                  <button
                    type="button"
                    disabled={pending || !canPayLater}
                    onClick={() => handleSubscribe(p.code, 'pay_later', 'wallet')}
                    data-testid={`saas-pay-later-${p.code}`}
                    title={
                      canPayLater
                        ? `Bill on Net ${netDays} credit terms`
                        : 'Insufficient available credit'
                    }
                    className="btn btn-ghost btn-sm"
                  >
                    Pay later (Net {netDays})
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
