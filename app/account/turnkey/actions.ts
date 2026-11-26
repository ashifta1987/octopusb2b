'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usdToCents } from '@/lib/turnkey/format';

export type EnquiryInput = {
  catalogueProject: string; title: string; country: string; city: string; targetOpenOn: string; floorArea: string; budgetUsd: string; plan: string;
  website?: string; // hidden honeypot
};

const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());

/**
 * Turnkey T2 — client enquiry (design: Enquiry is free; NewProject / ClientIntake collect the plan). Creates a project at
 * "Enquiry" for the signed-in customer's company. The database checks everything again and applies the abuse limits.
 */
export async function submitEnquiryAction(input: EnquiryInput): Promise<{ ok: boolean; code?: string; error?: string }> {
  const s = await requireCustomer('/account/turnkey/new');
  if (!s.org) return { ok: false, error: 'Complete your company profile first.' };
  if (input.website) return { ok: false, error: 'Something went wrong. Please try again.' };
  const plan = input.plan.trim();
  if (!input.catalogueProject && !input.title.trim()) return { ok: false, error: 'Choose a project or tell us what you want to open.' };
  if (plan.length < 20) return { ok: false, error: 'Tell us about your plan (at least 20 characters).' };
  const budget = usdToCents(input.budgetUsd);
  if (Number.isNaN(budget)) return { ok: false, error: 'Budget: enter an amount in US dollars, for example 35000.' };
  const areaText = input.floorArea.trim().replace(',', '.');
  const area = areaText ? Number(areaText) : null;
  if (area != null && (!Number.isFinite(area) || area <= 0)) return { ok: false, error: 'Space: enter the floor area in m², for example 120.' };
  if (input.targetOpenOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetOpenOn)) return { ok: false, error: 'Choose an opening date.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_submit_enquiry', {
    p_org: s.org.id, p_catalogue_project: input.catalogueProject || null, p_title: input.title.trim() || null,
    p_country: input.country || null, p_city: input.city.trim() || null, p_target_open_on: input.targetOpenOn || null,
    p_floor_area_m2: area, p_budget_cents: budget, p_plan: plan,
  });
  if (error) return { ok: false, error: clean(error.message) };
  return { ok: true, code: (data as { code: string }).code };
}

/**
 * Turnkey T3 — the client pays an approved fee's proforma from the company wallet through the same database function as
 * every other service proforma (pay_service_proforma, migration 201). The idempotency key comes from the page (one per
 * view), so a double click is charged once; the tax invoice is issued when it is fully paid. Bank transfers are recorded
 * by Finance (Admin › Finance › Transfers). The phase opens when staff move the project; the database refuses the move
 * until the fee is paid.
 */
export async function payTurnkeyFeeAction(input: { code: string; documentId: string; amountCents: number; idempotencyKey: string }): Promise<{ ok: boolean; message: string }> {
  const code = String(input.code ?? '');
  const s = await requireCustomer(/^TKP-\d{5,}$/.test(code) ? `/account/turnkey/${code}` : '/account/turnkey');
  if (!s.org) return { ok: false, message: 'Complete your company profile first.' };
  const amount = Math.round(Number(input.amountCents));
  if (!/^TKP-\d{5,}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(input.documentId) || String(input.idempotencyKey ?? '').length < 16 || !(amount > 0)) {
    return { ok: false, message: 'Something is missing. Reload the page and try again.' };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('pay_service_proforma', { p_document: input.documentId, p_amount: amount, p_method: 'wallet', p_reference: null, p_idempotency_key: input.idempotencyKey });
  if (error) {
    const m = error.message;
    return {
      ok: false,
      message: /WALLET_INSUFFICIENT/.test(m) ? 'Your wallet balance is not enough. Top up first, or pay by bank transfer.'
        : /ALREADY_PAID/.test(m) ? 'This fee is already paid.'
        : /WALLET_DISABLED/.test(m) ? 'Wallet payments are switched off at the moment. Please pay by bank transfer.'
        : /CANCELLED/.test(m) ? 'This proforma was replaced. Reload the page to see the current fee.'
        : /INVALID_AMOUNT/.test(m) ? 'The amount is more than what is left to pay.'
        : 'The payment could not be made. Please try again or contact us.',
    };
  }
  revalidatePath(`/account/turnkey/${code}`);
  revalidatePath('/account/invoices');
  const r = data as { fully_paid?: boolean };
  return { ok: true, message: r.fully_paid ? 'Paid. Your tax invoice has been issued; we start this phase next.' : 'Payment received. The rest is still to pay.' };
}

/* ───────── T4: layout drawings and quote (the database checks the client's company and the state again) ───────── */
type Done = { ok: boolean; message: string };
const T4_ERR: [RegExp, string][] = [
  [/REASON_REQUIRED/, 'Tell us what to change.'],
  [/VERSION_DECIDED/, 'This version was already reviewed. Reload the page.'],
  [/QUOTE_NOT_OPEN/, 'This quote version is no longer open. Reload the page.'],
  [/QUOTE_EXPIRED/, 'This quote has expired. Ask us for a new version.'],
  [/NO_DRAWING_FEE/, 'We could not prepare the extra version. Please contact your account manager.'],
  [/PROJECT_NOT_OPEN/, 'This project is not open at the moment.'],
  [/TOO_MANY_COMMENTS/, 'Please try again tomorrow.'],
];
const t4msg = (m: string) => T4_ERR.find(([r]) => r.test(m))?.[1] ?? 'That did not work. Please try again or contact us.';

async function t4run(code: string, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const s = await requireCustomer(/^TKP-\d{5,}$/.test(code) ? `/account/turnkey/${code}` : '/account/turnkey');
  if (!s.org) return { ok: false, message: 'Complete your company profile first.' };
  if (!/^TKP-\d{5,}$/.test(code)) return { ok: false, message: 'Something is missing. Reload the page and try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: t4msg(error.message) };
  revalidatePath(`/account/turnkey/${code}`);
  return { ok: true, data };
}

export async function drawingCommentAction(code: string, versionId: string, body: string): Promise<Done> {
  if (!body.trim()) return { ok: false, message: 'Write a comment first.' };
  const r = await t4run(code, 'tk_comment_drawing', { p_version: versionId, p_body: body.trim().slice(0, 2000) });
  return { ok: r.ok, message: r.ok ? 'Comment sent.' : r.message ?? '' };
}

/** Approve the version under review, or ask for changes (from version 3 on the next version is an extra version). */
export async function decideDrawingAction(code: string, versionId: string, decision: 'approve' | 'changes', comment: string): Promise<Done> {
  if (decision === 'changes' && !comment.trim()) return { ok: false, message: 'Tell us what to change.' };
  const r = await t4run(code, 'tk_decide_drawing', { p_version: versionId, p_decision: decision, p_comment: comment.trim().slice(0, 2000) || null });
  if (!r.ok) return { ok: false, message: r.message ?? '' };
  revalidatePath('/account/invoices');
  const d = r.data as { status: string; amount_cents?: number | null };
  return {
    ok: true,
    message: d.status === 'approved' ? 'Approved. Design is complete; we move on to sourcing.'
      : d.amount_cents ? 'Changes sent. The next version is an extra version: pay it below and we start it.' : 'Changes sent. We will share the next version here.',
  };
}

/** Accept a quote version (the deposit proforma is issued) or ask for changes. */
export async function decideQuoteAction(code: string, quoteId: string, decision: 'accept' | 'changes', comment: string): Promise<Done> {
  if (decision === 'changes' && !comment.trim()) return { ok: false, message: 'Tell us what to change.' };
  const r = await t4run(code, 'tk_decide_client_quote', { p_quote: quoteId, p_decision: decision, p_comment: comment.trim().slice(0, 2000) || null });
  if (!r.ok) return { ok: false, message: r.message ?? '' };
  revalidatePath('/account/invoices');
  return { ok: true, message: decision === 'accept' ? 'Quote accepted. Pay the deposit below; production starts after it is paid.' : 'Changes sent. We will send a new version.' };
}
