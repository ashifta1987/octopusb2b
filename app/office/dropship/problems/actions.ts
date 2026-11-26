'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';

/**
 * Release 4 · Step 10 — staff actions on Order problems (/office/dropship/problems). Every action re-checks the person in the
 * database (Support / Dropship editors decide; Finance approvers approve refunds above US$1,000; warehouse staff with the
 * returns role register returned parcels) and writes the audit log there.
 */
export type StaffResult = { ok: true; message: string } | { ok: false; message: string };

const Uuid = z.string().uuid();

async function run(fn: string, args: Record<string, unknown>, okMessage: (d: Record<string, unknown>) => string): Promise<StaffResult> {
  await requireDropshipV2Staff(false, '/office/dropship/problems');
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error) };
  revalidatePath('/office/dropship/problems');
  return { ok: true, message: okMessage((data ?? {}) as Record<string, unknown>) };
}

const id = (v: string) => Uuid.parse(v);
/** validates first (so a redirect from the staff guard inside run() is never swallowed) */
function args(build: () => Record<string, unknown>): Record<string, unknown> | null {
  try { return build(); } catch { return null; }
}
const text = (v: string, min = 0, max = 600) => z.string().trim().min(min).max(max).parse(v ?? '');

export async function carrierClaimAction(caseId: string, ref: string) {
  const a2 = args(() => ({ p_case: id(caseId), p_ref: text(ref, 1, 64) }));
  if (!a2) return { ok: false, message: 'Enter the carrier\u2019s claim number (up to 64 characters).' } as StaffResult;
  return run('ds10_case_carrier', a2, () => 'Carrier claim recorded.');
}

export async function reshipAction(caseId: string, message: string) {
  const a2 = args(() => ({ p_case: id(caseId), p_message: text(message) || null, p_lines: null }));
  if (!a2) return { ok: false, message: 'Check the message (up to 600 characters).' } as StaffResult;
  return run('ds10_case_reship', a2, (d) => `Reship created: order ${String(d.order_number ?? '')}.`);
}

export async function refundAction(caseId: string, amountCents: number, message: string) {
  const a = z.number().int().positive().max(100_000_000).safeParse(amountCents);
  if (!a.success) return { ok: false, message: 'Amount: enter the refund in US$ with up to two decimals.' } as StaffResult;
  const a2 = args(() => ({ p_case: id(caseId), p_amount_cents: a.data, p_message: text(message) || null }));
  if (!a2) return { ok: false, message: 'Check the message (up to 600 characters).' } as StaffResult;
  return run('ds10_case_refund', a2, (d) => (d.status === 'awaiting_approval' ? 'Waiting for approval. Another Finance user or an admin must approve this refund.' : String(d.message ?? 'Refunded.')));
}

export async function approveRefundAction(caseId: string, approve: boolean, note: string) {
  const a2 = args(() => ({ p_case: id(caseId), p_approve: approve, p_note: text(note) || null }));
  if (!a2) return { ok: false, message: 'Check the note (up to 600 characters).' } as StaffResult;
  return run('ds10_refund_approve', a2, (d) => (approve ? `Approved: ${String(d.status ?? '')}.` : 'Refund rejected; the case is back with support.'));
}

export async function rejectCaseAction(caseId: string, message: string) {
  const a2 = args(() => ({ p_case: id(caseId), p_message: text(message, 5) }));
  if (!a2) return { ok: false, message: 'Reason: tell the merchant why (5 to 600 characters).' } as StaffResult;
  return run('ds10_case_reject', a2, () => 'Decision sent to the merchant.');
}

export async function receiveReturnAction(caseId: string, carrierRef: string) {
  const a2 = args(() => ({ p_case: id(caseId), p_carrier_ref: text(carrierRef, 0, 64) || null }));
  if (!a2) return { ok: false, message: 'Carrier reference: up to 64 characters.' } as StaffResult;
  return run('ds10_return_receive', a2, (d) => `Registered as ${String(d.wh_return_code ?? '')}. Inspect it on the Warehouse Returns screen.`);
}

export async function settleReturnAction(caseId: string, refundCents: number, message: string) {
  const a = z.number().int().min(0).max(100_000_000).safeParse(refundCents);
  if (!a.success) return { ok: false, message: 'Refund: enter US$ with up to two decimals (0 for none).' } as StaffResult;
  const a2 = args(() => ({ p_case: id(caseId), p_refund_cents: a.data, p_message: text(message) || null }));
  if (!a2) return { ok: false, message: 'Check the message (up to 600 characters).' } as StaffResult;
  return run('ds10_return_settle', a2, (d) => `Return settled (${String(d.status ?? '')}).`);
}

export async function reweighDecideAction(storeOrderId: string, decision: 'charge' | 'absorb') {
  const d = z.enum(['charge', 'absorb']).safeParse(decision);
  if (!d.success) return { ok: false, message: 'Choose charge or absorb.' } as StaffResult;
  const a2 = args(() => ({ p_so: id(storeOrderId), p_decision: d.data }));
  if (!a2) return { ok: false, message: 'This order was not found.' } as StaffResult;
  return run('ds10_reweigh_decide', a2, (r) => (d.data === 'charge' ? `Charged on ${String(r.invoice_number ?? '')}; the merchant has 7 days to dispute.` : 'Absorbed by Octopus.'));
}

export async function reweighDisputeDecideAction(reweighId: string, refund: boolean, answer: string) {
  const a2 = args(() => ({ p_reweigh: id(reweighId), p_refund: refund, p_answer: text(answer, 5) }));
  if (!a2) return { ok: false, message: 'Answer: write 5 to 600 characters for the merchant.' } as StaffResult;
  return run('ds10_reweigh_dispute_decide', a2, (r) => (refund ? `Refunded with ${String(r.credit_note ?? 'a credit note')}.` : 'Dispute rejected; the merchant sees your answer.'));
}
