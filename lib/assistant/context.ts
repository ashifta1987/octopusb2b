import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtDate, humanize, money } from '@/lib/format';
import { serviceName } from '@/lib/service-names';
import { redactText } from './redact';
import type { ContextCounts } from './types';

/**
 * Context payload for Octo, built only from the customer's OWN rows via their RLS-scoped client (SPEC §20.1, §20.6).
 * Plain-text summary (never raw SQL / raw rows); supplier identities as codes only; contacts and addresses omitted, then redacted again.
 */
export const OPEN_RFQ = ['submitted', 'assigned', 'quoting', 'quoted'];
const ACTIVE_PLEDGE = ['pending', 'paid', 'confirmed', 'shipped'];

export async function getContextCounts(sb: SupabaseClient, orgId: string): Promise<ContextCounts> {
  const [o, r, p] = await Promise.all([
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', orgId).not('status', 'in', '(cancelled,closed)'),
    sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('org_id', orgId).in('status', OPEN_RFQ),
    sb.from('pool_pledge_mine_view').select('id', { count: 'exact', head: true }).eq('org_id', orgId).in('status', ACTIVE_PLEDGE),
  ]);
  return { orders: o.count ?? 0, openRfqs: r.count ?? 0, pledges: p.count ?? 0 };
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));

export async function buildContext(sb: SupabaseClient, orgId: string): Promise<{ text: string; counts: ContextCounts }> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const [org, rfqs, orders, docs, srs, wallets, pledges, shipments, counts] = await Promise.all([
    sb.from('organizations').select('name, buyer_code, country, business_type, kyc_status').eq('id', orgId).maybeSingle(),
    sb.from('rfqs').select('id, code, title, quantity, unit, status, incoterm, destination_country, expires_at, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(10),
    sb.from('orders').select('id, code, title, quantity, status, total_cents, paid_cents, currency, supplier_id, incoterm, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(8),
    sb.from('documents').select('doc_type, number, amount_cents, currency, status, created_at, orders(code)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(8),
    sb.from('service_requests').select('code, service_code, status, fee_minor, currency, created_at, services(name)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(8),
    sb.from('wallets').select('currency, account_id, balance_minor').eq('org_id', orgId),
    sb.from('pool_pledge_mine_view').select('pool_code, product_title, qty, status, pool_status, deadline_at, deposit_minor, balance_minor, currency, balance_due_at').eq('org_id', orgId).order('joined_at', { ascending: false }).limit(6),
    sb.from('shipments').select('id, code, order_id, service_code, tracking_no, status, eta').eq('org_id', orgId).order('created_at', { ascending: false }).limit(5),
    getContextCounts(sb, orgId),
  ]);

  const rfqRows = (rfqs.data ?? []) as Row[];
  const openRfqIds = rfqRows.filter((r) => OPEN_RFQ.includes(s(r.status))).map((r) => s(r.id));
  const orderRows = (orders.data ?? []) as Row[];
  const shipRows = (shipments.data ?? []) as Row[];
  const walletRows = (wallets.data ?? []) as Row[];

  const [quotes, events, ledger] = await Promise.all([
    openRfqIds.length ? sb.from('quotes').select('rfq_id, code, supplier_id, unit_price_cents, currency, lead_time_days, status, valid_until').in('rfq_id', openRfqIds) : Promise.resolve({ data: [] as Row[] }),
    shipRows.length ? sb.from('tracking_events').select('shipment_id, description, status, location, occurred_at').in('shipment_id', shipRows.map((x) => s(x.id))).order('occurred_at', { ascending: false }).limit(25) : Promise.resolve({ data: [] as Row[] }),
    walletRows.length ? sb.from('ledger_entries').select('account_id, debit_cents, credit_cents, currency').in('account_id', walletRows.map((w) => s(w.account_id))).gte('created_at', since).limit(1000) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const quoteRows = (quotes.data ?? []) as Row[];
  const supIds = [...new Set([...quoteRows.map((q) => s(q.supplier_id)), ...orderRows.map((o) => s(o.supplier_id))].filter(Boolean))];
  const { data: supData } = supIds.length ? await sb.from('public_suppliers').select('id, code, country').in('id', supIds) : { data: [] };
  const supCode = new Map((supData ?? []).map((x) => [s(x.id), `${s(x.code)}${x.country ? ` (${s(x.country)})` : ''}`]));
  const evRows = (events.data ?? []) as Row[];
  const ledRows = (ledger.data ?? []) as Row[];

  const o = org.data as Row | null;
  const lines: string[] = [];
  lines.push(`## Customer`, `Company: ${s(o?.name)} · buyer code ${s(o?.buyer_code) || '—'} · country ${s(o?.country) || '—'} · ${s(o?.business_type) || 'business type n/a'} · KYC status: ${humanize(s(o?.kyc_status))}`);

  lines.push('', `## RFQs (latest ${rfqRows.length})`);
  if (!rfqRows.length) lines.push('None.');
  for (const r of rfqRows) {
    const qs = quoteRows.filter((q) => q.rfq_id === r.id);
    lines.push(`- ${s(r.code)} · ${s(r.title)} · ${Number(r.quantity).toLocaleString('en-US')} ${s(r.unit) || 'pcs'} · ${humanize(s(r.status))}${r.incoterm ? ` · ${s(r.incoterm)}` : ''}${r.destination_country ? ` · to ${s(r.destination_country)}` : ''}` +
      (qs.length ? ` · ${qs.length} quote(s): ${qs.map((q) => `${s(q.code)} ${supCode.get(s(q.supplier_id)) ?? 'OCT-?'} ${money(Number(q.unit_price_cents), s(q.currency))}/unit${q.lead_time_days != null ? ` ${s(q.lead_time_days)}d` : ''} ${humanize(s(q.status))}`).join('; ')}` : ''));
  }

  lines.push('', `## Orders (latest ${orderRows.length})`);
  if (!orderRows.length) lines.push('None.');
  for (const r of orderRows) {
    lines.push(`- ${s(r.code)} · ${Number(r.quantity).toLocaleString('en-US')} × ${s(r.title)} · supplier ${supCode.get(s(r.supplier_id)) ?? 'OCT-?'} · ${humanize(s(r.status))} · total ${money(Number(r.total_cents), s(r.currency))}, paid ${money(Number(r.paid_cents ?? 0), s(r.currency))} · ${s(r.incoterm)} · placed ${fmtDate(s(r.created_at))}`);
  }

  lines.push('', '## Shipments');
  if (!shipRows.length) lines.push('None.');
  for (const sh of shipRows) {
    const ev = evRows.find((e) => e.shipment_id === sh.id);
    const oc = orderRows.find((x) => x.id === sh.order_id);
    lines.push(`- ${s(sh.code)}${oc ? ` (order ${s(oc.code)})` : ''} · ${serviceName(s(sh.service_code))} · tracking ${s(sh.tracking_no) || '—'} · ${humanize(s(sh.status))}${sh.eta ? ` · ETA ${fmtDate(s(sh.eta))}` : ''}` +
      (ev ? ` · last scan: ${s(ev.description) || humanize(s(ev.status))}${ev.location ? `, ${s(ev.location)}` : ''} ${fmtDate(s(ev.occurred_at), true)}` : ''));
  }

  lines.push('', '## Documents (latest)');
  const docRows = (docs.data ?? []) as Row[];
  if (!docRows.length) lines.push('None.');
  for (const d of docRows) {
    const oc = (d.orders as { code?: string } | null)?.code;
    lines.push(`- ${s(d.number)} · ${humanize(s(d.doc_type))}${oc ? ` · ${oc}` : ''}${d.amount_cents != null ? ` · ${money(Number(d.amount_cents), s(d.currency))}` : ''} · ${humanize(s(d.status) || 'issued')} · ${fmtDate(s(d.created_at))}`);
  }

  lines.push('', '## Service requests (latest)');
  const srRows = (srs.data ?? []) as Row[];
  if (!srRows.length) lines.push('None.');
  for (const r of srRows) {
    lines.push(`- ${s(r.code)} · ${(r.services as { name?: string } | null)?.name ?? humanize(s(r.service_code))} · ${humanize(s(r.status))}${r.fee_minor != null ? ` · fee ${money(Number(r.fee_minor), s(r.currency))}` : ''} · ${fmtDate(s(r.created_at))}`);
  }

  lines.push('', '## Wallet');
  if (!walletRows.length) lines.push('No wallet yet.');
  for (const w of walletRows) {
    const mine = ledRows.filter((e) => e.account_id === w.account_id);
    const cin = mine.reduce((a, e) => a + Number(e.credit_cents), 0);
    const cout = mine.reduce((a, e) => a + Number(e.debit_cents), 0);
    lines.push(`- ${s(w.currency)} balance ${money(Number(w.balance_minor), s(w.currency))} · last 90 days: in ${money(cin, s(w.currency))}, out ${money(cout, s(w.currency))}, ${mine.length} movements`);
  }

  lines.push('', '## Group-buy pledges');
  const plRows = (pledges.data ?? []) as Row[];
  if (!plRows.length) lines.push('None.');
  for (const p of plRows) {
    lines.push(`- ${s(p.pool_code)} · ${s(p.product_title)} · qty ${s(p.qty)} · pledge ${humanize(s(p.status))} · pool ${humanize(s(p.pool_status))} · deposit ${money(Number(p.deposit_minor), s(p.currency))}${p.balance_minor != null ? ` · balance ${money(Number(p.balance_minor), s(p.currency))}${p.balance_due_at ? ` due ${fmtDate(s(p.balance_due_at))}` : ''}` : ''} · deadline ${fmtDate(s(p.deadline_at))}`);
  }

  return { text: redactText(lines.join('\n')), counts };
}

/** Context hint for the floating bubble, from the current portal URL (e.g. "This is RFQ-1042 — compare the 3 quotes?"). */
export async function pageHint(sb: SupabaseClient, page: string | null | undefined): Promise<{ hint: string; prompt: string } | null> {
  if (!page) return null;
  const m = /^\/account\/(rfqs|orders|services|pools|wallet|ledger)(?:\/([0-9a-f-]{36}))?/i.exec(page);
  if (!m) return null;
  const [, section, id] = m;
  if (section === 'rfqs' && id) {
    const { data: r } = await sb.from('rfqs').select('code').eq('id', id).maybeSingle();
    if (!r) return null;
    const { count } = await sb.from('quotes').select('id', { count: 'exact', head: true }).eq('rfq_id', id).in('status', ['sent', 'viewed']);
    return count
      ? { hint: `This is ${r.code} — do you want to compare the ${count === 1 ? 'quote' : `${count} quotes`}?`, prompt: `Compare the quotes on ${r.code}` }
      : { hint: `This is ${r.code} — want a status update?`, prompt: `What's the status of ${r.code}?` };
  }
  if (section === 'orders' && id) {
    const { data: o } = await sb.from('orders').select('code').eq('id', id).maybeSingle();
    return o ? { hint: `This is ${o.code} — want the latest tracking?`, prompt: `Where is order ${o.code}?` } : null;
  }
  if (section === 'wallet' || section === 'ledger') return { hint: 'Want a summary of your wallet and last 90 days?', prompt: 'Summarise my wallet balance and the last 90 days' };
  if (section === 'pools') return { hint: 'Looking at group buys — want the open pools?', prompt: 'Which group-buy pools are open?' };
  if (section === 'services') return { hint: 'Need a sample or QC inspection? I can draft it for you.', prompt: 'Help me request a QC inspection' };
  return null;
}
