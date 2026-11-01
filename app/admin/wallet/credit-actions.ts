'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { guard, fail, ok, str, bool, type Result } from '@/components/admin/server';

/** "1,000.50" → 100050 minor units (USD and CNY both have 2 decimals). null when empty/invalid. */
function toMinor(raw: string): number | null {
  const v = raw.replace(/[,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

function refresh() {
  revalidateTag('site-content', 'max');
  revalidatePath('/admin/wallet');
  revalidatePath('/account/wallet');
}

/** Wallet credit facility — default limit for all (verified) customers. Admin only; the RPC re-checks is_admin() and audits. */
export async function saveCreditDefault(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('wallet', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const amount = toMinor(str(fd, 'amount'));
  if (amount == null) return fail('Enter the default credit limit as a number, e.g. 1000 or 1000.00 (0 = no credit by default).');
  const currency = str(fd, 'currency');
  if (!['USD', 'CNY'].includes(currency)) return fail('INVALID_CURRENCY');
  const { error } = await g.sb.rpc('admin_set_wallet_credit_default', { p_amount_minor: amount, p_currency: currency, p_verified_only: bool(fd, 'verified_only') });
  if (error) return fail(error);
  refresh();
  return ok('Default credit limit saved');
}

/** Per-customer credit limit override. Empty amount + "Use default" removes the override. Admin only; audited in the RPC. */
export async function saveCustomerCredit(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('wallet', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const org = str(fd, 'org_id');
  if (!/^[0-9a-f-]{36}$/i.test(org)) return fail('Choose a customer.');
  const useDefault = bool(fd, 'use_default');
  const amount = useDefault ? null : toMinor(str(fd, 'amount'));
  if (!useDefault && amount == null) return fail('Enter the credit limit as a number, e.g. 2500 (0 = no credit for this customer).');
  const currency = str(fd, 'currency') || null;
  const { error } = await g.sb.rpc('admin_set_wallet_credit', { p_org: org, p_limit_minor: amount as number, p_currency: currency as string, p_note: str(fd, 'note') || (null as unknown as string) });
  if (error) return fail(error);
  refresh();
  return ok(useDefault ? 'Customer now uses the default limit' : 'Customer credit limit saved');
}

