/**
 * Octopus Dropship · Release 5 · Steps 12 / 13 — pure helpers shared by the server pages, the client screens, the CSV routes
 * and the unit tests. No server imports.
 */

export const usd = (c: number | null | undefined) =>
  c == null ? 'Not known yet' : `${c < 0 ? '−' : ''}US$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whole dollars for KPI tiles (design: "$12,480"); unknown stays unknown. */
export const usdWhole = (c: number | null | undefined) =>
  c == null ? 'Not known yet' : `${c < 0 ? '−' : ''}US$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;

/** "+8%" / "−4%" vs the previous period; null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): string | null {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}

/** Share of sales ("50% of sales"); null without sales. */
export function shareOf(part: number, whole: number): string | null {
  if (!whole) return null;
  return `${Math.round((part / whole) * 100)}% of sales`;
}

/** Refund rate in basis points → "2.1%"; change in points → "−0.4 points". */
export const bpPct = (bp: number | null | undefined) => (bp == null ? 'No orders yet' : `${(bp / 100).toFixed(1)}%`);
export function pointsChange(cur: number | null, prev: number | null): string | null {
  if (cur == null || prev == null) return null;
  const d = (cur - prev) / 100;
  if (Math.abs(d) < 0.05) return 'no change';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} points`;
}

export const days = (d: number | string | null | undefined) => (d == null ? 'No deliveries yet' : `${Number(d).toFixed(1)} days`);

export type PeriodKey = '30d' | '7d' | 'quarter' | 'custom';

/** Report period → [from, to) ISO strings. Custom dates are YYYY-MM-DD (UTC, the end date included). */
export function periodRange(key: PeriodKey, now: Date, customFrom?: string | null, customTo?: string | null): { from: string; to: string } | null {
  const to = new Date(now.getTime());
  if (key === '7d') return { from: new Date(to.getTime() - 7 * 86400000).toISOString(), to: to.toISOString() };
  if (key === 'quarter') {
    const q = Math.floor(to.getUTCMonth() / 3) * 3;
    return { from: new Date(Date.UTC(to.getUTCFullYear(), q, 1)).toISOString(), to: to.toISOString() };
  }
  if (key === 'custom') {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!customFrom || !customTo || !re.test(customFrom) || !re.test(customTo)) return null;
    const f = new Date(`${customFrom}T00:00:00Z`);
    const t = new Date(new Date(`${customTo}T00:00:00Z`).getTime() + 86400000);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f >= t || t.getTime() - f.getTime() > 400 * 86400000) return null;
    return { from: f.toISOString(), to: t.toISOString() };
  }
  return { from: new Date(to.getTime() - 30 * 86400000).toISOString(), to: to.toISOString() };
}

/** Spreadsheet-safe CSV cell: formula characters stripped, quotes doubled, always quoted. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  s = s.replace(/[\t\r\n]+/g, ' ').trim();
  while (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = s.slice(1).trimStart();
  return `"${s.replace(/"/g, '""')}"`;
}

export const centsToDecimal = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

/** Report CSV: one row per charged order, numbers in US$ with two decimals, unknown sales left empty. */
export const REPORT_CSV_HEADERS = [
  'Order', 'Store order', 'Date (UTC)', 'Country', 'Shipping', 'Buyer currency', 'FX to USD (locked at intake)', 'Store sales (USD)',
  'Product (USD)', 'Processing (USD)', 'Shipping (USD)', 'Duties and tax (USD)', 'Refunds (USD)', 'Octopus costs (USD)', 'Profit before ads (USD)',
  'Refunded', 'Delivered (UTC)', 'Delivery days',
];

export function reportCsvRows(rows: {
  order_number: string; external_order_name: string | null; created_at: string; country: string | null; shipping_method: string | null;
  buyer_currency: string | null; fx_rate_to_usd: number | string | null; sales_usd_cents: number | null; product_cents: number;
  processing_cents: number; shipping_cents: number; duties_cents: number; refunds_cents: number; costs_cents: number; profit_cents: number | null;
  refunded: boolean; full_refund: boolean; delivered_at: string | null; delivery_days: number | string | null;
}[]): unknown[][] {
  return rows.map((r) => [
    r.order_number, r.external_order_name ?? '', r.created_at.slice(0, 10), r.country ?? '', r.shipping_method ?? '', r.buyer_currency ?? '',
    r.fx_rate_to_usd ?? '', centsToDecimal(r.sales_usd_cents), centsToDecimal(r.product_cents), centsToDecimal(r.processing_cents),
    centsToDecimal(r.shipping_cents), centsToDecimal(r.duties_cents), centsToDecimal(r.refunds_cents), centsToDecimal(r.costs_cents),
    centsToDecimal(r.profit_cents), r.full_refund ? 'Fully refunded' : r.refunded ? 'Partly refunded' : '', r.delivered_at ? r.delivered_at.slice(0, 10) : '',
    r.delivery_days ?? '',
  ]);
}

/** Week label for the 12-week chart (W1 … W12, oldest first) with its date for screen readers. */
export const weekLabel = (i: number) => `W${i + 1}`;

export const PLAN_FEATURE_LABELS: Record<string, string> = {
  import_push: 'Import and push',
  order_sync: 'Order sync',
  auto_sync: 'Stock and price auto-sync',
  priority_handling: 'Priority order handling',
  branded_packaging: 'Branded packaging',
};

export const ROLE_LABELS: Record<'owner' | 'manager' | 'support', { label: string; can: string }> = {
  owner: { label: 'Owner', can: 'Everything, including wallet top-ups and plan' },
  manager: { label: 'Manager', can: 'Products, pushes, pricing, pay orders' },
  support: { label: 'Support', can: 'See orders, fix addresses, open requests' },
};

export const NOTIFICATION_LABELS: Record<string, string> = {
  new_order: 'New order',
  awaiting_payment: 'Order waiting for payment',
  on_hold: 'Order on hold',
  wallet_low: 'Wallet low',
  out_of_stock: 'Product out of stock',
  cost_changed: 'Cost changed',
  push_failed: 'Push failed',
  store_reconnect: 'Store access needs renewing',
};

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—');

/** Plan status → merchant notice (States-Money: Plans free / Free trial running / Grace period). */
export function planNotice(p: {
  billing_enabled: boolean; status: string; channel: 'wallet' | 'shopify'; trial_days: number; trial_days_left: number | null;
  trial_ends_at: string | null; grace_ends_at: string | null; plan_name: string | null; plan_approved: boolean; free_forever: boolean;
  current_period_end: string | null; last_charge_error: string | null;
}): { tone: 'info' | 'ok' | 'warn' | 'bad'; title: string; text: string } {
  if (!p.billing_enabled || p.status === 'free') {
    return {
      tone: 'info', title: 'Plans are free for now',
      text: `Octopus isn't charging plan fees yet. Before charging starts you get ${p.trial_days} days free, and you approve your plan first. Order costs are paid from your wallet as usual.`,
    };
  }
  if (p.free_forever || p.status === 'free_forever') {
    return { tone: 'ok', title: 'Free for your company', text: 'Octopus Dropship is free for your company. No plan fee is charged.' };
  }
  if (p.channel === 'shopify') {
    return { tone: 'info', title: 'Your plan is billed by Shopify', text: 'Billed through Shopify once your store is connected. Product, shipping and duty costs are paid to Octopus from your wallet.' };
  }
  if (p.status === 'trial' || p.status === 'none') {
    const left = p.trial_days_left ?? p.trial_days;
    return {
      tone: 'info', title: `Free trial: ${left} day${left === 1 ? '' : 's'} left`,
      text: p.plan_approved && p.plan_name
        ? `Your ${p.plan_name} plan starts on ${fmtDate(p.trial_ends_at)} and is paid from your wallet each month. Nothing is charged before then.`
        : `Choose and approve a plan to keep using it after ${fmtDate(p.trial_ends_at)}. Nothing is charged before then.`,
    };
  }
  if (p.status === 'grace') {
    return {
      tone: 'warn', title: 'Approve your plan to keep pushing',
      text: `${p.last_charge_error === 'WALLET_INSUFFICIENT' ? 'Your wallet did not cover the plan fee. ' : ''}New pushes pause on ${fmtDate(p.grace_ends_at)}. Paid orders keep shipping.`,
    };
  }
  if (p.status === 'paused') {
    return { tone: 'bad', title: 'New pushes are paused', text: 'Approve and pay your plan to push products again. Paid orders keep shipping.' };
  }
  if (p.status === 'cancelled') {
    return { tone: 'info', title: 'Dropshipping is closed', text: 'No plan fee is charged. Your invoices and statements stay below.' };
  }
  return {
    tone: 'ok', title: `${p.plan_name ?? 'Your plan'} is active`,
    text: `Paid from your wallet each month. Next charge on ${fmtDate(p.current_period_end)}. Order costs stay separate.`,
  };
}
