import type { ReactNode } from 'react';
import { Button, Card, EmptyState, ErrorState, KpiStrip, Skeleton, StatusPill, Tabs, formatNumber } from '@octopus/ui';
import { Cents, Notice, PageHead, TextLink } from '../../_services/ui';
import { LOW_STOCK_COVER_DAYS, LOW_STOCK_SETTING_KEY, WAREHOUSE_TABS, stockLevel, type WarehouseTab } from '../../_services/logic';
import { InboundTable, OutboundTable, StockTable, type InboundRow, type OutboundRow, type StockRow } from './warehouse-tables';

export type PanelState<T> = { kind: 'ready'; data: T } | { kind: 'loading' } | { kind: 'error' };

export type WarehouseKpis = { onHand: number | null; available: number | null; products: number | null; inboundOpen: number | null; inboundUnits: number | null; openOrders: number | null };
export type RateCard = {
  plan: string; warehouse: string | null; version: number;
  receiving_per_carton_cents: number | null; storage_per_cbm_month_cents: number | null; storage_per_pallet_month_cents: number | null;
  pick_pack_first_cents: number | null; pick_pack_extra_cents: number | null; returns_per_item_cents: number | null; min_monthly_cents: number | null;
};
export type Statement = { id: string; period: string; number: string; total_cents: number; paid_cents: number; currency: string; status: { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo' } };
export type FeesData = { rates: RateCard | null; statements: Statement[] };

const failed = (what: string) => <ErrorState headingLevel={3} title={`${what} could not be loaded`} description="Reload the page. The other tabs still work." action={<Button variant="secondary" href="/account/warehouse">Reload</Button>} />;

/** Stock: on hand / reserved / available per product with stock labels (In stock · Low stock · Out of stock). */
export function StockPanel({ state, coverDays = LOW_STOCK_COVER_DAYS }: { state: PanelState<StockRow[]>; coverDays?: number }) {
  if (state.kind === 'loading') return <Skeleton lines={5} label="Loading your stock" />;
  if (state.kind === 'error') return failed('Your stock');
  const low = state.data.filter((r) => stockLevel(r, coverDays).id !== 'ok');
  return (
    <div className="flex flex-col gap-4">
      {low.length ? <Notice tone="warning" testId="low-stock-notice">{low.length} {low.length === 1 ? 'product is' : 'products are'} low or out of stock. Send stock to keep orders moving.</Notice> : null}
      {state.data.length === 0 ? <EmptyState title="No stock yet" headingLevel={3} description="Your stock shows here once we receive it. Send a stock notice so we know what is coming." action={<Button href="/account/warehouse?tab=send">Send stock to the warehouse</Button>} /> : <StockTable rows={state.data} coverDays={coverDays} />}
      <p className="m-0 text-ods-small text-ods-slate"><span data-setting={LOW_STOCK_SETTING_KEY}>Low = under {coverDays} days of cover</span> at the last 30 days&apos; shipping rate. Photos and per-warehouse stock: <TextLink href="/account/warehouse?tab=inventory">Inventory details</TextLink>.</p>
    </div>
  );
}

export function InboundPanel({ state }: { state: PanelState<InboundRow[]> }) {
  if (state.kind === 'loading') return <Skeleton lines={4} label="Loading inbound shipments" />;
  if (state.kind === 'error') return failed('Your inbound shipments');
  return state.data.length === 0
    ? <EmptyState title="No inbound shipments" headingLevel={3} description="Tell us what you are sending and when it arrives; we book the slot and count it in." action={<Button href="/account/warehouse?tab=send">Send stock to the warehouse</Button>} />
    : <InboundTable rows={state.data} />;
}

export function OutboundPanel({ state }: { state: PanelState<OutboundRow[]> }) {
  if (state.kind === 'loading') return <Skeleton lines={4} label="Loading outbound orders" />;
  if (state.kind === 'error') return failed('Your outbound orders');
  return state.data.length === 0
    ? <EmptyState title="No outbound orders yet" headingLevel={3} description="Send orders one by one or as a CSV file; we pick, pack and ship them with packing proof." action={<Button href="/account/warehouse?tab=orders">Create outbound order</Button>} />
    : <OutboundTable rows={state.data} />;
}

export function FeesPanel({ state }: { state: PanelState<FeesData> }) {
  if (state.kind === 'loading') return <Skeleton lines={5} label="Loading your fees" />;
  if (state.kind === 'error') return failed('Your fees');
  const r = state.data.rates;
  const rate = (c: number | null | undefined, unit: string) => (c == null ? <span className="text-ods-slate">Not set yet</span> : <><Cents cents={c} /> {unit}</>);
  return (
    <div className="grid grid-cols-1 items-start gap-6 ods-desktop:grid-cols-2">
      <Card title="Your current rates" headingLevel={3} description={r ? `${r.plan} plan${r.warehouse ? ` · ${r.warehouse}` : ''} · rate version ${r.version}` : undefined} data-testid="warehouse-rates">
        {!r ? <p className="m-0 text-ods-body">Your rates are not set yet. Your account manager sets them with you before the first bill.</p> : (
          <dl className="m-0 flex flex-col divide-y divide-ods-line">
            {([
              ['Receiving', rate(r.receiving_per_carton_cents, 'per carton')],
              ['Storage', <span key="s" className="flex flex-col">{r.storage_per_cbm_month_cents != null ? <span>{rate(r.storage_per_cbm_month_cents, 'per CBM per month')}</span> : null}{r.storage_per_pallet_month_cents != null ? <span>{rate(r.storage_per_pallet_month_cents, 'per pallet per month')}</span> : null}{r.storage_per_cbm_month_cents == null && r.storage_per_pallet_month_cents == null ? rate(null, '') : null}</span>],
              ['Pick and pack', <span key="p">{rate(r.pick_pack_first_cents, 'per order')}{r.pick_pack_extra_cents != null ? <> + <Cents cents={r.pick_pack_extra_cents} /> per extra item</> : null}</span>],
              ['Returns', rate(r.returns_per_item_cents, 'per item')],
              ['Monthly minimum', r.min_monthly_cents == null ? <span className="text-ods-slate">None</span> : <Cents cents={r.min_monthly_cents} />],
            ] as [string, ReactNode][]).map(([k, v]) => (
              <div key={k} className="flex flex-wrap justify-between gap-2 py-2.5"><dt className="font-semibold">{k}</dt><dd className="m-0 text-end">{v}</dd></div>
            ))}
          </dl>
        )}
      </Card>
      <Card title="Monthly statements" headingLevel={3} data-testid="warehouse-statements" actions={<TextLink href="/account/warehouse?tab=invoices">See every line</TextLink>}>
        {state.data.statements.length === 0 ? <p className="m-0 text-ods-body">No statements yet. You get one per month after your first activity.</p> : (
          <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
            {state.data.statements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex flex-col"><span className="font-semibold">{s.period}</span><span className="text-ods-small text-ods-slate tabular-nums">{s.number}</span></span>
                <span className="flex items-center gap-2"><Cents cents={s.total_cents} currency={s.currency} /><StatusPill tone={s.status.tone}>{s.status.label}</StatusPill></span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-3 text-ods-small text-ods-slate">Pay statements in <TextLink href="/account/invoices">Invoices</TextLink>.</p>
      </Card>
    </div>
  );
}

export function WarehouseKpiStrip({ state }: { state: PanelState<WarehouseKpis> }) {
  const k = state.kind === 'ready' ? state.data : null;
  const v = (x: number | null | undefined) => (x == null ? '—' : formatNumber(x));
  return (
    <KpiStrip label="Warehouse summary" loading={state.kind === 'loading'} items={[
      { label: 'Units in stock', value: v(k?.onHand), hint: k?.available != null ? `${formatNumber(k.available)} available for new orders` : 'Shows once we receive your stock' },
      { label: 'Products', value: v(k?.products) },
      { label: 'Inbound on the way', value: v(k?.inboundOpen), hint: k?.inboundUnits != null ? `${formatNumber(k.inboundUnits)} units` : undefined },
      { label: 'Open orders', value: v(k?.openOrders), hint: 'Received, picking or packing' },
    ]} />
  );
}

/** Not a 3PL client yet: today's Start (Apply) or "being set up" card, in ODS. */
export function WarehouseNotStarted({ settingUp }: { settingUp: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Warehouse (3PL)" description="Your stock in our warehouse, what's coming in and what has gone out." />
      {settingUp
        ? <EmptyState title="Your 3PL account is being set up" headingLevel={2} description="Stock, inbound, outbound and fees open once your account is approved. Questions? Contact support." action={<Button variant="secondary" href="/account/support">Contact support</Button>} />
        : <EmptyState title="Warehouse (3PL) is not switched on" headingLevel={2} description="Send your stock to our warehouse. We receive and count it, store it, and pick, pack and ship each order you send us." action={<Button href="/3pl/apply">Apply for a 3PL account</Button>} />}
    </div>
  );
}

/**
 * /account/warehouse (Part 6.7, C_Warehouse): Tabs Stock · Inbound · Outbound · Fees (`?tab=`). Each panel is passed in already
 * wrapped in its own Suspense by the page, so one failing panel never blanks the others. Task forms (send stock, create orders,
 * returns, warehouse requests) stay on today's tools at /account/warehouse?tab=send|orders|returns|support (proxy keeps them).
 */
export function WarehouseView({ tab, tabParam = 'tab', kpis, panels }: { tab: WarehouseTab; tabParam?: string | null; kpis: ReactNode; panels: Record<WarehouseTab, ReactNode> }) {
  const label: Record<WarehouseTab, string> = { stock: 'Stock', inbound: 'Inbound', outbound: 'Outbound', fees: 'Fees' };
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Warehouse (3PL)" description="Your stock in our warehouse, what's coming in and what has gone out."
        actions={<>
          <Button href="/account/warehouse?tab=send" data-testid="warehouse-send-stock">Send stock to the warehouse</Button>
          <Button href="/account/warehouse?tab=orders" variant="secondary">Create outbound order</Button>
        </>} />
      {kpis}
      <Tabs label="Warehouse" param={tabParam ?? undefined} defaultValue={tab} data-testid="warehouse-tabs" panelClassName="pt-6"
        items={WAREHOUSE_TABS.map((id) => ({ id, label: label[id], panel: panels[id], testId: `warehouse-tab-${id}` }))} />
      <nav aria-label="More warehouse tools" className="flex flex-wrap gap-2 border-t border-ods-line pt-4">
        <Button variant="ghost" size="sm" href="/account/warehouse?tab=returns">Returns</Button>
        <Button variant="ghost" size="sm" href="/account/warehouse?tab=support">Warehouse requests</Button>
        <Button variant="ghost" size="sm" href="/account/warehouse?tab=integrations">Integrations</Button>
      </nav>
    </div>
  );
}
