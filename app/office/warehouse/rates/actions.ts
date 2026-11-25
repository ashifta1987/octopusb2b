'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/format';

type R = { ok: boolean; message?: string; error?: string };
const clean = (m: string): R => ({ ok: false, error: m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase()) });
const cents = (v: FormDataEntryValue | null): number | null | 'bad' => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? toCents(s) : 'bad';
};

export async function proposeRatesAction(fd: FormData): Promise<R> {
  await requireWarehouseStaff('/office/warehouse/rates');
  const keys = ['receiving', 'storage_pallet', 'storage_cbm', 'pick_first', 'pick_extra', 'returns', 'min_monthly'] as const;
  const v = Object.fromEntries(keys.map((k) => [k, cents(fd.get(k))])) as Record<(typeof keys)[number], number | null | 'bad'>;
  if (Object.values(v).includes('bad')) return { ok: false, error: 'Enter fees in US$, e.g. 1.20 (leave empty if not set).' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_propose_rates', {
    p_plan: String(fd.get('plan') ?? ''), p_warehouse: String(fd.get('warehouse') ?? '') || null,
    p_receiving: v.receiving, p_storage_pallet: v.storage_pallet, p_storage_cbm: v.storage_cbm, p_pick_first: v.pick_first,
    p_pick_extra: v.pick_extra, p_returns: v.returns, p_min_monthly: v.min_monthly, p_note: String(fd.get('note') ?? '').trim() || null,
  });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/rates');
  return { ok: true, message: 'Proposed. An admin who didn’t propose it approves it.' };
}

export async function decideRatesAction(id: string, decision: 'approve' | 'reject', reason?: string): Promise<R> {
  await requireWarehouseStaff('/office/warehouse/rates');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_decide_rates', { p_id: id, p_decision: decision, p_reason: reason ?? null });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/rates');
  return { ok: true, message: decision === 'approve' ? 'Approved and active.' : 'Rejected.' };
}
