'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsIcon, DsLinkButton, DsNotice, DsPageHeader } from '@/components/dropship-ui';
import type { BillingPageData, PlanRow } from '@/lib/dropship-ds12';
import { fmtDate, planNotice, PLAN_FEATURE_LABELS, usd } from '@/lib/dropship-ds12-shared';
import { choosePlanAction } from '../ds12-actions';

/**
 * Release 5 · Steps 12 / 12b — Plan and billing screen (screens/Billing.html, mobile/M_Billing.html): plan notice (plans free /
 * free trial / grace / paused, States-Money), plan cards with limits, usage, downgrade preview, and the Octopus invoices and
 * statements table. Plan prices and limits come from Finance (owner's numbers); none are invented here.
 */

const DOC_TYPE: Record<string, string> = { commercial_invoice: 'Tax invoice', statement: 'Weekly statement', credit_note: 'Credit note' };
const limitText = (n: number | null, what: string) => (n == null ? `Unlimited ${what}` : `${n.toLocaleString('en-US')} ${what}`);

export function BillingClient({ data }: { data: BillingPageData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; title: string; text?: string } | null>(null);
  const n = planNotice(data);
  const isOwner = data.my_role === 'owner';
  const current = data.plans.find((p) => p.code === data.plan_code) ?? null;
  const downgrade = data.plans.filter((p) => p.over_limit > 0 && p.code !== data.plan_code);

  function reason(p: PlanRow): string | null {
    if (!data.billing_enabled) return 'Plans are free while plan fees are off.';
    if (data.free_forever) return 'Your company uses Octopus Dropship free.';
    if (data.channel === 'shopify') return 'Approve plans in Shopify once your store is connected.';
    if (data.dropship_status !== 'on') return 'Dropshipping is paused or closed for your company.';
    if (!isOwner) return 'Only the account owner can change the plan.';
    if (p.over_limit > 0) return `${p.over_limit} products are over the ${p.name} limit. Unlink them in Pushed products first.`;
    return null;
  }

  function choose(p: PlanRow) {
    setNotice(null);
    start(async () => {
      const r = await choosePlanAction(p.code);
      if (!r.ok) setNotice({ tone: 'bad', title: 'Plan not changed', text: r.message });
      else if (r.data.charge && !r.data.charge.ok) setNotice({ tone: 'warn', title: `${p.name} approved, not paid yet`, text: r.data.charge.message ?? 'Add funds to your wallet; Octopus tries again automatically.' });
      else setNotice({ tone: 'ok', title: `${p.name} plan approved`, text: r.data.charge?.invoice_number ? `Paid from your wallet. Invoice ${r.data.charge.invoice_number}.` : 'Nothing is charged before your free trial ends.' });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ds-billing-page">
      <DsPageHeader title="Plan and billing" icon="card" subtitle="Your plan, its limits, and every Octopus invoice and statement." />

      <DsNotice tone={n.tone} title={n.title} testId="billing-plan-notice">{n.text}</DsNotice>
      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="billing-action-notice">{notice.text}</DsNotice>}

      <section aria-labelledby="plans-h" className="flex flex-col gap-3">
        <h2 id="plans-h" className="m-0 text-[17px] font-semibold text-ink">Plans</h2>
        {data.plans.length === 0 ? (
          <DsEmptyState icon="card" testId="billing-no-plans" title="No plans to choose yet"
            description={data.billing_enabled ? 'Octopus has not published plan prices yet. You keep using Octopus Dropship meanwhile.' : 'Plans are free while plan fees are off. Plan prices are published before charging starts.'} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="billing-plans">
            {data.plans.map((p) => {
              const isCurrent = p.code === data.plan_code;
              const why = reason(p);
              return (
                <div key={p.code} className={`ds-card flex flex-col gap-3 ${isCurrent ? 'ring-2 ring-ok' : ''}`} data-testid={`plan-${p.code}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-[16px] font-semibold text-ink">{p.name}</h3>
                    {isCurrent && <DsBadge tone="ok" icon="check">Current plan</DsBadge>}
                  </div>
                  <p className="m-0 text-[22px] font-bold text-ink">{p.price_cents == null ? 'Price not set' : `${usd(p.price_cents)} / month`}</p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[14px] text-black">
                    <li className="flex gap-2 items-center"><DsIcon name="store" size={16} />{limitText(p.stores_limit, p.stores_limit === 1 ? 'connected store' : 'connected stores')}</li>
                    <li className="flex gap-2 items-center"><DsIcon name="box" size={16} />{limitText(p.live_products_limit, 'live products')}</li>
                    <li className="flex gap-2 items-center"><DsIcon name="cart" size={16} />{limitText(p.orders_month_limit, 'orders a month')}</li>
                    {p.features.map((f) => <li key={f} className="flex gap-2 items-center"><DsIcon name="check" size={16} />{PLAN_FEATURE_LABELS[f] ?? f}</li>)}
                  </ul>
                  {p.description && <p className="m-0 text-[13px] text-muted">{p.description}</p>}
                  <div className="mt-auto">
                    {isCurrent && data.plan_approved ? (
                      <DsButton variant="secondary" disabled disabledReason="This is your plan." testId={`plan-${p.code}-current`}>Current plan</DsButton>
                    ) : (
                      <DsButton variant={current && (current.price_cents ?? 0) > (p.price_cents ?? 0) ? 'secondary' : 'primary'} loading={pending}
                        disabled={Boolean(why)} disabledReason={why ?? undefined} onClick={() => choose(p)} testId={`plan-${p.code}-choose`}>
                        {current && (current.price_cents ?? 0) > (p.price_cents ?? 0) ? 'Downgrade' : isCurrent ? 'Approve plan' : 'Choose plan'}
                      </DsButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <DsCard title="Usage" icon="chart" testId="billing-usage">
        <dl className="m-0 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[14px]">
          <div><dt className="text-muted">Live products</dt><dd className="m-0 font-semibold text-ink" data-testid="usage-products">{data.usage.live_products} of {data.live_products_limit ?? 'no limit'}</dd></div>
          <div><dt className="text-muted">Connected stores</dt><dd className="m-0 font-semibold text-ink" data-testid="usage-stores">{data.usage.stores} of {data.stores_limit ?? 'no limit'}</dd></div>
          <div><dt className="text-muted">Orders this month</dt><dd className="m-0 font-semibold text-ink" data-testid="usage-orders">{data.usage.orders_month} of {data.orders_month_limit ?? 'no limit'}</dd></div>
        </dl>
        {!data.limits_apply && <p className="m-0 mt-3 text-[13px] text-muted">No limits apply while {data.billing_enabled ? 'your company uses Octopus Dropship free' : 'plan fees are off'}.</p>}
      </DsCard>

      {downgrade.length > 0 && current && (
        <DsNotice tone="warn" title={`Downgrade preview: ${downgrade[0].name}`} testId="billing-downgrade"
          action={<DsLinkButton href="/account/dropship/pushed" variant="secondary" icon="list">Choose products</DsLinkButton>}>
          {downgrade[0].over_limit} products are over the {downgrade[0].name} limit. Unlink the ones you don&rsquo;t need in Pushed products; the rest stay live.
        </DsNotice>
      )}

      <section aria-labelledby="docs-h" className="ds-card !p-0 overflow-hidden" data-testid="billing-documents">
        <div className="px-5 pt-4 pb-3">
          <h2 id="docs-h" className="m-0 text-[17px] font-semibold text-ink">Octopus invoices and statements</h2>
          <p className="m-0 mt-1 text-[13px] text-muted">
            Issued by the Octopus company that sells to you{data.issuer ? `, today ${data.issuer}` : ''}.{data.channel === 'shopify' ? ' Plan invoices are in Shopify.' : ''}
          </p>
        </div>
        {data.documents.length === 0 ? (
          <div className="px-5 pb-5"><p className="m-0 text-[14px] text-muted" data-testid="billing-docs-empty">No invoices or statements yet. They appear here after your first order, sample or plan payment.</p></div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Octopus invoices and statements">
            <table className="w-full min-w-[560px] text-[14px] border-collapse">
              <thead className="bg-pearl text-left text-muted">
                <tr><th scope="col" className="px-5 py-2.5 font-medium">Number</th><th scope="col" className="px-3 py-2.5 font-medium">Date</th><th scope="col" className="px-3 py-2.5 font-medium">Type</th><th scope="col" className="px-3 py-2.5 font-medium text-right">Amount</th><th scope="col" className="px-5 py-2.5 font-medium text-right">Download</th></tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.id} className="border-t border-divider hover:bg-pearl">
                    <td className="px-5 py-2.5 font-medium text-ink">{d.number}</td>
                    <td className="px-3 py-2.5">{fmtDate(d.created_at)}</td>
                    <td className="px-3 py-2.5">{d.kind === 'plan_fee' ? 'Plan invoice' : DOC_TYPE[d.doc_type] ?? d.doc_type}</td>
                    <td className="px-3 py-2.5 text-right">{d.doc_type === 'credit_note' ? usd(-(d.amount_cents ?? 0)) : usd(d.amount_cents)}</td>
                    <td className="px-5 py-2.5 text-right"><a href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noopener" className="text-coral-text font-medium">Download<span className="sr-only"> {d.number}</span></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
