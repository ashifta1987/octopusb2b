import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { applySteps, orgIdsByName, seedExclusion, type Sb, type Step } from '../../_shared/accounts-server';
import { PAYMENTS_SPEC, PAYMENT_DB, PURPOSE_LABEL, dateBounds, methodLabel, paymentName, safeSearch, type ListQuery, type ListResult, type PaymentRow } from '../../_shared/accounts-core';

/**
 * Payments — recorded payments, read-only: `payments` (order deposits / balances, wallet top-ups, service — record_payment,
 * checkout, wallet) and `document_payments` (service proformas — pay_service_proforma). RLS pay_read (finance:view within
 * the division) / document_payments_read (the document is readable). Test (seed) payments hidden as on today's Finance page.
 */
const PAY_COLS: string = 'id, org_id, order_id, purpose, method, amount_cents, currency, reference, status, created_at, confirmed_at, organizations(name), orders(code)';
const DOCPAY_COLS: string = 'id, document_id, org_id, amount_cents, currency, method, reference, journal_id, invoice_id, created_at, organizations(name), doc:documents!document_id(number, order_id), inv:documents!invoice_id(number)';

type PayRow = { id: string; org_id: string | null; order_id: string | null; purpose: string; method: string; amount_cents: number; currency: string | null; reference: string | null; status: string; created_at: string; confirmed_at: string | null; organizations: { name?: string } | null; orders: { code?: string } | null };
type DocPayRow = { id: string; document_id: string; amount_cents: number; currency: string | null; method: string; reference: string | null; journal_id: string | null; invoice_id: string | null; created_at: string; organizations: { name?: string } | null; doc: { number?: string; order_id?: string | null } | null; inv: { number?: string } | null };

const payRow = (p: PayRow, docs: Map<string, { id: string; number: string }>): PaymentRow => ({
  source: 'payment',
  id: p.id,
  at: p.confirmed_at ?? p.created_at,
  customer: p.organizations?.name ?? '—',
  purpose: PURPOSE_LABEL[p.purpose] ?? p.purpose,
  method: methodLabel(p.method),
  reference: p.reference,
  orderId: p.order_id,
  orderCode: p.orders?.code ?? null,
  documentId: p.order_id ? (docs.get(p.order_id)?.id ?? null) : null,
  documentNumber: p.order_id ? (docs.get(p.order_id)?.number ?? null) : null,
  invoiceId: null,
  invoiceNumber: null,
  amountMinor: Number(p.amount_cents ?? 0),
  currency: (p.currency ?? 'USD').trim() || 'USD',
  status: paymentName(p.status),
  journalId: null,
});
const docPayRow = (d: DocPayRow): PaymentRow => ({
  source: 'document_payment',
  id: d.id,
  at: d.created_at,
  customer: d.organizations?.name ?? '—',
  purpose: 'Service proforma',
  method: methodLabel(d.method),
  reference: d.reference,
  orderId: d.doc?.order_id ?? null,
  orderCode: null,
  documentId: d.document_id,
  documentNumber: d.doc?.number ?? null,
  invoiceId: d.invoice_id,
  invoiceNumber: d.inv?.number ?? null,
  amountMinor: Number(d.amount_cents ?? 0),
  currency: (d.currency ?? 'USD').trim() || 'USD',
  status: 'Paid',
  journalId: d.journal_id,
});

/** The order's invoice to link (tax invoice first, else the proforma). */
async function orderDocs(sb: Sb, orderIds: string[]): Promise<Map<string, { id: string; number: string }>> {
  const out = new Map<string, { id: string; number: string; type: string }>();
  if (!orderIds.length) return out;
  const { data } = await sb.from('documents').select('id, number, order_id, doc_type').in('order_id', orderIds).in('doc_type', ['commercial_invoice', 'proforma_invoice']).order('created_at', { ascending: false });
  for (const d of data ?? []) {
    const cur = out.get(d.order_id as string);
    if (!cur || (cur.type !== 'commercial_invoice' && d.doc_type === 'commercial_invoice')) out.set(d.order_id as string, { id: d.id as string, number: d.number as string, type: d.doc_type as string });
  }
  return out;
}

async function common(sb: Sb, q: ListQuery, textCols: string[]): Promise<{ steps: Step[]; empty: boolean }> {
  const steps: Step[] = [];
  if (q.f.customer) {
    const ids = await orgIdsByName(sb, q.f.customer);
    if (!ids.length) return { steps, empty: true };
    steps.push({ op: 'in', col: 'org_id', vals: ids });
  }
  const b = dateBounds(q.f.from, q.f.to);
  if (b.gte) steps.push({ op: 'gte', col: 'created_at', val: b.gte });
  if (b.lt) steps.push({ op: 'lt', col: 'created_at', val: b.lt });
  const t = safeSearch(q.q);
  if (t) {
    const ids = await orgIdsByName(sb, t);
    steps.push({ op: 'or', expr: [...textCols.map((c) => `${c}.ilike.*${t}*`), ...(ids.length ? [`org_id.in.(${ids.join(',')})`] : [])].join(',') });
  }
  return { steps, empty: false };
}

export async function loadPayments(q: ListQuery, nowMs: number): Promise<ListResult<PaymentRow>> {
  const sb = await createClient();
  const updatedAt = new Date(nowMs).toISOString();
  const seeds = await seedExclusion('payments');
  const c = await common(sb, q, ['reference']);
  if (c.empty) return { kind: 'ok', rows: [], total: 0, counts: { payments: 0, proformas: 0 }, updatedAt };
  const paySteps: Step[] = [...(seeds.step ? [seeds.step] : []), ...c.steps];
  if (q.f.status) paySteps.push({ op: 'in', col: 'status', vals: PAYMENT_DB[q.f.status as keyof typeof PAYMENT_DB] ?? [] });
  if (q.f.purpose) paySteps.push({ op: 'eq', col: 'purpose', val: q.f.purpose });
  // status / purpose are payments-only: proforma payments are always paid, purpose "service proforma"
  const docOff = (q.f.status && q.f.status !== 'paid') || (q.f.purpose && q.f.purpose !== 'service');
  const payQ = (cols: string, head = false) => applySteps(sb.from('payments').select(cols, { count: 'exact', head }), paySteps);
  const docQ = (cols: string, head = false) => applySteps(sb.from('document_payments').select(cols, { count: 'exact', head }), c.steps);
  const col = PAYMENTS_SPEC.sortable[q.sort.id] ?? 'created_at';
  const from = q.page * q.size;
  const [cp, cd] = await Promise.all([payQ('id', true), docOff ? Promise.resolve(null) : docQ('id', true)]);
  const counts: Partial<Record<string, number>> = {};
  if (!cp.error) counts.payments = cp.count ?? 0;
  if (!cd) counts.proformas = 0;
  else if (!cd.error) counts.proformas = cd.count ?? 0;
  if (q.tab === 'proformas') {
    if (docOff) return { kind: 'ok', rows: [], total: 0, counts, updatedAt };
    const r = await docQ(DOCPAY_COLS).order(col, { ascending: !q.sort.desc }).order('id').range(from, from + q.size - 1);
    if (r.error) return { kind: 'error', error: 'We couldn’t load the proforma payments.' };
    return { kind: 'ok', rows: ((r.data ?? []) as unknown as DocPayRow[]).map(docPayRow), total: r.count ?? 0, counts, updatedAt };
  }
  const r = await payQ(PAY_COLS).order(col, { ascending: !q.sort.desc }).order('id').range(from, from + q.size - 1);
  if (r.error) return { kind: 'error', error: 'We couldn’t load the payments.' };
  const rows = ((r.data ?? []) as unknown as PayRow[]).filter((p) => !seeds.drop.has(p.id));
  const docs = await orderDocs(sb, [...new Set(rows.map((p) => p.order_id).filter((x): x is string => !!x))]);
  return { kind: 'ok', rows: rows.map((p) => payRow(p, docs)), total: r.count ?? 0, counts, updatedAt, note: seeds.note };
}

export async function loadPaymentById(id: string): Promise<PaymentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sb = await createClient();
  const { data: p } = await sb.from('payments').select(PAY_COLS).eq('id', id).maybeSingle();
  if (p) {
    const x = p as unknown as PayRow;
    return payRow(x, await orderDocs(sb, x.order_id ? [x.order_id] : []));
  }
  const { data: d } = await sb.from('document_payments').select(DOCPAY_COLS).eq('id', id).maybeSingle();
  return d ? docPayRow(d as unknown as DocPayRow) : null;
}
