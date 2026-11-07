import 'server-only';
import { serviceName } from '@/lib/service-names';
import type { createClient } from '@/lib/supabase/server';
import { fmtDate, humanize, money } from '@/lib/format';

/**
 * Local fallback for the Octo side-rail facts (same signatures as `lib/assistant/facts.ts`, SPEC §20.5).
 * Uses the PASSED Supabase client so RLS applies (an account manager only sees their own customers' rows).
 * Never exposes supplier legal names — supplier codes only (public_suppliers).
 */
export type Fact = { title: string; text: string; data: unknown };

type Sb = Awaited<ReturnType<typeof createClient>>;

export async function getShipmentFacts(sb: Sb, trackingOrOrderCode: string): Promise<Fact | null> {
  const ref = (trackingOrOrderCode ?? '').trim();
  if (!ref) return null;
  let orderId: string | null = null;
  let orderCode: string | null = null;
  let orderStatus: string | null = null;
  const { data: ord } = await sb.from('orders').select('id, code, status').eq('code', ref.toUpperCase()).maybeSingle();
  if (ord) { orderId = ord.id as string; orderCode = ord.code as string; orderStatus = ord.status as string; }
  let q = sb.from('shipments').select('code, order_id, service_code, tracking_no, status, eta, last_event_at, created_at').order('created_at', { ascending: false }).limit(1);
  q = orderId ? q.eq('order_id', orderId) : q.eq('tracking_no', ref);
  const { data: rows } = await q;
  const sh = rows?.[0];
  if (!sh) {
    if (!orderCode) return null;
    return { title: `Order ${orderCode}`, text: `Order ${orderCode} is ${humanize(orderStatus)}. No shipment has been booked yet.`, data: { order: orderCode, status: orderStatus } };
  }
  if (!orderCode && sh.order_id) {
    const { data: o } = await sb.from('orders').select('code, status').eq('id', sh.order_id).maybeSingle();
    orderCode = (o?.code as string) ?? null;
    orderStatus = (o?.status as string) ?? null;
  }
  const carrier = serviceName(sh.service_code as string | null); // white-label: replies go to customers
  const parts = [
    `${orderCode ? `Order ${orderCode}` : `Shipment ${sh.code}`} is ${humanize(sh.status as string).toLowerCase()} with ${carrier} shipping`,
    sh.tracking_no ? `tracking ${sh.tracking_no}` : null,
  ].filter(Boolean).join(', ');
  const eta = sh.eta ? ` Carrier ETA: ${fmtDate(sh.eta as string)}.` : '';
  const last = sh.last_event_at ? ` Last tracking update ${fmtDate(sh.last_event_at as string, true)}.` : '';
  return { title: `Shipment · ${orderCode ?? sh.code}`, text: `${parts}.${eta}${last}`, data: { ...sh, order_code: orderCode, order_status: orderStatus } };
}

export async function getQuoteFacts(sb: Sb, rfqId: string): Promise<Fact | null> {
  const { data: rfq } = await sb.from('rfqs').select('id, code, title, quantity, status').eq('id', rfqId).maybeSingle();
  if (!rfq) return null;
  const { data: quotes } = await sb.from('quotes')
    .select('code, supplier_id, unit_price_cents, quantity, shipping_cents, lead_time_days, incoterm, valid_until, status, currency')
    .eq('rfq_id', rfqId).in('status', ['sent', 'viewed', 'approved']).order('unit_price_cents');
  const ids = [...new Set((quotes ?? []).map((q) => q.supplier_id as string).filter(Boolean))];
  const { data: sups } = ids.length ? await sb.from('public_suppliers').select('id, code').in('id', ids) : { data: [] as { id: string; code: string }[] };
  const code = (id: string) => (sups ?? []).find((s) => s.id === id)?.code ?? 'Supplier';
  if (!quotes?.length) {
    return { title: `Quotes · ${rfq.code}`, text: `${rfq.code} (${rfq.title}) is ${humanize(rfq.status as string).toLowerCase()} — no quotes sent yet.`, data: { rfq, quotes: [] } };
  }
  const lines = quotes.map((q) =>
    `${code(q.supplier_id as string)}: ${money(q.unit_price_cents as number, q.currency as string)}/unit × ${q.quantity}` +
    `${q.lead_time_days ? `, ${q.lead_time_days} days lead time` : ''}${q.incoterm ? `, ${q.incoterm}` : ''}` +
    `${q.valid_until ? `, valid until ${fmtDate(q.valid_until as string)}` : ''}`);
  return {
    title: `Quotes · ${rfq.code}`,
    text: `${rfq.code} (${rfq.title}) has ${quotes.length} quote${quotes.length === 1 ? '' : 's'}:\n${lines.map((l) => `• ${l}`).join('\n')}`,
    data: { rfq, quotes: quotes.map((q) => ({ ...q, supplier_id: undefined, supplier_code: code(q.supplier_id as string) })) },
  };
}

export async function getWalletFacts(sb: Sb, orgId?: string): Promise<Fact | null> {
  let rows: { currency: string; balance_minor: number }[] = [];
  if (orgId) {
    const { data, error } = await sb.rpc('assistant_org_wallets', { p_org: orgId });
    if (!error) rows = (data ?? []) as typeof rows;
  }
  if (!rows.length) {
    let q = sb.from('wallets').select('currency, balance_minor');
    if (orgId) q = q.eq('org_id', orgId);
    const { data } = await q;
    rows = (data ?? []) as typeof rows;
  }
  if (!rows.length) return { title: 'Wallet', text: 'No wallet balance on file yet.', data: [] };
  const text = `Wallet balance: ${rows.map((r) => money(Number(r.balance_minor), r.currency)).join(' · ')}.`;
  return { title: 'Wallet', text, data: rows };
}
