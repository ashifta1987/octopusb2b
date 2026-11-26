'use server';

import { revalidatePath } from 'next/cache';
import { requireInvoiceAccess } from '@/lib/warehouse-w6-server';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { monthLabel, parseMonth } from '@/lib/warehouse-w6';

/**
 * Warehouse OS · W6 staff actions: issue a client's monthly invoice (Finance) and save service targets / return-photo
 * retention (warehouse admin). The database functions enforce who may do it, the one-invoice-per-month rule, "never bill a
 * fee that is not set" and the balanced journal; these only shape the input and the sentence shown.
 */
export type W6Result = { ok: boolean; message?: string; error?: string; data?: unknown };
const INVOICES = '/office/warehouse/invoices';
const REPORTS = '/office/warehouse/reports';
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

export async function issueInvoiceAction(f: { orgId: string; month: string }): Promise<W6Result> {
  await requireInvoiceAccess(INVOICES);
  const month = parseMonth(f.month);
  if (!uuid(f.orgId) || !month) return { ok: false, error: 'Choose the client and the month.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_invoice_issue', { p_org: f.orgId, p_month: month });
  if (error) {
    const m = error.message;
    return { ok: false, error: /FORBIDDEN/.test(m) ? 'Only Finance can issue 3PL invoices.' : cleanDbError(m) };
  }
  const d = data as { number: string; repeated: boolean };
  revalidatePath(INVOICES);
  revalidatePath('/account/warehouse');
  revalidatePath('/account/invoices');
  return {
    ok: true,
    data: d,
    message: d.repeated ? `${monthLabel(month)} was already invoiced as ${d.number}. Nothing new was issued.`
      : `Invoice ${d.number} issued for ${monthLabel(month)}. The client sees it in the portal and can pay it.`,
  };
}

const hours = (v: string): number | null | 'bad' => {
  const s = v.trim();
  if (!s) return null;
  return /^\d{1,3}$/.test(s) && Number(s) >= 1 && Number(s) <= 720 ? Number(s) : 'bad';
};
const days = (v: string): number | null | 'bad' => {
  const s = v.trim();
  if (!s) return null;
  return /^\d{2,4}$/.test(s) && Number(s) >= 30 && Number(s) <= 3650 ? Number(s) : 'bad';
};

export async function saveServiceSettingsAction(f: { warehouse: string; dockToShelf: string; handoff: string; returnPhotoDays: string }): Promise<W6Result> {
  await requireWarehouseStaff(REPORTS);
  const d = hours(f.dockToShelf), h = hours(f.handoff), r = days(f.returnPhotoDays);
  if (d === 'bad' || h === 'bad') return { ok: false, error: 'Targets are whole hours from 1 to 720. Leave a box empty for no target.' };
  if (r === 'bad') return { ok: false, error: 'Keep return photos 30 to 3650 days. Leave it empty to keep them.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_service_settings', {
    p_warehouse: f.warehouse, p_dock_to_shelf_hours: d, p_handoff_hours: h, p_return_photo_days: r,
  });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  revalidatePath(REPORTS);
  return { ok: true, message: 'Saved. The bars and the retention job use the new values.' };
}
