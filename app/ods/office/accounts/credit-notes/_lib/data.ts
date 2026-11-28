import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { applySteps, orgIdsByName, profileNames, type Sb, type Step } from '../../_shared/accounts-server';
import { APPROVAL_DB, CREDIT_SPEC, approvalName, creditNoteName, dateBounds, requestNumber, safeSearch, type CreditNoteRow, type CreditRequestRow, type CreditRow, type ListQuery, type ListResult } from '../../_shared/accounts-core';

/**
 * Credit notes — today's data, read-only: issued credit notes = documents (doc_type credit_note, created by
 * decide_finance_approval / the DS10 refund flow); requests = finance_approvals kind credit_note (requested → Waiting,
 * approved / executed → Approved, rejected → Rejected). Deciding stays on Admin › Finance (and the Approvals screen).
 */
const DOC_COLS: string = 'id, number, org_id, order_id, original_document_id, amount_cents, currency, status, created_at, data, organizations(name), orders(code), orig:documents!original_document_id(number)';
const REQ_COLS: string = 'id, org_id, order_id, amount_cents, currency, reason, status, requested_by, approved_by, decided_at, executed_journal_id, created_at, organizations(name), orders(code)';

type DocRow = { id: string; number: string; order_id: string | null; original_document_id: string | null; amount_cents: number | null; currency: string | null; status: string | null; created_at: string; data: { reason?: string } | null; organizations: { name?: string } | null; orders: { code?: string } | null; orig: { number?: string } | null };
type ReqRow = { id: string; order_id: string | null; amount_cents: number | null; currency: string | null; reason: string | null; status: string | null; requested_by: string | null; approved_by: string | null; decided_at: string | null; executed_journal_id: string | null; created_at: string; organizations: { name?: string } | null; orders: { code?: string } | null };

const docRow = (d: DocRow): CreditNoteRow => ({
  kind: 'document',
  id: d.id,
  number: d.number,
  customer: d.organizations?.name ?? 'Customer',
  originalId: d.original_document_id,
  originalNumber: d.orig?.number ?? null,
  orderId: d.order_id,
  orderCode: d.orders?.code ?? null,
  issuedAt: d.created_at,
  amountMinor: -Math.abs(Number(d.amount_cents ?? 0)),
  currency: (d.currency ?? 'USD').trim() || 'USD',
  status: creditNoteName(d.status),
  reason: d.data?.reason ?? null,
});
const reqRow = (r: ReqRow, names: Map<string, string>): CreditRequestRow => ({
  kind: 'request',
  id: r.id,
  number: requestNumber(r.id),
  customer: r.organizations?.name ?? '—',
  orderId: r.order_id,
  orderCode: r.orders?.code ?? null,
  requestedAt: r.created_at,
  decidedAt: r.decided_at,
  amountMinor: -Math.abs(Number(r.amount_cents ?? 0)),
  currency: (r.currency ?? 'USD').trim() || 'USD',
  status: approvalName(r.status),
  reason: r.reason ?? '',
  requestedBy: r.requested_by ? (names.get(r.requested_by) || null) : null,
  approvedBy: r.approved_by ? (names.get(r.approved_by) || null) : null,
  journalId: r.executed_journal_id,
});

async function shared(sb: Sb, q: ListQuery, textCol: 'number' | 'reason'): Promise<{ steps: Step[]; empty: boolean }> {
  const steps: Step[] = [];
  const t = safeSearch(q.q);
  if (t) {
    const ids = await orgIdsByName(sb, t);
    steps.push({ op: 'or', expr: [`${textCol}.ilike.*${t}*`, ...(ids.length ? [`org_id.in.(${ids.join(',')})`] : [])].join(',') });
  }
  if (q.f.customer) {
    const ids = await orgIdsByName(sb, q.f.customer);
    if (!ids.length) return { steps, empty: true };
    steps.push({ op: 'in', col: 'org_id', vals: ids });
  }
  const b = dateBounds(q.f.from, q.f.to);
  if (b.gte) steps.push({ op: 'gte', col: 'created_at', val: b.gte });
  if (b.lt) steps.push({ op: 'lt', col: 'created_at', val: b.lt });
  return { steps, empty: false };
}

export async function loadCreditNotes(q: ListQuery, nowMs: number): Promise<ListResult<CreditRow>> {
  const sb = await createClient();
  const updatedAt = new Date(nowMs).toISOString();
  const [docF, reqF] = await Promise.all([shared(sb, q, 'number'), shared(sb, q, 'reason')]);
  const docBase = (cols: string, head = false) => applySteps(sb.from('documents').select(cols, { count: 'exact', head }).eq('doc_type', 'credit_note'), docF.steps);
  const reqBase = (cols: string, tab: keyof typeof APPROVAL_DB, head = false) => applySteps(sb.from('finance_approvals').select(cols, { count: 'exact', head }).eq('kind', 'credit_note').in('status', APPROVAL_DB[tab]), reqF.steps);
  const counts: Partial<Record<string, number>> = {};
  const [c1, c2, c3, c4] = await Promise.all([
    docF.empty ? null : docBase('id', true),
    reqF.empty ? null : reqBase('id', 'waiting', true),
    reqF.empty ? null : reqBase('id', 'approved', true),
    reqF.empty ? null : reqBase('id', 'rejected', true),
  ]);
  (['issued', 'waiting', 'approved', 'rejected'] as const).forEach((t, i) => {
    const c = [c1, c2, c3, c4][i];
    if (!c) counts[t] = 0;
    else if (!c.error) counts[t] = c.count ?? 0;
  });
  const from = q.page * q.size;
  if (q.tab === 'issued') {
    if (docF.empty) return { kind: 'ok', rows: [], total: 0, counts, updatedAt };
    const col = CREDIT_SPEC.sortable[q.sort.id] ?? 'created_at';
    const r = await docBase(DOC_COLS).order(col, { ascending: !q.sort.desc }).order('id').range(from, from + q.size - 1);
    if (r.error) return { kind: 'error', error: 'We couldn’t load the credit notes.' };
    return { kind: 'ok', rows: ((r.data ?? []) as unknown as DocRow[]).map(docRow), total: r.count ?? 0, counts, updatedAt };
  }
  if (reqF.empty) return { kind: 'ok', rows: [], total: 0, counts, updatedAt };
  const col = q.sort.id === 'amount' ? 'amount_cents' : 'created_at';
  const r = await reqBase(REQ_COLS, q.tab as keyof typeof APPROVAL_DB).order(col, { ascending: !q.sort.desc }).order('id').range(from, from + q.size - 1);
  if (r.error) return { kind: 'error', error: 'We couldn’t load the credit note requests.' };
  const rows = (r.data ?? []) as unknown as ReqRow[];
  const names = await profileNames(sb, rows.flatMap((x) => [x.requested_by, x.approved_by]));
  return { kind: 'ok', rows: rows.map((x) => reqRow(x, names)), total: r.count ?? 0, counts, updatedAt };
}

/** Drawer from ?open= when the record is not on this page. */
export async function loadCreditById(id: string): Promise<CreditRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sb = await createClient();
  const { data: d } = await sb.from('documents').select(DOC_COLS).eq('id', id).eq('doc_type', 'credit_note').maybeSingle();
  if (d) return docRow(d as unknown as DocRow);
  const { data: r } = await sb.from('finance_approvals').select(REQ_COLS).eq('id', id).eq('kind', 'credit_note').maybeSingle();
  if (!r) return null;
  const x = r as unknown as ReqRow;
  return reqRow(x, await profileNames(sb, [x.requested_by, x.approved_by]));
}
