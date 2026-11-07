'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { mapDbError } from '@/lib/format';
import { fail, ok, type Result } from '@/components/backoffice/server-utils';

/** ADDON-41 41-B staff actions. Every change goes through a database function that checks the right and writes the audit row. */
const dollars = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.round(n * 100) : null; };
const pct = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };
const err = (e: { message?: string } | null) => fail(mapDbError(e));

async function staff() {
  const s = await getSession();
  if (!s?.isStaff) return null;
  return s;
}

export async function decideApproval(id: string, decision: 'approved' | 'declined', note: string): Promise<Result> {
  if (!(await staff())) return fail('Please sign in again.');
  const sb = await createClient();
  const { error } = await sb.rpc('decide_approval', { p_id: id, p_decision: decision, p_note: note.trim() || null });
  if (error) return err(error);
  revalidatePath('/admin'); revalidatePath('/admin/approvals');
  return ok(undefined, decision === 'approved' ? 'Approved' : 'Declined');
}

export async function saveManagerLimits(fd: FormData): Promise<Result> {
  if (!(await staff())) return fail('Please sign in again.');
  const manager = String(fd.get('manager') ?? '');
  const amount = dollars(fd.get('max_amount'));
  const margin = pct(fd.get('min_margin'));
  if (!z.string().uuid().safeParse(manager).success) return fail('Choose an account manager.');
  if (amount == null || amount < 0) return fail('Enter the amount limit in US dollars.');
  if (margin == null || margin < 0 || margin > 100) return fail('Enter a minimum margin between 0 and 100 %.');
  const sb = await createClient();
  const { error } = await sb.rpc('set_manager_limits', { p_manager: manager, p_max_amount_cents: amount, p_min_margin_pct: margin });
  if (error) return err(error);
  revalidatePath('/admin/approvals'); revalidatePath('/admin');
  return ok(undefined, 'Limits saved');
}

export async function saveCustomerLimits(orgId: string, fd: FormData): Promise<Result> {
  if (!(await staff())) return fail('Please sign in again.');
  const order = dollars(fd.get('max_order')); const month = dollars(fd.get('max_month')); const margin = pct(fd.get('min_margin'));
  if (margin != null && (margin < 0 || margin > 100)) return fail('Enter a minimum margin between 0 and 100 %.');
  const sb = await createClient();
  const { error } = await sb.rpc('set_customer_limits', { p_org: orgId, p_max_order_cents: order, p_max_month_cents: month, p_min_margin_pct: margin });
  if (error) return err(error);
  revalidatePath(`/admin/customers/${orgId}`);
  return ok(undefined, 'Customer limits saved');
}

export async function setService(orgId: string, fd: FormData): Promise<Result> {
  if (!(await staff())) return fail('Please sign in again.');
  const service = String(fd.get('service') ?? ''); const status = String(fd.get('status') ?? ''); const plan = String(fd.get('plan') ?? '').trim() || null;
  if (!['sourcing', 'dropship', 'warehouse', 'brand'].includes(service) || !['off', 'trial', 'on', 'paused'].includes(status)) return fail('Choose a service and a status.');
  const sb = await createClient();
  const { error } = await sb.rpc('set_company_service', { p_org: orgId, p_service: service, p_status: status, p_plan: plan });
  if (error) return err(error);
  revalidatePath(`/admin/customers/${orgId}`);
  return ok(undefined, 'Service updated');
}

export async function assignManager(orgId: string, fd: FormData): Promise<Result> {
  const s = await staff();
  if (!s) return fail('Please sign in again.');
  const staffUser = String(fd.get('manager') ?? '');
  if (!z.string().uuid().safeParse(staffUser).success) return fail('Choose an account manager.');
  const sb = await createClient();
  const { error } = await sb.rpc('reassign_account_manager', { p_org: orgId, p_staff: staffUser, p_reason: 'Assigned in Admin › Customers' });
  if (error) return err(error);
  revalidatePath(`/admin/customers/${orgId}`); revalidatePath('/admin');
  return ok(undefined, 'Account manager assigned');
}

export async function confirmTransfer(id: string, fd: FormData): Promise<Result> {
  if (!(await staff())) return fail('Please sign in again.');
  const received = dollars(fd.get('received'));
  const bankRef = String(fd.get('bank_ref') ?? '').trim();
  if (received == null || received <= 0) return fail('Enter the amount that actually arrived, in US dollars.');
  if (!bankRef) return fail('Enter the bank reference from the statement.');
  const sb = await createClient();
  const { error } = await sb.rpc('confirm_bank_transfer', { p_topup: id, p_amount_received_cents: received, p_bank_ref: bankRef });
  if (error) return err(error);
  revalidatePath('/admin/finance/transfers'); revalidatePath('/admin');
  return ok(undefined, 'Confirmed. The wallet is credited and a receipt was issued.');
}

export async function rejectTransfer(id: string, reason: string): Promise<Result> {
  if (!(await staff())) return fail('Please sign in again.');
  const sb = await createClient();
  const { error } = await sb.rpc('reject_bank_transfer', { p_topup: id, p_reason: reason });
  if (error) return err(error);
  revalidatePath('/admin/finance/transfers'); revalidatePath('/admin');
  return ok(undefined, 'Rejected. The customer sees the reason.');
}

