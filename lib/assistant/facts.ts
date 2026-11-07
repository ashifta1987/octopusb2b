import 'server-only';
import { serviceName } from '@/lib/service-names';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtDate, humanize, money } from '@/lib/format';

/**
 * Fact lookups shared by Octo's tools and the staff "Octo side rail" (SPEC §20.5).
 * Always pass the caller's Supabase client so RLS decides what is visible. Never selects supplier legal names
 * (suppliers come from the `public_suppliers` view) and never customer addresses/contacts.
 */
export type Fact<T = Record<string, unknown>> = { title: string; text: string; data: T | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARRIERS: Record<string, string> = { yunexpress: 'YunExpress', dhl: 'DHL', fedex: 'FedEx', ups: 'UPS', manual: 'Manual' };
export const carrierName = (c: string | null | undefined) => (c ? CARRIERS[c] ?? humanize(c) : 'Carrier');

type ShipmentRow = { id: string; code: string; order_id: string | null; service_code: string | null; tracking_no: string | null; status: string; eta: string | null; last_event_at: string | null; created_at: string };
type OrderRow = { id: string; code: string; title: string; quantity: number; status: string; total_cents: number; currency: string };

export async function getShipmentFacts(sb: SupabaseClient, trackingOrOrderCode: string): Promise<Fact> {
  const q = trackingOrOrderCode.trim();
  const shipCols = 'id, code, order_id, service_code, tracking_no, status, eta, last_event_at, created_at';
  let order: OrderRow | null = null;
  let shipments: ShipmentRow[] = [];
  const orderCols = 'id, code, title, quantity, status, total_cents, currency';

  if (/^ORD-/i.test(q) || UUID_RE.test(q)) {
    const { data } = await sb.from('orders').select(orderCols).eq(UUID_RE.test(q) ? 'id' : 'code', UUID_RE.test(q) ? q : q.toUpperCase()).maybeSingle();
    order = data as OrderRow | null;
    if (order) {
      const { data: sh } = await sb.from('shipments').select(shipCols).eq('order_id', order.id).order('created_at', { ascending: false });
      shipments = (sh ?? []) as ShipmentRow[];
    }
  } else {
    const col = /^SHP-/i.test(q) ? 'code' : 'tracking_no';
    const { data: sh } = await sb.from('shipments').select(shipCols).eq(col, col === 'code' ? q.toUpperCase() : q).limit(1);
    shipments = (sh ?? []) as ShipmentRow[];
    if (shipments[0]?.order_id) {
      const { data } = await sb.from('orders').select(orderCols).eq('id', shipments[0].order_id).maybeSingle();
      order = data as OrderRow | null;
    }
  }

  if (!order && !shipments.length) {
    return { title: 'Shipment not found', text: `No order or shipment matching "${q}" is visible on this account.`, data: null };
  }
  if (!shipments.length && order) {
    return {
      title: `Order ${order.code}`,
      text: `Order ${order.code} · ${order.quantity.toLocaleString('en-US')} × ${order.title} · status ${humanize(order.status)}. No shipment has been booked yet.`,
      data: { order_id: order.id, order_code: order.code, order_status: order.status, shipments: [] },
    };
  }

  const sh = shipments[0];
  const { data: ev } = await sb.from('tracking_events').select('status, description, location, occurred_at').eq('shipment_id', sh.id).order('occurred_at', { ascending: false }).limit(5);
  const events = (ev ?? []) as { status: string; description: string | null; location: string | null; occurred_at: string }[];
  const last = events[0];
  const lines = [
    order ? `Order ${order.code} · ${order.quantity.toLocaleString('en-US')} × ${order.title} (order status: ${humanize(order.status)})` : null,
    `${serviceName(sh.service_code)} shipment ${sh.code}${sh.tracking_no ? ` · tracking ${sh.tracking_no}` : ''} · status ${humanize(sh.status)}`,
    last ? `Last scan: ${last.description ?? humanize(last.status)}${last.location ? `, ${last.location}` : ''} · ${fmtDate(last.occurred_at, true)}` : 'No tracking scans yet.',
    sh.eta ? `Estimated delivery: ${fmtDate(sh.eta)}` : 'No estimated delivery date yet.',
    events.length > 1 ? `Earlier scans: ${events.slice(1).map((e) => `${e.description ?? humanize(e.status)} (${fmtDate(e.occurred_at)})`).join('; ')}` : null,
  ].filter(Boolean);
  return {
    title: `Shipment ${sh.tracking_no ?? sh.code}`,
    text: lines.join('\n'),
    data: {
      order_id: order?.id ?? sh.order_id, order_code: order?.code ?? null, shipment_code: sh.code, carrier: serviceName(sh.service_code),
      tracking_no: sh.tracking_no, status: sh.status, eta: sh.eta, events,
    },
  };
}

type QuoteRow = { id: string; code: string; supplier_id: string; unit_price_cents: number; quantity: number; incoterm: string | null; lead_time_days: number | null; shipping_cents: number; status: string; valid_until: string | null; currency: string };

export async function getQuoteFacts(sb: SupabaseClient, rfqId: string): Promise<Fact> {
  const q = rfqId.trim();
  const { data: rfq } = await sb.from('rfqs').select('id, code, title, quantity, unit, status, currency')
    .eq(UUID_RE.test(q) ? 'id' : 'code', UUID_RE.test(q) ? q : q.toUpperCase()).maybeSingle();
  if (!rfq) return { title: 'RFQ not found', text: `No RFQ matching "${q}" is visible on this account.`, data: null };
  const { data: qs } = await sb.from('quotes').select('id, code, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, status, valid_until, currency')
    .eq('rfq_id', rfq.id).order('unit_price_cents');
  const quotes = (qs ?? []) as QuoteRow[];
  const supIds = [...new Set(quotes.map((x) => x.supplier_id))];
  const { data: sups } = supIds.length ? await sb.from('public_suppliers').select('id, code, country, verified').in('id', supIds) : { data: [] };
  const sup = new Map((sups ?? []).map((s) => [s.id as string, s as { code: string; country: string | null; verified: boolean }]));
  const head = `${rfq.code} · ${rfq.title} · ${Number(rfq.quantity).toLocaleString('en-US')} ${rfq.unit ?? 'pcs'} · status ${humanize(rfq.status as string)}`;
  if (!quotes.length) return { title: `Quotes for ${rfq.code}`, text: `${head}\nNo quotes yet — suppliers are still preparing them.`, data: { rfq_id: rfq.id, rfq_code: rfq.code, quotes: [] } };

  const now = Date.now();
  const rows = quotes.map((x) => {
    const total = Number(x.unit_price_cents) * Number(x.quantity) + Number(x.shipping_cents ?? 0);
    const s = sup.get(x.supplier_id);
    return {
      code: x.code, supplier_code: s?.code ?? 'OCT-?', supplier_country: s?.country ?? null, verified: !!s?.verified,
      unit_price_minor: Number(x.unit_price_cents), quantity: x.quantity, incoterm: x.incoterm, lead_time_days: x.lead_time_days,
      shipping_minor: Number(x.shipping_cents ?? 0), total_minor: total, currency: x.currency, status: x.status, valid_until: x.valid_until,
      expired: !!x.valid_until && new Date(x.valid_until).getTime() < now,
    };
  });
  const live = rows.filter((r) => !r.expired && ['sent', 'viewed'].includes(r.status));
  const pool = live.length ? live : rows;
  const cheapest = [...pool].sort((a, b) => a.total_minor - b.total_minor)[0];
  const fastest = [...pool].filter((r) => r.lead_time_days != null).sort((a, b) => (a.lead_time_days ?? 0) - (b.lead_time_days ?? 0))[0];
  const lines = rows.map((r) =>
    `• ${r.code} · supplier ${r.supplier_code}${r.supplier_country ? ` (${r.supplier_country})` : ''}${r.verified ? ' verified' : ''} · unit ${money(r.unit_price_minor, r.currency)} × ${r.quantity.toLocaleString('en-US')}` +
    ` · ${r.incoterm ?? '—'} · lead ${r.lead_time_days != null ? `${r.lead_time_days} days` : '—'} · shipping ${money(r.shipping_minor, r.currency)} · total ${money(r.total_minor, r.currency)}` +
    ` · ${r.expired ? 'expired' : `valid until ${fmtDate(r.valid_until)}`} · ${humanize(r.status)}`);
  const summary = [
    cheapest ? `Lowest total: ${cheapest.code} (${cheapest.supplier_code}) at ${money(cheapest.total_minor, cheapest.currency)}.` : null,
    fastest && fastest.code !== cheapest?.code ? `Fastest: ${fastest.code} (${fastest.supplier_code}) in ${fastest.lead_time_days} days.` : null,
  ].filter(Boolean).join(' ');
  return {
    title: `Quotes for ${rfq.code}`,
    text: `${head}\n${lines.join('\n')}${summary ? `\n${summary}` : ''}`,
    data: { rfq_id: rfq.id, rfq_code: rfq.code, quotes: rows },
  };
}

export async function getWalletFacts(sb: SupabaseClient, orgId?: string | null): Promise<Fact> {
  let wq = sb.from('wallets').select('org_id, currency, account_id, balance_minor');
  if (orgId) wq = wq.eq('org_id', orgId);
  const { data: ws } = await wq;
  const wallets = (ws ?? []) as { org_id: string; currency: string; account_id: string; balance_minor: number }[];
  if (!wallets.length) return { title: 'Wallet', text: 'No wallet has been opened on this account yet.', data: { wallets: [] } };
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: le } = await sb.from('ledger_entries').select('account_id, debit_cents, credit_cents, currency, memo, created_at')
    .in('account_id', wallets.map((w) => w.account_id)).gte('created_at', since).order('created_at', { ascending: false }).limit(500);
  const entries = (le ?? []) as { account_id: string; debit_cents: number; credit_cents: number; currency: string; memo: string | null; created_at: string }[];
  const rows = wallets.map((w) => {
    const mine = entries.filter((e) => e.account_id === w.account_id);
    return {
      currency: w.currency, balance_minor: Number(w.balance_minor),
      in_90d_minor: mine.reduce((a, e) => a + Number(e.credit_cents), 0),
      out_90d_minor: mine.reduce((a, e) => a + Number(e.debit_cents), 0),
      movements_90d: mine.length,
      last: mine[0] ? { memo: mine[0].memo, at: mine[0].created_at, amount_minor: Number(mine[0].credit_cents) - Number(mine[0].debit_cents) } : null,
    };
  });
  const text = rows.map((r) =>
    `${r.currency} wallet: balance ${money(r.balance_minor, r.currency)} · last 90 days: in ${money(r.in_90d_minor, r.currency)}, out ${money(r.out_90d_minor, r.currency)} (${r.movements_90d} movements)` +
    (r.last ? ` · latest: ${r.last.memo ?? 'movement'} ${money(r.last.amount_minor, r.currency)} on ${fmtDate(r.last.at)}` : '')).join('\n');
  return { title: 'Wallet balance', text, data: { wallets: rows } };
}
