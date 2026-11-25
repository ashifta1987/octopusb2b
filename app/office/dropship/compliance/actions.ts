'use server';

import { revalidatePath } from 'next/cache';
import { toCents } from '@/lib/format';
import { requireFeesRatesDutyStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';

/** Release 1 · EA-1: duty and tax versions (staff). Two-person publish and "unknown stays empty" are enforced in the DB. */
export type DutyResult = { ok: boolean; error?: string; code?: string; message?: string; id?: string };
const PATH = '/office/dropship/compliance';

function dbError(msg: string): DutyResult {
  const m = msg.match(/^([A-Z0-9_]+):?\s*(.*)$/);
  return m ? { ok: false, code: m[1], error: m[2] || msg } : { ok: false, error: msg };
}
/** "5" or "5.25" (%) → basis points; empty → null (unknown, never 0). */
const pctToBp = (v: FormDataEntryValue | null): number | null | 'bad' => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) <= 1000 ? Math.round(Number(s) * 100) : 'bad';
};

export async function createDutyDraftAction(copyFromId: string | null): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  let entries: unknown[] = [];
  if (copyFromId) {
    const { data, error } = await sb
      .from('duty_rate_entries')
      .select('country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to, source')
      .eq('version_id', copyFromId);
    if (error) return dbError(error.message);
    // copied entries must be checked again before they can be published
    entries = (data ?? []).map((e) => ({ ...e, status: 'verify' }));
  }
  const { data, error } = await sb.rpc('create_duty_rate_version', {
    p_note: copyFromId ? 'Copied from the active version' : 'New draft',
    p_entries: entries,
  });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, id: data as string, message: 'Draft created.' };
}

export async function saveDutyEntryAction(fd: FormData): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const duty = pctToBp(fd.get('duty_pct'));
  const tax = pctToBp(fd.get('tax_pct'));
  if (duty === 'bad' || tax === 'bad') return { ok: false, error: 'Enter percentages like 5 or 5.25 (leave empty if unknown).' };
  const dm = String(fd.get('de_minimis') ?? '').trim();
  if (dm !== '' && !/^\d+(\.\d{1,2})?$/.test(dm)) return { ok: false, error: 'De minimis must be an amount in US$, e.g. 270.00.' };
  const sb = await createClient();
  const { error } = await sb.rpc('upsert_duty_rate_entry', {
    p_version_id: String(fd.get('version_id') ?? ''),
    p_country: String(fd.get('country') ?? ''),
    p_hs_prefix: String(fd.get('hs_prefix') ?? '').trim() || null,
    p_duty_bp: duty,
    p_tax_bp: tax,
    p_de_minimis_cents: dm === '' ? 0 : toCents(dm),
    p_applies_to: String(fd.get('applies_to') ?? 'duty'),
    p_source: String(fd.get('source') ?? '').trim() || null,
    p_status: String(fd.get('status') ?? 'needs_data'),
  });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Entry saved.' };
}

export async function deleteDutyEntryAction(id: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('delete_duty_rate_entry', { p_entry_id: id });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Entry removed.' };
}

export async function submitDutyVersionAction(id: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('submit_duty_rate_version', { p_version_id: id });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Submitted. A second person can now publish it.' };
}

export async function publishDutyVersionAction(id: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('activate_duty_rate_version', { p_version_id: id });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Published. Quotes now use this version.' };
}

/** design v2: a second person confirms an entry they did not enter (same data, status confirmed). */
export async function confirmDutyEntryAction(entryId: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { data: e, error: readErr } = await sb
    .from('duty_rate_entries')
    .select('version_id, country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to, source')
    .eq('id', entryId)
    .maybeSingle();
  if (readErr) return dbError(readErr.message);
  if (!e) return { ok: false, error: 'Entry not found.' };
  const { error } = await sb.rpc('upsert_duty_rate_entry', {
    p_version_id: e.version_id,
    p_country: e.country,
    p_hs_prefix: e.hs_prefix,
    p_duty_bp: e.duty_bp,
    p_tax_bp: e.tax_bp,
    p_de_minimis_cents: Number(e.de_minimis_cents),
    p_applies_to: e.de_minimis_applies_to,
    p_source: e.source,
    p_status: 'confirmed',
  });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Entry confirmed.' };
}

export async function rejectDutyVersionAction(id: string, reason: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  if (!reason.trim()) return { ok: false, error: 'Enter why the version is sent back.' };
  const sb = await createClient();
  const { error } = await sb.rpc('reject_duty_rate_version', { p_version_id: id, p_reason: reason.trim() });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Sent back to draft.' };
}

export async function proposeCustomsPolicyAction(fd: FormData): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const raw = String(fd.get('block_below_pct') ?? '').trim();
  const pct = raw === '' ? null : Number(raw);
  if (pct != null && (!/^\d+(\.\d{1,2})?$/.test(raw) || pct <= 0 || pct > 100)) {
    return { ok: false, error: 'Block threshold: a percentage above 0 and up to 100, or leave it empty.' };
  }
  const sb = await createClient();
  const { error } = await sb.rpc('propose_customs_policy', {
    p_block_below_pct: pct,
    p_shipping_rule: String(fd.get('shipping_rule') ?? 'follow_destination'),
    p_note: String(fd.get('note') ?? '').trim() || null,
  });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Proposed. A second person must approve it.' };
}

export async function approveCustomsPolicyAction(id: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('approve_customs_policy', { p_id: id });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Customs value policy approved.' };
}

export async function rejectCustomsPolicyAction(id: string, reason: string): Promise<DutyResult> {
  await requireFeesRatesDutyStaff(PATH);
  if (!reason.trim()) return { ok: false, error: 'Enter why this is rejected.' };
  const sb = await createClient();
  const { error } = await sb.rpc('reject_customs_policy', { p_id: id, p_reason: reason.trim() });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Rejected.' };
}
