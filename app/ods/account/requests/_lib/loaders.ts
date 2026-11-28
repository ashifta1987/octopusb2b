import 'server-only';
/**
 * ODS /account/requests data. The list is TODAY's listSourcing() (components/account/sourcing-data.ts). The detail copies
 * today's /account/sourcing/[ref] queries (explicit customer-safe columns: no assigned_to, no supplier ids or names —
 * factories only through quoteFactoryMap = "Verified factory · China (Guangdong)"). Read-only.
 */
import { requireAccount } from '../../_lib/loaders';
import { createClient } from '@/lib/supabase/server';
import { humanize, COUNTRY_NAMES } from '@/lib/format';
import { TYPE_LABEL, serviceType } from '@/lib/sourcing';
import { listSourcing } from '@/components/account/sourcing-data';
import { getSettings, latestTermsId, quoteFactoryMap, type FactoryInfo } from '@/components/account/data';
import { nowMs } from '@/components/account/order-utils';
import { factoryLabel } from '@/lib/factory-label';
import { UUID_RE, dateText } from '../../orders/_lib/commerce-format';
import { orderStatusName } from '../../orders/_lib/order-logic';
import { optionLabel, requestSteps, rfqStatusName, serviceRequestStatusName, toRequestRow, type RequestRowVM, type RequestStatusName } from './request-logic';

export async function loadRequestRows(): Promise<RequestRowVM[]> {
  const s = await requireAccount('/account/requests');
  const rows = await listSourcing(s.org!.id);
  return rows.map(toRequestRow);
}

export type QuoteVM = {
  id: string;
  code: string;
  option: string;
  factory: string;
  unitCents: number;
  quantity: number;
  /** today's page: unit × quantity + shipping (the quote total the approve dialog shows) */
  totalCents: number;
  /** today's ApproveQuoteButton display: round(total × deposit% / 100) */
  depositCents: number;
  currency: string;
  moq: number | null;
  leadDays: number | null;
  incoterm: string | null;
  validUntil: string;
  sampleCents: number | null;
  notes: string | null;
  isNew: boolean;
  approvable: boolean;
  state: string;
};

export type RequestDetailVM = {
  kind: 'rfq' | 'service';
  id: string;
  ref: string;
  title: string;
  typeLabel: string;
  statusName: RequestStatusName;
  createdAt: string;
  unit: string | null;
  steps: { label: string; status: 'done' | 'current' | 'upcoming' | 'error' }[];
  details: [string, string][];
  lines: { no: number; title: string; quantity: number; unit: string; notes: string | null }[];
  quotes: QuoteVM[];
  expiresSoon: { code: string; until: string } | null;
  order: { ref: string; statusName: string } | null;
  messages: { id: string; fromStaff: boolean; body: string; at: string }[] | null;
  files: { id: string; name: string; kind: string; fromStaff: boolean; at: string }[] | null;
  docs: { id: string; number: string; type: string; at: string }[];
  fee: { cents: number; currency: string; label: string } | null;
  depositPct: number;
  termsVersion: string | null;
  hasNewQuotes: boolean;
  timeline: { id: string; title: string; body?: string; at: string }[];
};

const factoryText = (f: FactoryInfo | undefined) => factoryLabel(f ?? null);

export async function loadRequestDetail(ref: string): Promise<RequestDetailVM | null> {
  await requireAccount(`/account/requests/${encodeURIComponent(ref)}`);
  const sb = await createClient();
  const col = UUID_RE.test(ref) ? 'id' : 'code';
  const [{ data: rfq }, { data: svc }] = await Promise.all([
    sb.from('rfqs').select('id, code, product_id, title, details, quantity, unit, target_price_cents, destination_country, destination_city, incoterm, status, fee_minor, expires_at, created_at, currency').eq(col, ref).maybeSingle(),
    sb.from('service_requests').select('id, code, service_code, status, details, fee_minor, paid_via, created_at, currency').eq(col, ref).maybeSingle(),
  ]);
  if (!rfq && !svc) return null;
  const kind: 'rfq' | 'service' = rfq ? 'rfq' : 'service';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = (rfq ?? svc)! as Record<string, any>;
  const id = req.id as string;
  const fk = kind === 'rfq' ? 'rfq_id' : 'service_request_id';
  const [msgs, files, settings, terms] = await Promise.all([
    sb.from('request_messages').select('id, from_staff, body, created_at').eq(fk, id).order('created_at'),
    sb.from('request_files').select('id, file_name, file_kind, size_bytes, from_staff, created_at').eq(fk, id).order('created_at'),
    getSettings(),
    latestTermsId(),
  ]);

  type Q = { id: string; code: string; unit_price_cents: number; quantity: number; incoterm: string | null; lead_time_days: number | null; shipping_cents: number; notes: string | null; status: string; valid_until: string; created_at: string; currency: string; moq: number | null; sample_price_cents: number | null };
  let quotes: Q[] = [];
  let order = null as { id: string; code: string; status: string; created_at: string } | null;
  let docs: { id: string; doc_type: string; number: string; created_at: string }[] = [];
  let lines: { line_no: number; title: string; quantity: number; unit: string; notes: string | null }[] = [];
  if (kind === 'rfq') {
    const [{ data: q }, { data: o }, { data: ln }] = await Promise.all([
      sb.from('quotes').select('id, code, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until, created_at, currency, moq, sample_price_cents').eq('rfq_id', id).order('unit_price_cents'),
      sb.from('orders').select('id, code, status, created_at').eq('rfq_id', id).maybeSingle(),
      sb.from('rfq_lines').select('line_no, title, quantity, unit, notes').eq('rfq_id', id).order('line_no'),
    ]);
    quotes = (q ?? []) as Q[];
    order = o as typeof order;
    lines = (ln ?? []) as typeof lines;
    if (order) docs = ((await sb.from('documents').select('id, doc_type, number, created_at').eq('order_id', order.id).in('doc_type', ['proforma_invoice', 'commercial_invoice', 'receipt', 'confirmation', 'credit_note', 'qc_report']).order('created_at')).data ?? []) as typeof docs;
  }
  const factories = await quoteFactoryMap(quotes.map((x) => x.id));
  const now = nowMs();
  const statusName = kind === 'rfq' ? rfqStatusName(req.status as string, order?.status) : serviceRequestStatusName(req.status as string);
  const type = kind === 'rfq' ? 'sourcing' : serviceType(req.service_code as string);
  const depositPct = settings.deposit_pct;

  const quoteVMs: QuoteVM[] = quotes.map((x, i) => {
    const unit = Number(x.unit_price_cents);
    const total = unit * x.quantity + Number(x.shipping_cents);
    const approvable = (x.status === 'sent' || x.status === 'viewed') && new Date(x.valid_until).getTime() > now && !order;
    return {
      id: x.id,
      code: x.code,
      option: optionLabel(i),
      factory: factoryText(factories.get(x.id)),
      unitCents: unit,
      quantity: x.quantity,
      totalCents: total,
      depositCents: Math.round((total * depositPct) / 100),
      currency: x.currency,
      moq: x.moq,
      leadDays: x.lead_time_days,
      incoterm: x.incoterm,
      validUntil: x.valid_until,
      sampleCents: x.sample_price_cents == null ? null : Number(x.sample_price_cents),
      notes: x.notes,
      isNew: x.status === 'sent',
      approvable,
      state: approvable ? 'Open' : x.status === 'approved' ? 'Accepted' : x.status === 'rejected' ? 'Declined' : order ? 'Not selected' : 'Expired',
    };
  });
  const open = quoteVMs.filter((x) => x.approvable).sort((a, b) => a.validUntil.localeCompare(b.validUntil))[0];
  const expiresSoon = open && Date.parse(open.validUntil) - now < 3 * 86400e3 ? { code: open.code, until: open.validUntil } : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const det = (kind === 'service' ? (req.details ?? {}) : {}) as Record<string, any>;
  const details: [string, string][] =
    kind === 'rfq'
      ? ([
          ['Product', req.title as string],
          ['Quantity', `${Number(req.quantity).toLocaleString('en-US')} ${req.unit ?? ''}`.trim()],
          ['Destination', req.destination_country ? `${COUNTRY_NAMES[req.destination_country as string] ?? req.destination_country}${req.destination_city ? `, ${req.destination_city}` : ''}` : '—'],
          ['Incoterm', (req.incoterm as string) || '—'],
          ['Expires', req.expires_at ? dateText(req.expires_at as string) : '—'],
          ...(req.details ? ([['Details', String(req.details)]] as [string, string][]) : []),
        ] as [string, string][])
      : Object.entries(det)
          .filter(([, v]) => v !== '' && v != null)
          .map(([k, v]) => [humanize(k), k.endsWith('country') || k === 'target_market' ? (COUNTRY_NAMES[String(v)] ?? String(v)) : String(v)] as [string, string]);

  const m = (msgs.data ?? []) as { id: string; from_staff: boolean; body: string; created_at: string }[];
  const f = (files.data ?? []) as { id: string; file_name: string; file_kind: string; from_staff: boolean; created_at: string }[];
  const timeline = [
    { id: 'sent', title: `Request ${req.code} sent`, at: req.created_at as string },
    ...quotes.map((x, i) => ({ id: `q-${x.id}`, title: `${optionLabel(i)} received`, body: x.code, at: x.created_at })),
    ...m.map((x) => ({ id: `m-${x.id}`, title: x.from_staff ? 'Message from the sourcing team' : 'You sent a message', at: x.created_at })),
    ...f.map((x) => ({ id: `f-${x.id}`, title: `File added: ${x.file_name}`, at: x.created_at })),
    ...(order ? [{ id: 'order', title: `Order ${order.code} created`, at: order.created_at }] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    kind,
    id,
    ref: req.code as string,
    title: (kind === 'rfq' ? req.title : (det.title ?? det.product ?? TYPE_LABEL[type])) as string,
    typeLabel: TYPE_LABEL[type],
    statusName,
    createdAt: req.created_at as string,
    unit: (req.unit as string | null) ?? null,
    steps: requestSteps(kind, statusName, { hasOrder: !!order, quotes: quotes.length, rawService: kind === 'service' ? (req.status as string) : undefined }),
    details,
    lines: lines.map((l) => ({ no: l.line_no, title: l.title, quantity: Number(l.quantity), unit: l.unit, notes: l.notes })),
    quotes: quoteVMs,
    expiresSoon,
    order: order ? { ref: order.code, statusName: orderStatusName(order.status) } : null,
    messages: msgs.error ? null : m.map((x) => ({ id: x.id, fromStaff: x.from_staff, body: x.body, at: x.created_at })),
    files: files.error ? null : f.map((x) => ({ id: x.id, name: x.file_name, kind: humanize(x.file_kind), fromStaff: x.from_staff, at: x.created_at })),
    docs: docs.map((d) => ({ id: d.id, number: d.number, type: humanize(d.doc_type), at: d.created_at })),
    fee: Number(req.fee_minor ?? 0) > 0 ? { cents: Number(req.fee_minor), currency: (req.currency as string) ?? 'USD', label: kind === 'rfq' ? 'Sourcing request fee' : `${TYPE_LABEL[type]} fee` } : null,
    depositPct,
    termsVersion: terms?.version ?? null,
    hasNewQuotes: quotes.some((x) => x.status === 'sent'),
    timeline,
  };
}
