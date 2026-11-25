'use server';

import { revalidatePath } from 'next/cache';
import { requireFeesRatesDutyStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';

const PATH = '/office/dropship/rates';

export type RatesResult<T = undefined> = { ok: boolean; data?: T; message?: string; error?: string };

export type RateRow = Record<string, string | number | boolean | null>;
export type PreviewRow = {
  row_no: number; rate_key: string; action: 'new' | 'changed' | 'unchanged' | 'invalid'; reason: string | null;
  current_version: number | null; changes: Record<string, { from: unknown; to: unknown }>; normalized: RateRow;
};
export type ErrorRow = { row_no: number; reason: string; raw: Record<string, string> };

/** Database errors carry a CODE: message. Show the message part (it is written for staff). */
function dbError(message: string): RatesResult<never> {
  const m = message.replace(/^[A-Z_]+:\s*/, '');
  if (/permission denied|FORBIDDEN/.test(message)) return { ok: false, error: 'You don’t have permission to do this.' };
  return { ok: false, error: m.charAt(0).toUpperCase() + m.slice(1) };
}

async function guardEdit(): Promise<RatesResult<never> | null> {
  const access = await requireFeesRatesDutyStaff(PATH);
  if (!access.canEditRates) return { ok: false, error: 'You can view rate cards but not change them.' };
  return null;
}

export async function previewRatesAction(rows: RateRow[]): Promise<RatesResult<PreviewRow[]>> {
  const denied = await guardEdit();
  if (denied) return denied;
  if (rows.length === 0) return { ok: false, error: 'There are no rows to check.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('preview_shipping_rate_card_import', { p_rows: rows });
  if (error) return dbError(error.message);
  return { ok: true, data: (data ?? []) as PreviewRow[] };
}

export async function saveRateImportAction(input: {
  id?: string | null;
  source: 'csv' | 'manual';
  fileName: string | null;
  columnMap: Record<string, string>;
  rows: RateRow[];
  errors: ErrorRow[];
  replaceKeys: string[];
  rowsInFile: number;
  note?: string | null;
  submit: boolean;
}): Promise<RatesResult<{ id: string; status: string }>> {
  const denied = await guardEdit();
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc('save_rate_card_import', {
    p_id: input.id ?? null,
    p_source: input.source,
    p_file_name: input.fileName,
    p_column_map: input.columnMap,
    p_rows: input.rows,
    p_errors: input.errors,
    p_replace_keys: input.replaceKeys,
    p_rows_in_file: input.rowsInFile,
    p_note: input.note ?? null,
    p_submit: input.submit,
  });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  const d = data as { id: string; status: string };
  return {
    ok: true,
    data: d,
    message: input.submit ? 'Sent for approval. A second person must approve it before any card changes.' : 'Saved as a draft. Nothing has changed yet.',
  };
}

export async function approveRateImportAction(id: string): Promise<RatesResult> {
  const denied = await guardEdit();
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc('approve_rate_card_import', { p_id: id });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  const d = data as { new: number; replaced: number; unchanged: number };
  return { ok: true, message: `Approved and published: ${d.new} new, ${d.replaced} replaced, ${d.unchanged} unchanged.` };
}

export async function rejectRateImportAction(id: string, reason: string): Promise<RatesResult> {
  const denied = await guardEdit();
  if (denied) return denied;
  if (!reason.trim()) return { ok: false, error: 'Enter why this is rejected.' };
  const sb = await createClient();
  const { error } = await sb.rpc('reject_rate_card_import', { p_id: id, p_reason: reason.trim() });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Rejected. Nothing changed.' };
}

export async function deleteRateDraftAction(id: string): Promise<RatesResult> {
  const denied = await guardEdit();
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc('delete_rate_card_import', { p_id: id });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Draft deleted.' };
}

export async function deactivateRateCardAction(id: string, reason: string): Promise<RatesResult> {
  const denied = await guardEdit();
  if (denied) return denied;
  if (!reason.trim()) return { ok: false, error: 'Enter why this rate card is deactivated.' };
  const sb = await createClient();
  const { error } = await sb.rpc('deactivate_shipping_rate_card', { p_rate_card_id: id, p_reason: reason.trim() });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Deactivated. Quotes no longer use this card.' };
}

export type TestQuoteRow = {
  rate_card_id: string; carrier_code: string; carrier_name: string | null; carrier_service_code: string; method: string;
  version: number; volumetric_divisor: number; box_weight_g: number | null; billed_weight_g: number; max_weight_g: number;
  over_max: boolean; price_cents: number; fuel_surcharge_bp: number; remote_area_fee_may_apply: boolean;
  days_min: number; days_max: number;
};

export async function testQuoteAction(input: {
  country: string; method: string; weightG: number; l: number | null; w: number | null; h: number | null;
}): Promise<RatesResult<TestQuoteRow[]>> {
  const access = await requireFeesRatesDutyStaff(PATH);
  if (!access.canReadRates) return { ok: false, error: 'You don’t have access to rate cards.' };
  if (!Number.isInteger(input.weightG) || input.weightG <= 0) return { ok: false, error: 'Actual weight: enter grams above 0.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('test_rate_card_quote', {
    p_country: input.country,
    p_method: input.method,
    p_weight_g: input.weightG,
    p_length_cm: input.l,
    p_width_cm: input.w,
    p_height_cm: input.h,
  });
  if (error) return dbError(error.message);
  return {
    ok: true,
    data: ((data ?? []) as TestQuoteRow[]).map((r) => ({ ...r, price_cents: Number(r.price_cents), volumetric_divisor: Number(r.volumetric_divisor) })),
  };
}
