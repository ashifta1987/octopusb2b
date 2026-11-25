'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';

export type WhResult = { ok: boolean; message?: string; error?: string };
const clean = (m: string): WhResult => {
  if (/FORBIDDEN/.test(m) && !/:/.test(m.replace(/^FORBIDDEN/, ''))) return { ok: false, error: 'You don’t have permission to do this.' };
  const t = m.replace(/^[A-Z_]+:\s*/, '');
  return { ok: false, error: t.charAt(0).toUpperCase() + t.slice(1) };
};

export async function addStaffAction(fd: FormData): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/users');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_add_staff', {
    p_email: String(fd.get('email') ?? '').trim(), p_warehouse: String(fd.get('warehouse') ?? ''), p_role: String(fd.get('role') ?? ''),
  });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/users');
  return { ok: true, message: 'Added.' };
}
export async function setRoleAction(userId: string, warehouse: string, role: string): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/users');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_staff_role', { p_user: userId, p_warehouse: warehouse, p_role: role });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/users');
  return { ok: true, message: 'Role changed.' };
}
export async function suspendAction(userId: string, warehouse: string, reason: string): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/users');
  if (!reason.trim()) return { ok: false, error: 'Enter why this person is suspended.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_suspend_staff', { p_user: userId, p_warehouse: warehouse, p_reason: reason.trim() });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/users');
  return { ok: true, message: 'Suspended.' };
}
export async function restoreAction(userId: string, warehouse: string): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/users');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_restore_staff', { p_user: userId, p_warehouse: warehouse });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/users');
  return { ok: true, message: 'Restored.' };
}
export async function saveLocationAction(fd: FormData): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/locations');
  const sb = await createClient();
  const g = (k: string) => String(fd.get(k) ?? '').trim();
  const { error } = await sb.rpc('wh_save_location', {
    p_code: g('code'), p_name: g('name'), p_province: g('province'), p_city: g('city'), p_address: g('address'),
    p_email: g('email'), p_phone: g('phone'), p_hours: g('hours'), p_timezone: g('timezone') || 'Asia/Shanghai',
  });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse', 'layout');
  return { ok: true, message: 'Saved.' };
}
export async function setLocationStatusAction(code: string, status: string, reason: string): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/locations');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_location_status', { p_code: code, p_status: status, p_reason: reason || null });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse', 'layout');
  return { ok: true, message: status === 'active' ? 'Re-opened.' : status === 'paused' ? 'Paused.' : 'Closed.' };
}
export async function setDefaultAction(code: string): Promise<WhResult> {
  await requireWarehouseStaff('/office/warehouse/locations');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_default', { p_code: code });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse', 'layout');
  return { ok: true, message: 'Default warehouse changed.' };
}
