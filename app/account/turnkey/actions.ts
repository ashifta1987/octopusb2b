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
