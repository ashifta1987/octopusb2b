import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Turnkey T4 — layout drawings and quotes, read with the signed-in session (row-level security decides: the project's
 * company, or staff who can view the project). Client reads use the customer-safe columns only; staff facts (uploader,
 * waiver, supplier, cost, margin) come from the staff functions tk_staff_drawings / tk_staff_quotes.
 */
export const TK_DRAWINGS_BUCKET = 'turnkey-drawings';
const SIGNED_URL_SECONDS = 600;

export type TkDrawingVersion = {
  id: string; version: number; file_path: string; file_name: string; mime_type: string; size_bytes: number; message: string | null;
  status: 'shared' | 'approved' | 'changes_requested'; shared_at: string; decided_at: string | null; url: string | null;
};
export type TkDrawingComment = { id: number; version_id: string; from_staff: boolean; kind: 'comment' | 'changes' | 'approval'; body: string; created_at: string; author_name?: string | null };
export type TkDocState = { id: string; number: string | null; status: string | null; paid_cents: number; amount_cents: number };
export type TkExtraFee = {
  id: string; for_version: number; base_cents: number; amount_cents: number; status: 'open' | 'waived'; document_id: string; created_at: string;
  document: TkDocState | null;
};

const n = (v: unknown) => Number(v ?? 0);

async function docs(ids: string[]): Promise<Map<string, TkDocState>> {
  if (!ids.length) return new Map();
  const sb = await createClient();
  const { data } = await sb.from('documents').select('id, number, status, paid_cents, amount_cents').in('id', ids);
  return new Map(((data ?? []) as TkDocState[]).map((d) => [d.id, { ...d, paid_cents: n(d.paid_cents), amount_cents: n(d.amount_cents) }]));
}

/** Short-lived signed links for drawing files the caller may read (storage policy "turnkey drawings read"). */
export async function signDrawingUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const sb = await createClient();
  const { data } = await sb.storage.from(TK_DRAWINGS_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  const out = new Map<string, string>();
  for (const x of data ?? []) if (x.path && x.signedUrl) out.set(x.path, x.signedUrl);
  return out;
}

/** Client view: versions (newest first) with signed links, comments, extra version charges with their proformas. */
export async function getTkClientDrawings(projectId: string) {
  const sb = await createClient();
  const [{ data: v }, { data: c }, { data: x }] = await Promise.all([
    sb.from('tk_drawing_versions').select('id, version, file_path, file_name, mime_type, size_bytes, message, status, shared_at, decided_at').eq('project_id', projectId).order('version', { ascending: false }),
    sb.from('tk_drawing_comments').select('id, version_id, from_staff, kind, body, created_at').eq('project_id', projectId).order('created_at').order('id'),
    sb.from('tk_drawing_extra_fees').select('id, for_version, base_cents, amount_cents, status, document_id, created_at').eq('project_id', projectId).order('for_version'),
  ]);
  const rows = (v ?? []) as Omit<TkDrawingVersion, 'url'>[];
  const extras = (x ?? []) as Omit<TkExtraFee, 'document'>[];
  const [urls, dm] = await Promise.all([signDrawingUrls(rows.map((r) => r.file_path)), docs(extras.map((e) => e.document_id))]);
  return {
    versions: rows.map((r) => ({ ...r, size_bytes: n(r.size_bytes), url: urls.get(r.file_path) ?? null })) as TkDrawingVersion[],
    comments: (c ?? []) as TkDrawingComment[],
    extras: extras.map((e) => ({ ...e, base_cents: n(e.base_cents), amount_cents: n(e.amount_cents), document: dm.get(e.document_id) ?? null })) as TkExtraFee[],
  };
}

export type TkClientQuote = {
  id: string; version: number; status: string; currency: string; total_cents: number; deposit_pct: number | null; deposit_cents: number | null;
  message: string | null; client_comment: string | null; valid_until: string | null; document_id: string | null; sent_at: string | null; decided_at: string | null;
  lines: { id: string; line_no: number; description: string; qty: number; unit_price_cents: number; total_cents: number }[];
  document: TkDocState | null;
};

/** Client view of the quotes (sent versions only — drafts are hidden by RLS): lines and the deposit proforma. */
export async function getTkClientQuotes(projectId: string): Promise<TkClientQuote[]> {
  const sb = await createClient();
  const { data } = await sb.from('tk_client_quotes')
    .select('id, version, status, currency, total_cents, deposit_pct, deposit_cents, message, client_comment, valid_until, document_id, sent_at, decided_at')
    .eq('project_id', projectId).neq('status', 'draft').order('version', { ascending: false });
  const qs = (data ?? []) as Omit<TkClientQuote, 'lines' | 'document'>[];
  if (!qs.length) return [];
  const [{ data: lines }, dm] = await Promise.all([
    sb.from('tk_client_quote_lines').select('id, quote_id, line_no, description, qty, unit_price_cents, total_cents').in('quote_id', qs.map((q) => q.id)).order('line_no'),
    docs(qs.map((q) => q.document_id).filter((x): x is string => !!x)),
  ]);
  const L = (lines ?? []) as (TkClientQuote['lines'][number] & { quote_id: string })[];
  return qs.map((q) => ({
    ...q,
    total_cents: n(q.total_cents),
    deposit_cents: q.deposit_cents == null ? null : n(q.deposit_cents),
    lines: L.filter((l) => l.quote_id === q.id).map((l) => ({ id: l.id, line_no: l.line_no, description: l.description, qty: n(l.qty), unit_price_cents: n(l.unit_price_cents), total_cents: n(l.total_cents) })),
    document: q.document_id ? dm.get(q.document_id) ?? null : null,
  }));
}

/* ───────── staff (tk_staff_drawings / tk_staff_quotes: staff who can view the project) ───────── */
export type TkStaffDrawings = {
  versions: (Omit<TkDrawingVersion, 'url'> & { uploaded_by_name: string | null })[];
  comments: (TkDrawingComment & { author_name: string | null })[];
  extras: { id: string; for_version: number; base_cents: number; amount_cents: number; status: 'open' | 'waived'; document_id: string; document_number: string | null;
    document_status: string | null; paid_cents: number | null; paid: boolean; waived_by_name: string | null; waived_at: string | null; waive_reason: string | null; created_at: string }[];
};
export type TkStaffQuoteLine = {
  id: string; line_no: number; description: string; qty: number; unit_price_cents: number; total_cents: number;
  unit_cost_cents: number | null; cost_cents: number | null; factory_line_id: string | null; supplier_name: string | null;
};
export type TkStaffQuote = {
  id: string; version: number; status: string; total_cents: number; deposit_pct: number | null; deposit_cents: number | null; message: string | null;
  client_comment: string | null; valid_until: string | null; sent_at: string | null; decided_at: string | null; created_at: string; updated_at: string;
  created_by_name: string | null; sent_by_name: string | null; document_id: string | null; document_number: string | null; document_status: string | null;
  paid_cents: number | null; deposit_paid: boolean; cost_cents: number | null; cost_complete: boolean; lines: TkStaffQuoteLine[];
};
export type TkFactoryQuote = {
  id: string; supplier_name: string; supplier_ref: string | null; valid_until: string | null; notes: string | null; total_cost_cents: number; created_at: string;
  created_by_name: string | null; lines: { id: string; line_no: number; description: string; qty: number; unit_cost_cents: number; total_cost_cents: number }[];
};
export type TkStaffQuotes = { deposit_pct: number | null; quotes: TkStaffQuote[]; factory_quotes: TkFactoryQuote[] };

export async function getTkStaffDrawings(projectId: string): Promise<{ data: TkStaffDrawings; urls: Map<string, string> } | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_staff_drawings', { p_project: projectId });
  if (error || !data) return null;
  const d = data as TkStaffDrawings;
  return { data: d, urls: await signDrawingUrls(d.versions.map((v) => v.file_path)) };
}

export async function getTkStaffQuotes(projectId: string): Promise<TkStaffQuotes | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_staff_quotes', { p_project: projectId });
  if (error || !data) return null;
  return data as TkStaffQuotes;
}
