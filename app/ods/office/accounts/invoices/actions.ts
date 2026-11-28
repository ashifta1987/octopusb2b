'use server';
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { markStaffApprovalExecuted, requestStaffApproval, staffApprovalReady } from '@/lib/office/approvals';
// TODAY's record-payment actions, called unchanged (their own guard, validation, step-up 2FA, RPC, audit, revalidation):
import { recordPaymentStepUp } from '@/app/office/orders/[id]/payment-actions';
import { recordProformaTransfer } from '@/app/admin/finance/transfers/proforma-actions';
import { amountToMinor, payableMinor, paymentTarget, runTwoPersonPayment, validatePayment, invoiceStatus, type ExecResult, type PaymentOutcome } from './_lib/invoice-core';

const PAGE = '/office/accounts/invoices';

export type InvoiceActivityItem = { id: string; at: string; title: string; detail: string | null; amountMinor: number | null; currency: string | null };

/**
 * Record payment drawer → Save payment. NO new money code: after the two-person gate (T8-DATA order, see
 * runTwoPersonPayment) it calls TODAY's action for this invoice:
 *  - invoice linked to an order → recordPaymentStepUp(orderId) (Back Office › Orders › Record bank payment:
 *    mfa_fresh step-up → recordPayment → RPC record_payment(p_order, p_amount, p_method, p_reference));
 *  - service proforma (PF-/PI-, no order) → recordProformaTransfer (Admin › Finance › Transfers: guard finance:approve,
 *    requireFresh step-up → RPC pay_service_proforma(p_document, p_amount, 'bank_transfer', p_reference)).
 * Step-up redirects come back to this page.
 */
export async function recordInvoicePaymentAction(input: { documentId: string; amount: string; method: string; reference: string }): Promise<PaymentOutcome> {
  const s = await getSession();
  if (!s) return { kind: 'error', message: 'Please sign in again.' };
  if (!s.isStaff || s.aal !== 'aal2') return { kind: 'error', message: 'Only Octopus staff signed in with their 2-step code can do this.' };
  if (!can(s, 'finance', 'approve')) return { kind: 'error', message: 'Only Finance can record payments.' };
  const id = String(input.documentId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: 'error', message: 'Invoice not found.' };

  const sb = await createClient();
  const { data: d } = await sb
    .from('documents')
    .select('id, number, doc_type, org_id, order_id, amount_cents, paid_cents, currency, status, due_at, payment_option, orders(code, total_cents, paid_cents, currency)')
    .eq('id', id)
    .maybeSingle();
  if (!d) return { kind: 'error', message: 'Invoice not found.' };
  const order = d.orders as unknown as { code?: string; total_cents?: number; paid_cents?: number; currency?: string } | null;
  const status = invoiceStatus(d, Date.now());
  const orderOutstanding = d.order_id && order ? Math.max(0, Number(order.total_cents ?? 0) - Number(order.paid_cents ?? 0)) : null;
  const pay = paymentTarget({ docType: d.doc_type, number: d.number, status, orderId: d.order_id, orderOutstandingMinor: orderOutstanding });
  if (!pay.target) return { kind: 'error', message: pay.reason ?? 'Record payment is not available for this invoice.' };
  const target = pay.target;
  const balance = Math.max(0, Number(d.amount_cents ?? 0) - Number(d.paid_cents ?? 0));
  const max = payableMinor({ payTarget: target, orderOutstandingMinor: orderOutstanding, balanceMinor: balance });
  const amount = String(input.amount ?? '').replace(/,/g, '').trim();
  const reference = String(input.reference ?? '').trim();
  const method = target === 'proforma' ? 'bank_transfer' : String(input.method ?? '');
  const errs = validatePayment({ amount, reference, method }, max, target);
  const firstErr = errs.amount ?? errs.reference ?? errs.method;
  if (firstErr) return { kind: 'error', message: firstErr };

  const amountMinor = amountToMinor(amount);
  const currency = String((target === 'order' ? order?.currency : d.currency) ?? 'USD').trim() || 'USD';
  const refType = target === 'order' ? 'order' : 'document';
  const refId = target === 'order' ? (d.order_id as string) : d.id;

  const execute = async (): Promise<ExecResult> => {
    const fd = new FormData();
    let r: { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
    if (target === 'order') {
      fd.set('amount', amount);
      fd.set('method', method);
      fd.set('reference', reference);
      r = await recordPaymentStepUp(d.order_id as string, null, fd);
    } else {
      fd.set('number', d.number);
      fd.set('bank_ref', reference);
      fd.set('amount', amount);
      r = await recordProformaTransfer(null, fd);
    }
    if (r.ok) return r;
    // today's actions send the user back to their own page after the 2-step code; come back here instead
    return r.redirect || r.error === 'STEP_UP_REQUIRED' ? { ok: false, error: 'Enter your 2-step code again to record this payment.', redirect: stepUpRedirect(`${PAGE}?open=${d.id}`) } : r;
  };

  return runTwoPersonPayment({
    ready: () => staffApprovalReady({ kind: 'payment', refType, refId, amountMinor }),
    request: () =>
      requestStaffApproval({
        kind: 'payment',
        amountMinor,
        currency,
        reason: `Record payment on ${d.number}${order?.code ? ` (order ${order.code})` : ''} · bank reference ${reference}`,
        refType,
        refId,
        orgId: d.org_id,
        details: { document_id: d.id, document_number: d.number, order_code: order?.code ?? null, method, reference, amount_minor: amountMinor },
      }),
    execute,
    markExecuted: (approvalId) => markStaffApprovalExecuted(approvalId),
  });
}

/** Drawer › Activity: the invoice's own events + the payments today's tables hold (payments for an order, document_payments for a proforma). */
export async function invoiceActivityAction(documentId: string): Promise<{ ok: true; items: InvoiceActivityItem[] } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || !s.isStaff || s.aal !== 'aal2' || !can(s, 'finance', 'view')) return { ok: false, error: 'You do not have permission to see this.' };
  const id = String(documentId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Invoice not found.' };
  const sb = await createClient();
  const { data: d, error } = await sb.from('documents').select('id, number, doc_type, order_id, created_at, emailed_at, last_reminder_stage, currency').eq('id', id).maybeSingle();
  if (error || !d) return { ok: false, error: 'Invoice not found.' };
  const items: InvoiceActivityItem[] = [{ id: `${d.id}:issued`, at: d.created_at as string, title: 'Issued', detail: d.number as string, amountMinor: null, currency: null }];
  if (d.emailed_at) items.push({ id: `${d.id}:emailed`, at: d.emailed_at as string, title: 'Emailed to the customer', detail: null, amountMinor: null, currency: null });
  if (d.order_id) {
    const { data: pays, error: e2 } = await sb.from('payments').select('id, purpose, method, amount_cents, currency, reference, status, created_at, confirmed_at').eq('order_id', d.order_id).order('created_at', { ascending: false }).limit(50);
    if (e2) return { ok: false, error: 'We couldn’t load the activity.' };
    for (const p of pays ?? []) {
      items.push({
        id: p.id as string,
        at: (p.confirmed_at ?? p.created_at) as string,
        title: `Order payment · ${String(p.purpose)} · ${String(p.status)}`,
        detail: [String(p.method).replace(/_/g, ' '), p.reference].filter(Boolean).join(' · '),
        amountMinor: Number(p.amount_cents),
        currency: (p.currency as string | null) ?? null,
      });
    }
  } else {
    const { data: pays, error: e2 } = await sb.from('document_payments').select('id, amount_cents, currency, method, reference, created_at').eq('document_id', d.id).order('created_at', { ascending: false }).limit(50);
    if (e2) return { ok: false, error: 'We couldn’t load the activity.' };
    for (const p of pays ?? []) {
      items.push({ id: p.id as string, at: p.created_at as string, title: 'Payment recorded', detail: [String(p.method).replace(/_/g, ' '), p.reference].filter(Boolean).join(' · '), amountMinor: Number(p.amount_cents), currency: (p.currency as string | null) ?? null });
    }
  }
  if (d.last_reminder_stage) items.push({ id: `${d.id}:reminder`, at: '', title: `Last automatic reminder: ${String(d.last_reminder_stage).replace(/_/g, ' ')}`, detail: null, amountMinor: null, currency: null });
  items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return { ok: true, items };
}
