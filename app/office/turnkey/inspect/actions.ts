'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Turnkey T5 — the inspector's phone screen. Every call goes through a tk_* database function that checks again that
 * the signed-in staff member (2FA) is the inspector assigned to this inspection, that it is paid and open. Photos are
 * uploaded by the phone straight to the private bucket (turnkey-inspections/<project>/<inspection>/<photo id>.<ext>)
 * and registered here; a refused registration removes the file again (orphan policy).
 */
type Result = { ok: boolean; message?: string; error?: string; stale?: boolean };
const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());
const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const pathOf = (id: string) => `/office/turnkey/inspect/${id}`;

export async function startInspectionAction(inspectionId: string): Promise<Result> {
  if (!isUuid(inspectionId)) return { ok: false, error: 'Reload the page.' };
  await requireStaff('turnkey_qc', 'edit', pathOf(inspectionId));
  const sb = await createClient();
  const { error } = await sb.rpc('tk_start_inspection', { p_inspection: inspectionId });
  if (error) return { ok: false, error: /NOT_FOUND/.test(error.message) ? 'This inspection is not assigned to you.' : clean(error.message) };
  revalidatePath(pathOf(inspectionId));
  revalidatePath('/office/turnkey/inspect');
  return { ok: true };
}

export async function registerInspectionPhotoAction(photoId: string, inspectionId: string, path: string, itemId: string | null): Promise<Result> {
  if (!isUuid(photoId) || !isUuid(inspectionId) || (itemId != null && !isUuid(itemId)) || !path.includes(`/${inspectionId}/${photoId}.`)) return { ok: false, error: 'Take the photo again.' };
  await requireStaff('turnkey_qc', 'edit', pathOf(inspectionId));
  const sb = await createClient();
  const { error } = await sb.rpc('tk_add_inspection_photo', { p_photo: photoId, p_inspection: inspectionId, p_path: path, p_item: itemId });
  if (error) {
    await sb.storage.from('turnkey-inspections').remove([path]);
    return { ok: false, error: clean(error.message) };
  }
  revalidatePath(pathOf(inspectionId));
  return { ok: true };
}

export async function removeInspectionPhotoAction(photoId: string, inspectionId: string): Promise<Result> {
  if (!isUuid(photoId) || !isUuid(inspectionId)) return { ok: false, error: 'Reload the page.' };
  await requireStaff('turnkey_qc', 'edit', pathOf(inspectionId));
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_remove_inspection_photo', { p_photo: photoId });
  if (error) return { ok: false, error: clean(error.message) };
  if (typeof data === 'string' && data) await sb.storage.from('turnkey-inspections').remove([data]);
  revalidatePath(pathOf(inspectionId));
  return { ok: true };
}

export type InspectionReportInput = {
  lot_size: number; sample_size: number; critical_defects: number; major_defects: number; minor_defects: number; result: string; remarks: string | null; signed_name: string;
  answers: { item_id: string; answer: string; remark: string | null }[];
};

/** One call with the whole report; the submission id comes from the phone, so a retry is accepted once. */
export async function submitInspectionAction(inspectionId: string, submissionId: string, report: InspectionReportInput): Promise<Result> {
  if (!isUuid(inspectionId) || !isUuid(submissionId)) return { ok: false, error: 'Reload the page.' };
  await requireStaff('turnkey_qc', 'edit', pathOf(inspectionId));
  const ints = [report.lot_size, report.sample_size, report.critical_defects, report.major_defects, report.minor_defects];
  if (ints.some((x) => !Number.isInteger(x) || x < 0)) return { ok: false, error: 'Use whole numbers for the lot, the sample and the defects.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_submit_inspection', { p_inspection: inspectionId, p_submission: submissionId, p_report: report });
  if (error) return { ok: false, error: clean(error.message), stale: /STALE_SUBMISSION|ALREADY_SUBMITTED/.test(error.message) };
  revalidatePath(pathOf(inspectionId));
  revalidatePath('/office/turnkey/inspect');
  return { ok: true, message: (data as { duplicate?: boolean }).duplicate ? 'This report was already sent. Nothing changed.' : 'Report submitted. The team reviews it and publishes it to the client.' };
}
