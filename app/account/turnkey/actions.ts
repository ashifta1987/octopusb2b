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

/* ───────── T6: China visit, passport copies and the handover sign-off (the database checks the client's company again) ───────── */
const T6_ERR: [RegExp, string][] = [
  [/TRIP_OPEN/, 'You already have an open China visit for this project.'],
  [/INVALID_DATES/, 'Choose dates from tomorrow on, with the last day on or after the first.'],
  [/TRIP_TOO_LONG/, 'A visit lasts at most 30 days.'],
  [/INVALID_TRAVELLERS/, 'From 1 to 20 travellers.'],
  [/INVALID_EXTRAS/, 'Check the extras: one visa letter per traveller at most, car days within the visit, up to 10 pick-ups.'],
  [/SERVICE_UNAVAILABLE|EXTRA_UNAVAILABLE/, 'This option is not offered at the moment. Please contact your account manager.'],
  [/FEE_PAID_LOCKED/, 'You have paid for this visit, so it cannot be cancelled here. Please contact your account manager.'],
  [/TRIP_CLOSED/, 'This visit is completed or cancelled. Reload the page.'],
  [/TRAVELLER_DONE/, 'This traveller already has a passport copy. Delete it first to upload a new one.'],
  [/INVALID_TRAVELLER/, 'Choose one of the travellers of this visit.'],
  [/NAME_REQUIRED/, 'Type the full name.'],
  [/INVALID_FILE_TYPE/, 'Upload a PDF, JPG, PNG or WEBP file.'],
  [/INVALID_FILE_SIZE/, 'Files can be up to 10 MB.'],
  [/FILE_NOT_UPLOADED|INVALID_FILE/, 'The upload did not finish. Please try again.'],
  [/CHECKLIST_EMPTY/, 'We are still preparing your final documents.'],
  [/CHECKLIST_OPEN/, 'Some final documents are not ready yet.'],
  [/SHIPMENT_NOT_DELIVERED/, 'A shipment is not delivered yet.'],
  [/ALREADY_SIGNED/, 'The handover is already signed. Reload the page.'],
  [/NOT_AT_HANDOVER/, 'You sign when the project reaches Handover.'],
  [/REASON_REQUIRED/, 'Tell us why.'],
  [/PROJECT_NOT_OPEN/, 'This project is not open at the moment.'],
];
const t6msg = (m: string) => T6_ERR.find(([r]) => r.test(m))?.[1] ?? 'That did not work. Please try again or contact us.';

async function t6run(code: string, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const s = await requireCustomer(/^TKP-\d{5,}$/.test(code) ? `/account/turnkey/${code}` : '/account/turnkey');
  if (!s.org) return { ok: false, message: 'Complete your company profile first.' };
  if (!/^TKP-\d{5,}$/.test(code)) return { ok: false, message: 'Something is missing. Reload the page and try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: t6msg(error.message) };
  revalidatePath(`/account/turnkey/${code}`);
  return { ok: true, data };
}
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const whole = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;

export type TripRequestInput = { start: string; end: string; travellers: number; visaLetters: number; carDays: number; airportPickups: number; hotelHelp: boolean; message: string };

/** Ask for a China visit; the database prices it from the services list (staff then set the exact fee). */
export async function requestTripAction(code: string, projectId: string, t: TripRequestInput): Promise<Done> {
  if (!isDay(t.start) || !isDay(t.end)) return { ok: false, message: 'Choose the first and the last day of the visit.' };
  if (!whole(t.travellers, 20) || t.travellers < 1 || !whole(t.visaLetters, 20) || !whole(t.carDays, 30) || !whole(t.airportPickups, 10)) return { ok: false, message: 'Check the numbers.' };
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { ok: false, message: 'Reload the page and try again.' };
  const r = await t6run(code, 'tk_request_trip', {
    p_project: projectId, p_start: t.start, p_end: t.end, p_travellers: t.travellers, p_visa_letters: t.visaLetters, p_car_days: t.carDays,
    p_airport_pickups: t.airportPickups, p_hotel_help: !!t.hotelHelp, p_message: t.message.trim().slice(0, 2000) || null,
  });
  return { ok: r.ok, message: r.ok ? 'Request sent. We confirm the exact fee here; your trip is confirmed after you pay it.' : r.message ?? '' };
}

/** Cancel a visit before anything is paid. */
export async function cancelTripAction(code: string, tripId: string, reason: string): Promise<Done> {
  if (!reason.trim()) return { ok: false, message: 'Tell us why.' };
  const r = await t6run(code, 'tk_cancel_trip', { p_trip: tripId, p_reason: reason.trim().slice(0, 500) });
  if (r.ok) revalidatePath('/account/invoices');
  return { ok: r.ok, message: r.ok ? 'Visit cancelled.' : r.message ?? '' };
}

/**
 * Registers a passport copy the browser has just uploaded to the private bucket (turnkey-passports/<project>/<trip>/<id>.<ext>).
 * If the database refuses, the uploaded file is removed again (storage policy: an unregistered file, by the client).
 */
export async function registerPassportAction(code: string, travellerId: string, tripId: string, position: number, fullName: string, path: string): Promise<Done> {
  if (!/^[0-9a-f-]{36}$/i.test(travellerId) || !/^[0-9a-f-]{36}$/i.test(tripId) || !path.includes(`/${tripId}/${travellerId}.`)) return { ok: false, message: 'The upload did not finish. Please try again.' };
  if (!fullName.trim()) return { ok: false, message: 'Type the name as in the passport.' };
  const r = await t6run(code, 'tk_add_trip_passport', { p_id: travellerId, p_trip: tripId, p_position: position, p_full_name: fullName.trim().slice(0, 120), p_path: path });
  if (!r.ok) {
    const sb = await createClient();
    await sb.storage.from('turnkey-passports').remove([path]);
  }
  return { ok: r.ok, message: r.ok ? 'Passport copy saved. Only your company and the team arranging your visit can open it.' : r.message ?? '' };
}

/** Delete a passport copy on request: the record first (audited), then the file. */
export async function deletePassportAction(code: string, travellerId: string): Promise<Done> {
  if (!/^[0-9a-f-]{36}$/i.test(travellerId)) return { ok: false, message: 'Reload the page and try again.' };
  const r = await t6run(code, 'tk_delete_trip_passport', { p_id: travellerId });
  if (r.ok && typeof r.data === 'string' && r.data) {
    const sb = await createClient();
    await sb.storage.from('turnkey-passports').remove([r.data]);
  }
  return { ok: r.ok, message: r.ok ? 'Passport copy deleted.' : r.message ?? '' };
}

/** Sign the handover with the typed full name: the project is completed. */
export async function signHandoverAction(code: string, projectId: string, signedName: string, comment: string): Promise<Done> {
  if (signedName.trim().length < 2) return { ok: false, message: 'Type your full name to sign.' };
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { ok: false, message: 'Reload the page and try again.' };
  const r = await t6run(code, 'tk_sign_handover', { p_project: projectId, p_signed_name: signedName.trim().slice(0, 120), p_comment: comment.trim().slice(0, 1000) || null });
  if (r.ok) revalidatePath('/account/turnkey');
  return { ok: r.ok, message: r.ok ? 'Handover signed. Your project is completed — thank you.' : r.message ?? '' };
}
