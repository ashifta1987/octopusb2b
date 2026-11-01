'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { fail, failAt, guard, ok, type Result } from '@/components/admin/server';
import { toggleVip } from '@/components/admin/assistant/settings-schema';

/** Admin override of the dedicated account manager (SPEC §20.3) — reason required, logged by the RPC. */
export async function reassignAccountManager(orgId: string, staffId: string, reason: string, path = `/admin/customers/${orgId}`): Promise<Result> {
  const g = await guard('customers', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin && !g.s.permissions.has('assistant:reassign')) return fail('FORBIDDEN');
  if (!staffId) return fail('Pick a staff member.');
  if (!reason.trim()) return fail('REASON_REQUIRED');
  const { error } = await g.sb.rpc('reassign_account_manager', { p_org: orgId, p_staff: staffId, p_reason: reason.trim().slice(0, 500) });
  if (error) return failAt(error, path.startsWith('/') ? path : `/admin/customers/${orgId}`);
  revalidatePath('/admin/customers');
  revalidatePath(`/admin/customers/${orgId}`);
  revalidatePath('/admin/assistant');
  return ok('Account manager reassigned.');
}

/** VIP flag: VIP customers are always routed to a human (assistant_vip_customer_ids, admin only via set_setting). */
export async function setVip(orgId: string, on: boolean): Promise<Result> {
  const g = await guard('customers', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('Only an Admin can change the VIP flag.');
  const { data } = await g.sb.from('site_settings').select('value').eq('key', 'assistant_vip_customer_ids').maybeSingle();
  const next = toggleVip(data?.value, orgId, on);
  const { error } = await g.sb.rpc('set_setting', { p_key: 'assistant_vip_customer_ids', p_value: next });
  if (error) return failAt(error, `/admin/customers/${orgId}`);
  revalidateTag('site-content', 'max');
  revalidatePath('/admin/customers');
  revalidatePath(`/admin/customers/${orgId}`);
  revalidatePath('/admin/assistant');
  return ok(on ? 'Marked as VIP — always routed to a human.' : 'VIP flag removed.');
}
