'use server';

import { revalidatePath } from 'next/cache';
import { toCents } from '@/lib/format';
import { requireFeesRatesDutyStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';

/** Release 1 · EA-1: fee versions (staff). Rate cards moved to /office/dropship/rates (design v2). Every rule is enforced again in the database. */
export type EaResult<T = undefined> = { ok: boolean; error?: string; code?: string; message?: string; data?: T };

function dbError(msg: string): EaResult<never> {
  const m = msg.match(/^([A-Z0-9_]+):?\s*(.*)$/);
  return m ? { ok: false, code: m[1], error: m[2] || msg } : { ok: false, error: msg };
}
const PATH = '/office/dropship/fees';
const money = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return /^\d+(\.\d{1,2})?$/.test(s) ? toCents(s) : null;
};
const intOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : /^\d+$/.test(s) ? Number(s) : NaN;
};

export async function proposeFeeVersionAction(fd: FormData): Promise<EaResult> {
  await requireFeesRatesDutyStaff(PATH);
  const first = money(fd.get('first'));
  const extra = money(fd.get('extra'));
  const packaging = money(fd.get('packaging') || '0');
  const storage = money(fd.get('storage') || '0');
  const brandedRaw = String(fd.get('branded') ?? '').trim();
  const branded = brandedRaw === '' ? null : money(brandedRaw);
  const tolG = intOrNull(fd.get('tol_g'));
  const tolPctRaw = String(fd.get('tol_pct') ?? '').trim();
  const tolPct = tolPctRaw === '' ? null : Number(tolPctRaw);
  const dispute = intOrNull(fd.get('dispute_days'));
  if (first == null || extra == null || packaging == null || storage == null || (brandedRaw !== '' && branded == null)) {
    return { ok: false, error: 'Enter fees in US$, e.g. 1.20.' };
  }
  if (Number.isNaN(tolG) || Number.isNaN(dispute) || (tolPct != null && (Number.isNaN(tolPct) || tolPct < 0 || tolPct > 100))) {
    return { ok: false, error: 'Tolerance: whole grams, 0–100 %, dispute window in whole days.' };
  }
  const sb = await createClient();
  const { error } = await sb.rpc('propose_fee_version', {
    p_pick_pack_first_cents: first,
    p_pick_pack_extra_cents: extra,
    p_packaging_cents: packaging,
    p_storage_per_cbm_day_cents: storage,
    p_return_handling_cents: money(fd.get('returns') || '0') ?? 0, // not on the board: carried over from the active version
    p_note: String(fd.get('note') ?? '').trim() || null,
    p_weigh_tolerance_g: tolG,
    p_weigh_tolerance_pct: tolPct,
    p_dispute_window_days: dispute,
    p_branded_packaging_cents: branded,
  });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Proposed. A second person must approve it before it is used.' };
}

export async function activateFeeVersionAction(id: string): Promise<EaResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('activate_fee_version', { p_fee_version_id: id, p_note: null });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Approved and active.' };
}

export async function rejectFeeVersionAction(id: string, reason: string): Promise<EaResult> {
  await requireFeesRatesDutyStaff(PATH);
  const sb = await createClient();
  const { error } = await sb.rpc('reject_fee_version', { p_fee_version_id: id, p_reason: reason });
  if (error) return dbError(error.message);
  revalidatePath(PATH);
  return { ok: true, message: 'Rejected.' };
}
