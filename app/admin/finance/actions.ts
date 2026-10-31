'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { toCents } from '@/lib/format';
import { guard, fail, failAt, ok, str, type Result } from '@/components/admin/server';

/** Confirm a pending wallet top-up (credits the wallet via the ledger). */
export async function confirmTopup(topupId: string): Promise<Result> {
  const g = await guard('wallet', 'approve');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('confirm_topup', { p_topup: topupId });
  if (error) return fail(error);   // step-up → { error: 'STEP_UP_REQUIRED' }; used on Finance and Wallets, so the client returns to the current page
  revalidatePath('/admin/finance');
  revalidatePath('/admin/wallet');
  return ok('Top-up credited');
}

const Payment = z.object({
  order_id: z.string().uuid(),
  amount: z.string().min(1),
  method: z.enum(['bank_transfer', 'card', 'paypal', 'other']),
  reference: z.string().trim().min(2).max(80),
});

/** Record / match an incoming order payment (bank transfer or card). */
export async function recordPayment(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('finance', 'approve');
  if ('error' in g) return g.error;
  const p = Payment.safeParse({ order_id: str(fd, 'order_id'), amount: str(fd, 'amount'), method: str(fd, 'method'), reference: str(fd, 'reference') });
  if (!p.success) return fail('Choose an order and enter the amount, method and bank reference.');
  const cents = toCents(p.data.amount);
  if (!Number.isFinite(cents) || cents <= 0) return fail('INVALID_AMOUNT');
  const { error } = await g.sb.rpc('record_payment', {
    p_order: p.data.order_id, p_amount: cents, p_method: p.data.method, p_reference: p.data.reference,
  });
  if (error) return failAt(error, '/admin/finance');
  revalidatePath('/admin/finance');
  return ok('Payment recorded and posted to the ledger');
}

/** Maker–checker decision; the RPC blocks the requester and over-limit amounts for non-admins. */
export async function decideApproval(id: string, approve: boolean, note?: string): Promise<Result> {
  const g = await guard('finance', 'approve');
  if ('error' in g) return g.error;
  if (!approve && !note?.trim()) return fail('REASON_REQUIRED');
  const { error } = await g.sb.rpc('decide_finance_approval', { p_id: id, p_approve: approve, p_note: note?.trim() || null });
  if (error) return failAt(error, '/admin/finance');
  revalidatePath('/admin/finance');
  return ok(approve ? 'Approved' : 'Rejected');
}

const Approval = z.object({
  kind: z.enum(['refund', 'credit_note', 'payout', 'adjustment']),
  amount: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
  org_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional(),
});

/** New refund / credit note / payout / adjustment request (maker). */
export async function requestApproval(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('finance', 'create');
  if ('error' in g) return g.error;
  const opt = (k: string) => str(fd, k) || undefined;
  const p = Approval.safeParse({ kind: str(fd, 'kind'), amount: str(fd, 'amount'), reason: str(fd, 'reason'), org_id: opt('org_id'), order_id: opt('order_id'), supplier_id: opt('supplier_id') });
  if (!p.success) return fail('Fill in the type, amount and a reason of at least 5 characters.');
  const d = p.data;
  if (d.kind === 'payout' && !d.supplier_id) return fail('Choose the supplier for a payout.');
  if (d.kind !== 'payout' && !d.org_id) return fail('Choose the customer for a refund, credit note or adjustment.');
  const cents = toCents(d.amount);
  if (!Number.isFinite(cents) || cents <= 0) return fail('INVALID_AMOUNT');
  const { error } = await g.sb.rpc('request_finance_approval', {
    p_kind: d.kind, p_amount: cents, p_reason: d.reason, p_org: d.org_id ?? null, p_order: d.order_id ?? null, p_supplier: d.supplier_id ?? null,
  });
  if (error) return fail(error);
  revalidatePath('/admin/finance');
  return ok('Request sent for approval (a different person must approve it)');
}
