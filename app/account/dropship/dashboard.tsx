import Link from 'next/link';
import { DsBadge, DsCard, DsEmptyState, DsIcon, DsLinkButton, DsNotice, DsPageHeader, type DsBadgeTone } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getDashboard, type AttentionItem, type DashboardData } from '@/lib/dropship-ds12';
import type { DropshipFeatures } from '@/lib/dropship-features-shared';
import { fmtDateTime, pctChange, shareOf, usd, usdWhole } from '@/lib/dropship-ds12-shared';

/**
 * Release 5 · Step 13 — Dashboard (screens/Dashboard.html, mobile/M_Dashboard.html). Data: ds_dashboard() — last 30 days
 * from the merchant's own charged orders (store sales at the locked FX, Octopus costs = what was charged), one "Needs
 * attention" list ordered money → holds → setup → information, recent orders, wallet (Available, Held, waiting orders),
 * sync health (honest until a store is connected) and plan usage. No data → empty states, never sample numbers.
 */

const STATUS: Record<string, { label: string; tone: DsBadgeTone }> = {
  awaiting_payment: { label: 'To pay', tone: 'warn' }, on_hold: { label: 'On hold', tone: 'warn' }, processing: { label: 'Processing', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'info' }, delivered: { label: 'Delivered', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'neutral' }, refunded: { label: 'Refunded', tone: 'neutral' },
};

function attention(a: AttentionItem, f: DropshipFeatures): { tag: string; text: string; action: string; href: string } | null {
  switch (a.kind) {
    case 'to_pay': return { tag: 'To pay', text: `Order ${a.order} is waiting for payment (${usd(a.amount_cents)}). Wallet: ${usd(a.wallet_cents)}.`, action: 'Add funds', href: a.href };
    case 'plan_grace': return f.billing ? { tag: 'Plan', text: `Approve your plan to keep pushing. New pushes pause on ${a.until ? a.until.slice(0, 10) : 'the date shown in Plan and billing'}.`, action: 'Plan and billing', href: a.href } : null;
    case 'plan_paused': return f.billing ? { tag: 'Plan', text: 'New pushes are paused until your plan is approved and paid. Paid orders keep shipping.', action: 'Plan and billing', href: a.href } : null;
    case 'plan_trial': return f.billing ? { tag: 'Plan', text: `Free trial: ${a.days} day${a.days === 1 ? '' : 's'} left. Choose and approve your plan.`, action: 'Plan and billing', href: a.href } : null;
    case 'hold_high_risk': return { tag: 'On hold', text: `Order ${a.order} was rated high risk by the store. Not charged yet.`, action: 'Review', href: a.href };
    case 'hold_address': return { tag: 'On hold', text: `Order ${a.order}: the address failed our check.`, action: 'Fix address', href: a.href };
    case 'hold_duty_unknown': return { tag: 'On hold', text: `Order ${a.order}: duties for this country are not known yet. Not charged.`, action: 'Open', href: a.href };
    case 'hold_stock_shortage': return { tag: 'On hold', text: `Order ${a.order}: not enough stock right now.`, action: 'Open', href: a.href };
    case 'rate_unmapped': return f.packing ? { tag: 'Shipping', text: `Store rate "${a.rate_name}" is not mapped. Orders use the fallback.`, action: 'Map it', href: a.href } : null;
    case 'push_failed': return f.pushed ? { tag: 'Push', text: `${a.count} push${a.count === 1 ? '' : 'es'} failed.`, action: 'Review', href: a.href } : null;
    case 'margin': return f.pricing ? { tag: 'Margin', text: `${a.product ?? 'A product'} is below your minimum margin.`, action: 'Edit price', href: a.href } : null;
    case 'cost_up': return f.pricing ? { tag: 'Cost', text: `${a.count} product${a.count === 1 ? '' : 's'} cost more. Waiting for your decision.`, action: 'See changes', href: a.href } : null;
  }
}

function Kpi({ label, value, sub, testId }: { label: string; value: string; sub: string | null; testId: string }) {
  return (
    <div className="ds-card !py-4 flex flex-col gap-1" data-testid={testId}>
      <span className="text-[13px] text-[#5B6478]">{label}</span>
      <strong className="text-[22px] text-[#1A174A]" data-testid={`${testId}-value`}>{value}</strong>
      {sub ? <span className="text-[13px] text-[#5B6478]">{sub}</span> : null}
    </div>
  );
}

export async function MerchantDashboard({ features }: { features: DropshipFeatures }) {
  let d: DashboardData | null = null;
  let error: string | null = null;
  try {
    d = await getDashboard();
  } catch (e) {
    error = rpcMessage(e);
  }
  const header = (
    <DsPageHeader title="Dashboard" icon="grid" subtitle="Your store, orders and sync at a glance. Last 30 days, all stores."
      actions={
        <div className="flex flex-wrap gap-2" data-testid="dropship-active-start">
          <DsLinkButton href="/account/dropship/catalogue" variant="secondary" icon="search">Find products</DsLinkButton>
          <DsLinkButton href="/account/dropship/wallet#add-funds" variant="primary" icon="wallet">Add funds</DsLinkButton>
        </div>
      } />
  );
  if (!d) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds-dashboard">
        {header}
        <DsNotice tone="bad" title="The dashboard could not be loaded" testId="dashboard-error"
          action={<DsLinkButton href="/account/dropship" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  const c = d.current;
  const items = d.attention.map((a) => attention(a, features)).filter(Boolean) as { tag: string; text: string; action: string; href: string }[];
  const plan = d.plan;
  return (
    <div className="flex flex-col gap-5" data-testid="ds-dashboard">
      {header}

      {c.orders === 0 ? (
        <DsEmptyState icon="chart" testId="dashboard-empty" title="No paid orders in the last 30 days"
          description={d.sync.store ? 'Sales, costs and profit appear here as paid orders come in.' : 'Connect a store and push products; sales, costs and profit appear here as paid orders come in.'}
          actionLabel="Find products" actionHref="/account/dropship/catalogue" />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="dashboard-kpis">
          <Kpi label="Store sales" value={usdWhole(c.sales_cents)} sub={pctChange(c.sales_cents, d.previous.sales_cents) ? `${pctChange(c.sales_cents, d.previous.sales_cents)} vs last 30 days` : null} testId="dash-sales" />
          <Kpi label="Orders" value={String(c.orders)} sub={pctChange(c.orders, d.previous.orders)} testId="dash-orders" />
          <Kpi label="Octopus costs" value={usdWhole(c.costs_cents)} sub="product, processing, shipping, duties" testId="dash-costs" />
          <Kpi label="Profit before your ads" value={usdWhole(c.profit_cents)} sub={shareOf(c.profit_cents, c.sales_cents)} testId="dash-profit" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <DsCard title={`Needs attention (${items.length})`} icon="alert" testId="dashboard-attention">
            {items.length === 0 ? (
              <p className="m-0 text-[14px] text-[#5B6478]" data-testid="attention-empty">Nothing needs you right now.</p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col divide-y divide-[#EEF0F4]">
                {items.map((it, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 py-2.5">
                    <DsBadge tone={it.tag === 'To pay' || it.tag === 'On hold' || it.tag === 'Plan' ? 'warn' : 'info'}>{it.tag}</DsBadge>
                    <span className="flex-1 min-w-[200px] text-[14px] text-[#1A174A]">{it.text}</span>
                    <Link href={it.href} className="text-[14px] font-medium text-[#2A6FD1] min-h-[44px] inline-flex items-center">{it.action}</Link>
                  </li>
                ))}
              </ul>
            )}
          </DsCard>

          {features.orders && (
            <section aria-labelledby="recent-h" className="ds-card !p-0 overflow-hidden" data-testid="dashboard-recent">
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <h2 id="recent-h" className="m-0 text-[17px] font-semibold text-[#1A174A]">Recent orders</h2>
                <Link href="/account/dropship/orders" className="text-[14px] font-medium text-[#2A6FD1]">All orders</Link>
              </div>
              {d.recent_orders.length === 0 ? (
                <p className="m-0 px-5 pb-5 text-[14px] text-[#5B6478]">No orders yet.</p>
              ) : (
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent orders">
                  <table className="w-full min-w-[560px] text-[14px] border-collapse">
                    <thead className="bg-[#F7F9FC] text-left text-[#5B6478]">
                      <tr><th scope="col" className="px-5 py-2.5 font-medium">Order</th><th scope="col" className="px-3 py-2.5 font-medium">Items</th><th scope="col" className="px-3 py-2.5 font-medium">Buyer</th><th scope="col" className="px-3 py-2.5 font-medium text-right">Cost</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th></tr>
                    </thead>
                    <tbody>
                      {d.recent_orders.map((o) => {
                        const st = STATUS[o.merchant_status] ?? { label: o.merchant_status, tone: 'neutral' as DsBadgeTone };
                        return (
                          <tr key={o.id} className="border-t border-[#EEF0F4] hover:bg-[#FAFBFD]">
                            <td className="px-5 py-2.5 font-medium text-[#1A174A]">{o.order_ref}</td>
                            <td className="px-3 py-2.5">{o.first_item ?? '—'}{o.more_items > 0 ? ` +${o.more_items}` : ''}</td>
                            <td className="px-3 py-2.5">{[o.buyer, o.country].filter(Boolean).join(' · ') || '—'}</td>
                            <td className="px-3 py-2.5 text-right">{usd(o.total_cents)}</td>
                            <td className="px-5 py-2.5"><DsBadge tone={st.tone}>{o.expired_at ? 'Released' : st.label}</DsBadge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <DsCard title="Wallet" icon="wallet" testId="dashboard-wallet">
            <dl className="m-0 flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between gap-2"><dt>Available</dt><dd className="m-0 font-semibold text-[#1A174A]" data-testid="dash-available">{usd(d.wallet.available_cents)} {d.wallet.low && <DsBadge tone="warn">Low</DsBadge>}</dd></div>
              <div className="flex justify-between gap-2"><dt>Held for protected orders</dt><dd className="m-0 font-semibold text-[#1A174A]">{usd(d.wallet.held_cents)}</dd></div>
              <div className="flex justify-between gap-2"><dt>Waiting orders</dt><dd className="m-0 font-semibold text-[#1A174A]">{d.wallet.waiting_orders} · {usd(d.wallet.waiting_cents)}</dd></div>
            </dl>
            <div className="mt-3"><DsLinkButton href="/account/dropship/wallet#add-funds" variant="secondary" icon="plus">Add funds</DsLinkButton></div>
          </DsCard>

          <DsCard title="Sync health" icon="refresh" testId="dashboard-sync">
            <dl className="m-0 flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between gap-2"><dt>Store access</dt><dd className="m-0 font-medium text-[#1A174A]">{d.sync.needs_reconnect ? <DsBadge tone="bad">Reconnect needed</DsBadge> : d.sync.store ? 'Connected' : 'No store connected'}</dd></div>
              <div className="flex justify-between gap-2"><dt>Last order received</dt><dd className="m-0 font-medium text-[#1A174A]">{d.sync.last_order_at ? fmtDateTime(d.sync.last_order_at) : 'None yet'}</dd></div>
              <div className="flex justify-between gap-2"><dt>Stock and price sync</dt><dd className="m-0 font-medium text-[#1A174A]">{d.sync.last_sync_at ? fmtDateTime(d.sync.last_sync_at) : 'Starts with your first live product'}</dd></div>
              <div className="flex justify-between gap-2"><dt>Failed pushes</dt><dd className="m-0 font-medium text-[#1A174A]">{d.sync.failed_pushes}{d.sync.failed_pushes > 0 && features.pushed ? <> · <Link href="/account/dropship/pushed" className="text-[#2A6FD1] underline">Review</Link></> : null}</dd></div>
            </dl>
          </DsCard>

          <DsCard title="Plan usage" icon="card" testId="dashboard-plan">
            <dl className="m-0 flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between gap-2"><dt>Plan</dt><dd className="m-0 font-medium text-[#1A174A]">{!plan.billing_enabled ? 'Free while plan fees are off' : plan.free_forever ? 'Free for your company' : plan.channel === 'shopify' ? `${plan.plan_name ?? 'Plan'} · billed by Shopify` : plan.plan_name ?? 'No plan chosen yet'}</dd></div>
              <div className="flex justify-between gap-2"><dt>Live products</dt><dd className="m-0 font-medium text-[#1A174A]">{plan.usage.live_products} of {plan.live_products_limit ?? 'no limit'}</dd></div>
              <div className="flex justify-between gap-2"><dt>Connected stores</dt><dd className="m-0 font-medium text-[#1A174A]">{plan.usage.stores} of {plan.stores_limit ?? 'no limit'}</dd></div>
            </dl>
            {features.billing && <div className="mt-3"><Link href="/account/dropship/billing" className="text-[14px] font-medium text-[#2A6FD1] inline-flex items-center gap-1 min-h-[44px]">Plan and billing <DsIcon name="arrow" size={16} /></Link></div>}
          </DsCard>
        </div>
      </div>
    </div>
  );
}
