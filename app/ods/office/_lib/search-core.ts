/**
 * ODS T8 · command palette records (Part 7.1 "Records" + "Actions" groups) — pure part: query cleaning, which record
 * kinds a person may search (today's page permissions), and row → palette item mapping. The server action in
 * ./search.ts runs the reads with the staff member's own session (row-level security applies, as on today's pages).
 *
 * White-label / Part 7.7: no supplier names, codes, cost or margin are selected for any record kind; supplier records
 * themselves only for suppliers:view (Admin › Suppliers), exactly like today's menu.
 */
import { can, isManager, type OfficePerms } from './nav';

export type RecordKind = 'customer' | 'rfq' | 'quote' | 'order' | 'invoice' | 'payment' | 'product' | 'supplier';

export type PaletteRecord = { id: string; group: 'records' | 'actions'; label: string; description?: string; href: string; kind: RecordKind | 'action' };

export const SEARCH_LIMIT = 5;
export const SEARCH_MIN = 2;

/** PostgREST-safe ilike text: no filter syntax ( , ( ) ), no wildcards from the user, 60 chars max. */
export function cleanQuery(q: string): string {
  const t = q.replace(/[,()%_*\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t.length >= SEARCH_MIN ? t : '';
}

/** Record kinds per today's page guards (the page you land on checks the same permission again). */
export const RECORD_RULES: Record<RecordKind, (p: OfficePerms) => boolean> = {
  customer: (p) => can(p, 'customers') || isManager(p), // /admin/customers/[id]
  rfq: (p) => can(p, 'requests'), // /office/rfqs/[id]
  quote: (p) => can(p, 'requests'), // quotes live on the RFQ page
  order: (p) => can(p, 'orders'), // /office/orders/[id]
  invoice: (p) => can(p, 'orders'), // proforma invoices → their order page (orders:view)
  payment: (p) => can(p, 'finance'), // /admin/finance
  product: (p) => can(p, 'products', 'approve'), // /office/products?p=<id> (moderation)
  supplier: (p) => can(p, 'suppliers'), // /admin/suppliers?id=<id>
};

export const searchableKinds = (p: OfficePerms): RecordKind[] => (Object.keys(RECORD_RULES) as RecordKind[]).filter((k) => RECORD_RULES[k](p));

const human = (s: unknown) => String(s ?? '').replace(/_/g, ' ');
const where = (city?: unknown, country?: unknown) => [city, country].filter(Boolean).join(', ');

export type SearchRows = Partial<{
  customer: { id: string; name: string; buyer_code?: string | null; city?: string | null; country?: string | null }[];
  rfq: { id: string; code: string; title: string; status: string }[];
  quote: { id: string; code: string; status: string; rfq_id: string }[];
  order: { id: string; code: string; title: string; status: string; total_cents?: number | null; paid_cents?: number | null }[];
  invoice: { id: string; number: string; order_id: string }[];
  payment: { id: string; reference: string | null; status: string; purpose: string }[];
  product: { id: string; title: string; slug: string; status: string }[];
  supplier: { id: string; code: string; legal_name: string; country?: string | null }[];
}>;

/** RFQ statuses that can still get a quote (today's "To quote" filter). */
const QUOTABLE = ['submitted', 'assigned', 'quoting'];
const ACTIVE_ORDER_DONE = ['cancelled', 'closed', 'delivered'];

export function toPaletteItems(rows: SearchRows, p: OfficePerms): PaletteRecord[] {
  const out: PaletteRecord[] = [];
  for (const c of rows.customer ?? []) {
    out.push({ id: `rec:customer:${c.id}`, group: 'records', kind: 'customer', label: c.name, description: ['Customer', c.buyer_code, where(c.city, c.country)].filter(Boolean).join(' · '), href: `/admin/customers/${c.id}` });
  }
  for (const r of rows.rfq ?? []) {
    out.push({ id: `rec:rfq:${r.id}`, group: 'records', kind: 'rfq', label: `${r.code} · ${r.title}`, description: `Sourcing request · ${human(r.status)}`, href: `/office/rfqs/${r.id}` });
    if (QUOTABLE.includes(r.status) && can(p, 'requests', 'create')) {
      out.push({ id: `act:quote:${r.id}`, group: 'actions', kind: 'action', label: `New quote for ${r.code}`, description: r.title, href: `/office/rfqs/${r.id}` });
    }
  }
  for (const q of rows.quote ?? []) {
    out.push({ id: `rec:quote:${q.id}`, group: 'records', kind: 'quote', label: q.code, description: `Quote · ${human(q.status)}`, href: `/office/rfqs/${q.rfq_id}` });
  }
  for (const o of rows.order ?? []) {
    out.push({ id: `rec:order:${o.id}`, group: 'records', kind: 'order', label: `${o.code} · ${o.title}`, description: `Order · ${human(o.status)}`, href: `/office/orders/${o.id}` });
    const due = Number(o.total_cents ?? 0) - Number(o.paid_cents ?? 0);
    // the order page's payment form needs finance:approve (record_payment, with 2FA step-up) — same rule here
    if (due > 0 && !ACTIVE_ORDER_DONE.includes(o.status) && can(p, 'finance', 'approve')) {
      out.push({ id: `act:pay:${o.id}`, group: 'actions', kind: 'action', label: `Record payment for ${o.code}`, description: o.title, href: `/office/orders/${o.id}` });
    }
  }
  for (const i of rows.invoice ?? []) {
    out.push({ id: `rec:invoice:${i.id}`, group: 'records', kind: 'invoice', label: i.number, description: 'Proforma invoice · opens its order', href: `/office/orders/${i.order_id}` });
  }
  for (const pay of rows.payment ?? []) {
    out.push({ id: `rec:payment:${pay.id}`, group: 'records', kind: 'payment', label: pay.reference || 'Payment without reference', description: `Payment · ${human(pay.purpose)} · ${human(pay.status)}`, href: '/admin/finance' });
  }
  for (const pr of rows.product ?? []) {
    out.push({ id: `rec:product:${pr.id}`, group: 'records', kind: 'product', label: pr.title, description: `Product · ${human(pr.status)}`, href: `/office/products?p=${pr.id}` });
  }
  for (const s of rows.supplier ?? []) {
    out.push({ id: `rec:supplier:${s.id}`, group: 'records', kind: 'supplier', label: `${s.code} · ${s.legal_name}`, description: ['Supplier', s.country].filter(Boolean).join(' · '), href: `/admin/suppliers?id=${s.id}` });
  }
  return out;
}
