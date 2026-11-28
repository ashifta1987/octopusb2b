'use server';
/**
 * ODS T9 batch 3 · Accounts — the two-person gate in front of TODAY's money actions that have no approval step today.
 * NO new money code: each function checks the same input as today, then runs runTwoPersonPayment (T8-DATA order:
 * staffApprovalReady → requestStaffApproval → "Second approver needed (APR-n)" → a different Finance user approves →
 * today's action → markStaffApprovalExecuted). Before migration 255 is applied (`unavailable`) the gate is skipped and
 * today's action runs exactly as today. Actions that already have a database two-person rule (held payments, credit
 * terms, SaaS billing) are NOT wrapped — the screens call them directly.
 */
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { markStaffApprovalExecuted, requestStaffApproval, staffApprovalReady } from '@/lib/office/approvals';
import { runTwoPersonPayment, type ExecResult, type PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import { TRANSFER_REASONS, OTHER_TEXT_MAX } from '@/lib/core/transfer-reason';
// TODAY's actions, unchanged:
import { confirmTransfer } from '@/app/admin/one-app-actions';
import { recordProformaTransfer } from '@/app/admin/finance/transfers/proforma-actions';
import { confirmTopup } from '@/app/admin/finance/actions';
import { PROFORMA_REF, TOPUP_REF, toMinor, validateProformaTransfer, validateTransferConfirm } from './core';

const UUID = /^[0-9a-f-]{36}$/i;
const TRANSFERS = '/admin/finance/transfers';
const WALLET = '/admin/wallet';

type Today = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
const stepped = (r: Today, back: string): ExecResult =>
  r.ok ? r : r.redirect || r.error === 'STEP_UP_REQUIRED' ? { ok: false, error: 'Enter your 2-step code again to continue.', redirect: stepUpRedirect(back) } : r;

export type TransferConfirmInput = { topupId: string; received: string; bankRef: string; reason: string; reasonText: string; note: string };

/** Bank transfers › Confirm and credit = today's confirmTransfer(id, fd) (RPC confirm_bank_transfer) behind the gate. */
export async function confirmTransferGated(input: TransferConfirmInput): Promise<PaymentOutcome> {
  const s = await getSession();
  if (!s?.isStaff) return { kind: 'error', message: 'Please sign in again.' };
  if (!can(s, 'wallet', 'approve')) return { kind: 'error', message: 'Only staff who can approve wallet payments can confirm transfers.' }; // today's page guard
  const id = String(input.topupId ?? '');
  if (!UUID.test(id)) return { kind: 'error', message: 'Transfer not found.' };
  const sb = await createClient();
  const { data: t } = await sb.from('wallet_topups').select('id, org_id, amount_cents, currency, reference, status').eq('id', id).maybeSingle();
  if (!t || t.status !== 'pending') return { kind: 'error', message: 'This transfer is no longer waiting.' };
  const claimed = Number(t.amount_cents);
  const bad = validateTransferConfirm(input, claimed, TRANSFER_REASONS.map((r) => r.value), OTHER_TEXT_MAX);
  if (bad) return { kind: 'error', message: bad };
  const received = toMinor(input.received)!;
  const fd = new FormData();
  fd.set('received', input.received);
  fd.set('bank_ref', input.bankRef.trim());
  fd.set('note', input.note);
  fd.set('reason', input.reason);
  fd.set('reason_text', input.reasonText);
  fd.set('claimed', String(claimed));
  return runTwoPersonPayment({
    ready: () => staffApprovalReady({ kind: 'payment', refType: TOPUP_REF, refId: id, amountMinor: received }),
    request: () =>
      requestStaffApproval({
        kind: 'payment', amountMinor: received, currency: 'USD', refType: TOPUP_REF, refId: id, orgId: t.org_id as string | null,
        reason: `Confirm bank transfer ${t.reference ?? ''} · bank reference ${input.bankRef.trim()}`.replace(/\s+/g, ' '),
        details: { topup_id: id, reference: t.reference, claimed_minor: claimed, received_minor: received, bank_ref: input.bankRef.trim() },
      }),
    execute: async () => stepped((await confirmTransfer(id, fd)) as Today, TRANSFERS),
    markExecuted: (a) => markStaffApprovalExecuted(a),
  });
}

/** Bank transfers › Proforma paid by transfer = today's recordProformaTransfer (finance:approve, step-up, pay_service_proforma) behind the gate. */
export async function recordProformaGated(input: { number: string; amount: string; bankRef: string }): Promise<PaymentOutcome> {
  const s = await getSession();
  if (!s?.isStaff) return { kind: 'error', message: 'Please sign in again.' };
  if (!can(s, 'finance', 'approve')) return { kind: 'error', message: 'Only Finance can record proforma payments.' }; // today's action guard
  const bad = validateProformaTransfer(input);
  if (bad) return { kind: 'error', message: bad };
  const number = input.number.trim().toUpperCase();
  const amountMinor = Math.round(Number(input.amount.replace(/,/g, '')) * 100);
  const sb = await createClient();
  const { data: doc } = await sb.from('documents').select('id, org_id, currency, order_id').eq('number', number).eq('doc_type', 'proforma_invoice').maybeSingle();
  if (!doc) return { kind: 'error', message: `Proforma ${number} not found.` };
  if (doc.order_id) return { kind: 'error', message: `${number} belongs to an order: record it on the order instead.` };
  const fd = new FormData();
  fd.set('number', number);
  fd.set('amount', input.amount);
  fd.set('bank_ref', input.bankRef.trim());
  return runTwoPersonPayment({
    ready: () => staffApprovalReady({ kind: 'payment', refType: PROFORMA_REF, refId: doc.id as string, amountMinor }),
    request: () =>
      requestStaffApproval({
        kind: 'payment', amountMinor, currency: String(doc.currency ?? 'USD').trim() || 'USD', refType: PROFORMA_REF, refId: doc.id as string, orgId: doc.org_id as string | null,
        reason: `Record payment on ${number} · bank reference ${input.bankRef.trim()}`,
        details: { document_id: doc.id, document_number: number, method: 'bank_transfer', reference: input.bankRef.trim(), amount_minor: amountMinor },
      }),
    execute: async () => stepped((await recordProformaTransfer(null, fd)) as Today, TRANSFERS),
    markExecuted: (a) => markStaffApprovalExecuted(a),
  });
}

/** Wallets › Top-ups › Confirm match = today's confirmTopup(id) (wallet:approve, RPC confirm_topup) behind the gate. */
export async function confirmTopupGated(topupId: string): Promise<PaymentOutcome> {
  const s = await getSession();
  if (!s?.isStaff) return { kind: 'error', message: 'Please sign in again.' };
  if (!can(s, 'wallet', 'approve')) return { kind: 'error', message: 'You do not have permission to confirm top-ups.' };
  const id = String(topupId ?? '');
  if (!UUID.test(id)) return { kind: 'error', message: 'Top-up not found.' };
  const sb = await createClient();
  const { data: t } = await sb.from('wallet_topups').select('id, org_id, amount_cents, currency, reference, status').eq('id', id).maybeSingle();
  if (!t || t.status !== 'pending') return { kind: 'error', message: 'This top-up is no longer waiting.' };
  const amountMinor = Number(t.amount_cents);
  return runTwoPersonPayment({
    ready: () => staffApprovalReady({ kind: 'payment', refType: TOPUP_REF, refId: id, amountMinor }),
    request: () =>
      requestStaffApproval({
        kind: 'payment', amountMinor, currency: String(t.currency ?? 'USD').trim() || 'USD', refType: TOPUP_REF, refId: id, orgId: t.org_id as string | null,
        reason: `Confirm wallet top-up ${t.reference ?? ''}`.trim(),
        details: { topup_id: id, reference: t.reference, amount_minor: amountMinor },
      }),
    execute: async () => stepped((await confirmTopup(id)) as Today, WALLET),
    markExecuted: (a) => markStaffApprovalExecuted(a),
  });
}
