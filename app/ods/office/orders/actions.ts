'use server';
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { markStaffApprovalExecuted, requestStaffApproval, staffApprovalReady } from '@/lib/office/approvals';
// TODAY's actions, called unchanged (their own guard, validation, step-up 2FA, RPC, audit, revalidation):
import { recordPaymentStepUp } from '@/app/office/orders/[id]/payment-actions';
import { transitionOrder } from '@/app/office/actions';
// the Invoices screen's two-person order + form checks, shared (same staff_approvals kind/ref as Invoices for an order invoice)
import { amountToMinor, runTwoPersonPayment, type ExecResult, type PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
// today's order payment limits (reference 3–120, methods) — not the Invoices 80-char form rule
import { validateOrderPayment } from './_lib/order-core';

export type OrderPaymentInput = { orderId: string; amount: string; method: string; reference: string };
export type MoveResult = { ok: true; message?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Order record › Record payment drawer → Save payment. NO new money code: after the T8-DATA two-person gate
 * (runTwoPersonPayment: ready? → request → "Second approver needed (APR-n)" → a different Finance user approves → today's
 * action → mark executed; skipped while migration 255 is not applied) it calls TODAY's recordPaymentStepUp(orderId)
 * (mfa_fresh step-up → recordPayment → RPC record_payment). The approval uses kind 'payment', ref ('order', orderId) —
 * the same as the Invoices drawer for an order invoice, so one approval covers the order whichever screen saves it.
 */
export async function recordOrderPaymentAction(input: OrderPaymentInput): Promise<PaymentOutcome> {
  const s = await getSession();
  if (!s) return { kind: 'error', message: 'Please sign in again.' };
  if (!s.isStaff || s.aal !== 'aal2') return { kind: 'error', message: 'Only Octopus staff signed in with their 2-step code can do this.' };
  if (!can(s, 'finance', 'approve')) return { kind: 'error', message: 'Only Finance can record payments.' };
  const id = String(input.orderId ?? '');
  if (!UUID.test(id)) return { kind: 'error', message: 'Order not found.' };

  const sb = await createClient();
  const { data: o } = await sb.from('orders').select('id, code, org_id, total_cents, paid_cents, currency').eq('id', id).maybeSingle();
  if (!o) return { kind: 'error', message: 'Order not found.' };
  const max = Math.max(0, Number(o.total_cents ?? 0) - Number(o.paid_cents ?? 0));
  if (max <= 0) return { kind: 'error', message: 'This order is fully paid.' };
  const amount = String(input.amount ?? '').replace(/,/g, '').trim();
  const reference = String(input.reference ?? '').trim();
  const method = String(input.method ?? '');
  const errs = validateOrderPayment({ amount, reference, method }, max);
  const firstErr = errs.amount ?? errs.reference ?? errs.method;
  if (firstErr) return { kind: 'error', message: firstErr };

  const amountMinor = amountToMinor(amount);
  const currency = String(o.currency ?? 'USD').trim() || 'USD';
  const back = `/office/orders/${id}?tab=payments&pay=1`;

  const execute = async (): Promise<ExecResult> => {
    const fd = new FormData();
    fd.set('amount', amount);
    fd.set('method', method);
    fd.set('reference', reference);
    const r = await recordPaymentStepUp(id, null, fd);
    if (r.ok) return r;
    return r.redirect || r.error === 'STEP_UP_REQUIRED' ? { ok: false, error: 'Enter your 2-step code again to record this payment.', redirect: stepUpRedirect(back) } : r;
  };

  return runTwoPersonPayment({
    ready: () => staffApprovalReady({ kind: 'payment', refType: 'order', refId: id, amountMinor }),
    request: () =>
      requestStaffApproval({
        kind: 'payment',
        amountMinor,
        currency,
        reason: `Record payment on order ${o.code} · bank reference ${reference}`,
        refType: 'order',
        refId: id,
        orgId: o.org_id as string | null,
        details: { order_id: id, order_code: o.code, method, reference, amount_minor: amountMinor },
      }),
    execute,
    markExecuted: (approvalId) => markStaffApprovalExecuted(approvalId),
  });
}

/** Move order (status transition) = TODAY's transitionOrder (orders:edit, reason for cancel / dispute, RPC transition_order), unchanged. */
export async function moveOrderAction(orderId: string, to: string, reason: string): Promise<MoveResult> {
  if (!UUID.test(String(orderId ?? ''))) return { ok: false, error: 'Order not found.' };
  const r = await transitionOrder(orderId, String(to ?? ''), String(reason ?? ''));
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
}
