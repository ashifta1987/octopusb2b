import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Turnkey T5 — Production and QC inspections, read with the signed-in session. Clients read the customer-safe columns
 * (row-level security: their company's projects; reports, checklists and photos only once published, photos only when
 * staff left them visible). Staff read tk_staff_inspections (factory, inspector, fees with names, remarks); the
 * inspector reads tk_inspector_job for the inspections assigned to them. Photos open through short signed URLs from the
 * private bucket (storage policy "turnkey inspections read").
 */
export const TK_INSPECTIONS_BUCKET = 'turnkey-inspections';
const SIGNED_URL_SECONDS = 600;
const n = (v: unknown) => Number(v ?? 0);

export async function signInspectionPhotos(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const sb = await createClient();
  const { data } = await sb.storage.from(TK_INSPECTIONS_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  const out = new Map<string, string>();
  for (const x of data ?? []) if (x.path && x.signedUrl) out.set(x.path, x.signedUrl);
  return out;
}

/* ───────── client ───────── */
export type TkClientInspection = {
  id: string; kind: string; round: number; status: string; scheduled_on: string | null; phase_fee_id: string | null; published_at: string | null; created_at: string;
  fee: { id: string; amount_cents: number; currency: string; document: { id: string; number: string | null; status: string | null; paid_cents: number; amount_cents: number } | null } | null;
  report: { lot_size: number; sample_size: number; critical_defects: number; major_defects: number; minor_defects: number; result: string; client_summary: string | null; published_at: string | null } | null;
  items: { id: string; position: number; label: string; answer: string | null }[];
  photos: { id: string; url: string | null }[];
};

export async function getTkClientInspections(projectId: string): Promise<TkClientInspection[]> {
  const sb = await createClient();
  const { data: rows } = await sb.from('tk_inspections').select('id, kind, round, status, scheduled_on, phase_fee_id, published_at, created_at')
    .eq('project_id', projectId).order('kind').order('round');
  const ins = (rows ?? []) as Omit<TkClientInspection, 'fee' | 'report' | 'items' | 'photos'>[];
  if (!ins.length) return [];
  const ids = ins.map((i) => i.id);
  const [{ data: fees }, { data: reps }, { data: items }, { data: photos }] = await Promise.all([
    sb.from('tk_inspection_fees').select('id, inspection_id, amount_cents, currency, document_id').in('inspection_id', ids).eq('status', 'active'),
    sb.from('tk_inspection_reports').select('inspection_id, lot_size, sample_size, critical_defects, major_defects, minor_defects, result, client_summary, published_at').in('inspection_id', ids),
    sb.from('tk_inspection_items').select('id, inspection_id, position, label, answer').in('inspection_id', ids).order('position'),
    sb.from('tk_inspection_photos').select('id, inspection_id, file_path, created_at').in('inspection_id', ids).order('created_at'),
  ]);
  const F = (fees ?? []) as { id: string; inspection_id: string; amount_cents: number; currency: string; document_id: string | null }[];
  const docIds = F.map((f) => f.document_id).filter((x): x is string => !!x);
  const { data: docs } = docIds.length ? await sb.from('documents').select('id, number, status, paid_cents, amount_cents').in('id', docIds) : { data: [] };
  const D = new Map(((docs ?? []) as { id: string; number: string | null; status: string | null; paid_cents: number; amount_cents: number }[]).map((d) => [d.id, { ...d, paid_cents: n(d.paid_cents), amount_cents: n(d.amount_cents) }]));
  const P = (photos ?? []) as { id: string; inspection_id: string; file_path: string }[];
  const urls = await signInspectionPhotos(P.map((p) => p.file_path));
  const R = (reps ?? []) as (NonNullable<TkClientInspection['report']> & { inspection_id: string })[];
  const I = (items ?? []) as (TkClientInspection['items'][number] & { inspection_id: string })[];
  return ins.map((i) => {
    const f = F.find((x) => x.inspection_id === i.id);
    const r = R.find((x) => x.inspection_id === i.id);
    return {
      ...i,
      fee: f ? { id: f.id, amount_cents: n(f.amount_cents), currency: f.currency, document: f.document_id ? D.get(f.document_id) ?? null : null } : null,
      report: r ? { lot_size: n(r.lot_size), sample_size: n(r.sample_size), critical_defects: n(r.critical_defects), major_defects: n(r.major_defects), minor_defects: n(r.minor_defects),
        result: r.result, client_summary: r.client_summary, published_at: r.published_at } : null,
      items: I.filter((x) => x.inspection_id === i.id).map((x) => ({ id: x.id, position: x.position, label: x.label, answer: x.answer })),
      photos: P.filter((x) => x.inspection_id === i.id).map((x) => ({ id: x.id, url: urls.get(x.file_path) ?? null })),
    };
  });
}

/* ───────── staff (tk_staff_inspections: staff who can view the project) ───────── */
export type TkStaffInspectionFee = {
  id: string; version: number; service_code: string; amount_cents: number; starting_cents: number | null; needs_approval: boolean; status: string; note: string | null;
  proposed_by: string; proposed_by_name: string | null; proposed_at: string; approved_by_name: string | null; approved_at: string | null; rejected_by_name: string | null;
  rejected_at: string | null; reject_reason: string | null; withdrawn_at: string | null; document_id: string | null; document_number: string | null;
  document_status: string | null; paid_cents: number | null; paid: boolean;
};
export type TkStaffInspection = {
  id: string; kind: string; round: number; status: string; scheduled_on: string | null; factory_name: string; factory_address: string | null; brief: string | null;
  created_at: string; created_by_name: string | null; inspector_id: string | null; inspector_name: string | null; scheduled_at: string | null; started_at: string | null;
  submitted_at: string | null; returned_reason: string | null; published_at: string | null; published_by_name: string | null; cancelled_at: string | null;
  cancel_reason: string | null; override_at: string | null; override_reason: string | null; override_by_name: string | null; paid: boolean;
  phase_fee: { id: string; amount_cents: number; status: string; document_number: string | null; paid: boolean } | null;
  fees: TkStaffInspectionFee[];
  items: { id: string; position: number; label: string; answer: string | null; remark: string | null }[];
  photos: { id: string; item_id: string | null; file_path: string; mime_type: string; size_bytes: number; client_visible: boolean; created_at: string; url?: string | null }[];
  report: { lot_size: number; sample_size: number; critical_defects: number; major_defects: number; minor_defects: number; result: string; remarks: string | null;
    signed_name: string; submitted_at: string; client_summary: string | null; published_at: string | null } | null;
};
export type TkStaffQc = { inspections: TkStaffInspection[]; inspectors: { user_id: string; full_name: string }[]; phase_fee_available: string | null };

export async function getTkStaffInspections(projectId: string): Promise<TkStaffQc | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_staff_inspections', { p_project: projectId });
  if (error || !data) return null;
  const d = data as TkStaffQc;
  const urls = await signInspectionPhotos(d.inspections.flatMap((i) => i.photos.map((p) => p.file_path)));
  return {
    ...d,
    inspections: d.inspections.map((i) => ({
      ...i,
      fees: i.fees.map((f) => ({ ...f, amount_cents: n(f.amount_cents), starting_cents: f.starting_cents == null ? null : n(f.starting_cents), paid_cents: f.paid_cents == null ? null : n(f.paid_cents) })),
      photos: i.photos.map((p) => ({ ...p, url: urls.get(p.file_path) ?? null })),
    })),
  };
}

/* ───────── inspector (assigned only) ───────── */
export type TkInspectorJobListItem = { id: string; kind: string; round: number; status: string; scheduled_on: string | null; project_code: string; project_title: string; factory_name: string; factory_address: string | null };
export type TkInspectorJob = {
  id: string; project_id: string; project_code: string; project_title: string; project_open: boolean; kind: string; round: number; status: string;
  scheduled_on: string | null; factory_name: string; factory_address: string | null; brief: string | null; returned_reason: string | null; paid: boolean;
  items: { id: string; position: number; label: string; answer: string | null; remark: string | null }[];
  photos: { id: string; item_id: string | null; file_path: string; created_at: string; url?: string | null }[];
  report: { submission_id: string; lot_size: number; sample_size: number; critical_defects: number; major_defects: number; minor_defects: number; result: string;
    remarks: string | null; signed_name: string; submitted_at: string } | null;
};

export async function getMyInspections(): Promise<TkInspectorJobListItem[]> {
  const sb = await createClient();
  const { data } = await sb.rpc('tk_my_inspections');
  return (data ?? []) as TkInspectorJobListItem[];
}

export async function getInspectorJob(id: string): Promise<TkInspectorJob | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_inspector_job', { p_inspection: id });
  if (error || !data) return null;
  const j = data as TkInspectorJob;
  const urls = await signInspectionPhotos(j.photos.map((p) => p.file_path));
  return { ...j, photos: j.photos.map((p) => ({ ...p, url: urls.get(p.file_path) ?? null })) };
}
