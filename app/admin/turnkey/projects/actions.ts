'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usdToCents } from '@/lib/turnkey/format';

type Result = { ok: boolean; message?: string; error?: string };
const clean = (m: string) => {
  if (/cover_not_owner/.test(m)) return 'The cover is this person now. Remove the cover first, or choose someone else.';
  return m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());
};

/** Every change goes through a tk_* database function, which checks the Turnkey edit permission, the TK division and 2FA again. */
async function run(code: string, fn: string, args: Record<string, unknown>, message: string): Promise<Result> {
  const path = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', path);
  const sb = await createClient();
  const { error } = await sb.rpc(fn, args);
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(path);
  revalidatePath('/admin/turnkey/projects');
  return { ok: true, message };
}

export async function moveStageAction(projectId: string, code: string, toStage: string, message: string) {
  return run(code, 'tk_move_project_stage', { p_project: projectId, p_to_stage: toStage, p_message: message.trim() || null }, 'Phase changed. The client sees it now.');
}

export async function setStatusAction(projectId: string, code: string, status: string, reason: string) {
  return run(code, 'tk_set_project_status', { p_project: projectId, p_status: status, p_reason: reason.trim() || null }, 'Status changed.');
}

export async function setStageDueAction(projectId: string, code: string, stage: string, due: string) {
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: 'Choose a date.' };
  return run(code, 'tk_set_stage_due', { p_project: projectId, p_stage: stage, p_due: due || null }, due ? 'Target date saved.' : 'Target date removed.');
}

export async function setManagerAction(projectId: string, code: string, userId: string) {
  return run(code, 'tk_set_project_manager', { p_project: projectId, p_user: userId || null }, userId ? 'Account manager saved.' : 'Account manager removed.');
}

/* ───────── T3: account manager cover ───────── */
export async function setCoverAction(projectId: string, code: string, userId: string, from: string, to: string) {
  if (userId && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))) return { ok: false, error: 'Choose the first and the last day of the cover.' };
  return run(code, 'tk_set_project_cover', { p_project: projectId, p_user: userId || null, p_from: userId ? from : null, p_to: userId ? to : null },
    userId ? 'Cover saved. The client sees the cover during these days.' : 'Cover removed.');
}

/* ───────── T3: fees (SetFee; above 2× the starting fee one admin approves) ───────── */
export async function proposeFeeAction(projectId: string, code: string, stage: string, service: string, amountUsd: string, note: string): Promise<Result> {
  const path = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', path);
  const cents = usdToCents(amountUsd);
  if (cents == null || Number.isNaN(cents) || cents <= 0) return { ok: false, error: 'Enter the fee in US dollars, for example 150.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_propose_fee', { p_project: projectId, p_stage: stage, p_service: service || null, p_amount_cents: cents, p_note: note.trim() || null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(path);
  revalidatePath('/admin/turnkey/projects');
  revalidatePath('/admin/turnkey/approvals');
  const r = data as { status: string; needs_approval: boolean };
  return {
    ok: true,
    message: r.status === 'active' ? 'Fee set. It is within 2× the starting fee, so it is active now and the client can pay it.'
      : 'Fee proposed. It is above 2× the starting fee (or has none), so an admin who is not you must approve it before the client sees it.',
  };
}

export async function withdrawFeeAction(feeId: string, code: string) {
  return run(code, 'tk_withdraw_fee', { p_fee: feeId }, 'Proposal withdrawn. It stays in the history.');
}

/** Admins only (the database checks again: admin on 2FA, never the person who proposed the fee). */
export async function decideFeeAction(feeId: string, code: string, decision: 'approve' | 'reject', reason: string): Promise<Result> {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/approvals');
  if (!s.isAdmin) redirect('/forbidden');
  if (decision === 'reject' && !reason.trim()) return { ok: false, error: 'Tell the team why the fee is rejected.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_decide_fee', { p_fee: feeId, p_decision: decision, p_reason: reason.trim() || null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/turnkey/approvals');
  if (/^TKP-\d{5,}$/.test(code)) revalidatePath(`/admin/turnkey/projects/${code}`);
  return { ok: true, message: decision === 'reject' ? 'Fee rejected. The team sees your reason.' : 'Fee approved. It is active and the client can pay it now.' };
}

/* ───────── T4: layout drawings ───────── */
/**
 * Registers a drawing file the browser has just uploaded to the private bucket (turnkey-drawings/<project id>/…) as the
 * next version. The database checks the file is really in the bucket (type and size from storage), the phase, the free
 * versions and the extra-version payment. If it refuses, the uploaded file is removed again (storage policy: an
 * unregistered file in a project in Design may be removed by its editor).
 */
export async function registerDrawingAction(projectId: string, code: string, path: string, fileName: string, message: string): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !path.startsWith(`${projectId}/`)) return { ok: false, error: 'Upload the file again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_add_drawing_version', { p_project: projectId, p_path: path, p_file_name: fileName.slice(0, 200), p_message: message.trim() || null });
  if (error) {
    await sb.storage.from('turnkey-drawings').remove([path]);
    return { ok: false, error: clean(error.message) };
  }
  revalidatePath(p);
  return { ok: true, message: `Version ${(data as { version: number }).version} shared. The client can review it now.` };
}

export async function staffDrawingCommentAction(versionId: string, code: string, body: string) {
  if (!body.trim()) return { ok: false, error: 'Write a comment first.' };
  return run(code, 'tk_comment_drawing', { p_version: versionId, p_body: body.trim() }, 'Comment sent. The client sees it.');
}

/** Admins only (the database checks again: admin on 2FA, a reason, nothing paid yet). */
export async function waiveDrawingFeeAction(extraId: string, code: string, reason: string): Promise<Result> {
  const s = await requireStaff('turnkey', 'view', `/admin/turnkey/projects/${code}`);
  if (!s.isAdmin) return { ok: false, error: 'Only admins can waive an extra version charge.' };
  if (!reason.trim()) return { ok: false, error: 'Tell the team why there is no charge.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_waive_drawing_fee', { p_extra: extraId, p_reason: reason.trim() });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(`/admin/turnkey/projects/${code}`);
  return { ok: true, message: 'Charge waived. Its proforma is cancelled; you can upload the version now.' };
}

/* ───────── T4: quotes (white-label: supplier and cost stay staff-only) ───────── */
export type FactoryLineInput = { description: string; qty: string; unitCostUsd: string };
export type ClientLineInput = { description: string; qty: string; unitPriceUsd: string; factoryLineId: string; unitCostUsd: string };

const qtyOf = (v: string) => (/^\d{1,7}$/.test(v.trim()) ? Number(v.trim()) : null);

export async function addFactoryQuoteAction(projectId: string, code: string, supplier: string, ref: string, validUntil: string, notes: string, lines: FactoryLineInput[]): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  if (!supplier.trim()) return { ok: false, error: 'Enter the factory name.' };
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { ok: false, error: 'Choose a valid-until date.' };
  const rows = lines.filter((l) => l.description.trim() || l.qty.trim() || l.unitCostUsd.trim());
  if (!rows.length) return { ok: false, error: 'Add at least one line.' };
  const out = [];
  for (const [i, l] of rows.entries()) {
    const qty = qtyOf(l.qty); const cost = usdToCents(l.unitCostUsd);
    if (!l.description.trim() || qty == null || cost == null || Number.isNaN(cost)) return { ok: false, error: `Line ${i + 1}: enter a description, a whole quantity and the unit cost in US dollars.` };
    out.push({ description: l.description.trim(), qty, unit_cost_cents: cost });
  }
  const sb = await createClient();
  const { error } = await sb.rpc('tk_add_factory_quote', { p_project: projectId, p_supplier_name: supplier.trim(), p_supplier_ref: ref.trim() || null, p_valid_until: validUntil || null, p_notes: notes.trim() || null, p_lines: out });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(p);
  return { ok: true, message: 'Factory quote saved (staff only).' };
}

export async function saveClientQuoteAction(projectId: string, code: string, message: string, validUntil: string, lines: ClientLineInput[]): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { ok: false, error: 'Choose a valid-until date.' };
  const rows = lines.filter((l) => l.description.trim() || l.qty.trim() || l.unitPriceUsd.trim());
  if (!rows.length) return { ok: false, error: 'Add at least one line.' };
  const out = [];
  for (const [i, l] of rows.entries()) {
    const qty = qtyOf(l.qty); const price = usdToCents(l.unitPriceUsd); const cost = usdToCents(l.unitCostUsd);
    if (!l.description.trim() || qty == null || price == null || Number.isNaN(price) || price <= 0) return { ok: false, error: `Line ${i + 1}: enter a description, a whole quantity and the unit price in US dollars (above 0).` };
    if (Number.isNaN(cost)) return { ok: false, error: `Line ${i + 1}: the cost must be in US dollars, for example 1200.` };
    out.push({ description: l.description.trim(), qty, unit_price_cents: price, factory_line_id: l.factoryLineId || null, unit_cost_cents: cost });
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_save_client_quote', { p_project: projectId, p_message: message.trim() || null, p_valid_until: validUntil || null, p_lines: out });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(p);
  return { ok: true, message: `Draft of version ${(data as { version: number }).version} saved. The client sees it after you send it.` };
}

export async function sendClientQuoteAction(quoteId: string, code: string) {
  return run(code, 'tk_send_client_quote', { p_quote: quoteId }, 'Quote sent. The client can accept it now; the deposit % is fixed on this version.');
}
export async function discardQuoteDraftAction(quoteId: string, code: string) {
  return run(code, 'tk_discard_quote_draft', { p_quote: quoteId }, 'Draft discarded.');
}
export async function withdrawClientQuoteAction(quoteId: string, code: string, reason: string) {
  if (!reason.trim()) return { ok: false, error: 'Tell the client why.' };
  return run(code, 'tk_withdraw_client_quote', { p_quote: quoteId, p_reason: reason.trim() }, 'Quote withdrawn. The client sees your reason.');
}

/** Admins only: the deposit % of new quotes (setting turnkey.deposit_pct; D5). */
export async function setDepositPctAction(pct: string): Promise<Result> {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey?tab=services');
  if (!s.isAdmin) return { ok: false, error: 'Only admins set the deposit.' };
  if (!/^\d{1,3}$/.test(pct.trim()) || Number(pct) < 1 || Number(pct) > 100) return { ok: false, error: 'Enter a whole percentage from 1 to 100.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_set_deposit_pct', { p_pct: Number(pct) });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/turnkey');
  return { ok: true, message: `Deposit set to ${Number(pct)}%. It applies to quotes sent from now on.` };
}

/* ───────── T5: Production and QC inspections (each paid before it starts; white-label reports) ───────── */
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Plans an inspection: kind, factory (staff and the inspector only), brief and one checklist line per text line. */
export async function createInspectionAction(projectId: string, code: string, kind: string, factory: string, address: string, brief: string, checklist: string, usePhaseFee: boolean): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  if (!factory.trim()) return { ok: false, error: 'Enter the factory (staff and the inspector only).' };
  const items = checklist.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!items.length) return { ok: false, error: 'Add at least one checklist line (one per line).' };
  if (items.length > 100) return { ok: false, error: 'Up to 100 checklist lines.' };
  if (items.some((l) => l.length > 300)) return { ok: false, error: 'Keep each checklist line under 300 characters.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_create_inspection', {
    p_project: projectId, p_kind: kind, p_factory_name: factory.trim(), p_factory_address: address.trim() || null, p_brief: brief.trim() || null,
    p_items: items, p_use_phase_fee: usePhaseFee,
  });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(p);
  const r = data as { round: number; covered_by_phase_fee: boolean };
  return { ok: true, message: r.covered_by_phase_fee ? 'Planned. It is covered by the paid Production and QC fee, so you can schedule it now.' : 'Planned. Set its fee next: the client pays it before the inspection is scheduled.' };
}

export async function proposeInspectionFeeAction(inspectionId: string, code: string, amountUsd: string, note: string): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  const cents = usdToCents(amountUsd);
  if (cents == null || Number.isNaN(cents) || cents <= 0) return { ok: false, error: 'Enter the fee in US dollars, for example 249.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_propose_inspection_fee', { p_inspection: inspectionId, p_amount_cents: cents, p_note: note.trim() || null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(p);
  revalidatePath('/admin/turnkey/approvals');
  return {
    ok: true,
    message: (data as { status: string }).status === 'active' ? 'Fee set. It is within 2× the starting fee, so it is active now and the client can pay it.'
      : 'Fee proposed. It is above 2× the starting fee, so an admin who is not you must approve it before the client sees it.',
  };
}

export async function withdrawInspectionFeeAction(feeId: string, code: string) {
  return run(code, 'tk_withdraw_inspection_fee', { p_fee: feeId }, 'Proposal withdrawn. It stays in the history.');
}

/** Admins only (the database checks again: admin on 2FA, never the person who proposed the fee). */
export async function decideInspectionFeeAction(feeId: string, code: string, decision: 'approve' | 'reject', reason: string): Promise<Result> {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/approvals');
  if (!s.isAdmin) return { ok: false, error: 'Only admins approve or reject fees.' };
  if (decision === 'reject' && !reason.trim()) return { ok: false, error: 'Tell the team why the fee is rejected.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_decide_inspection_fee', { p_fee: feeId, p_decision: decision, p_reason: reason.trim() || null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/turnkey/approvals');
  if (/^TKP-\d{5,}$/.test(code)) revalidatePath(`/admin/turnkey/projects/${code}`);
  return { ok: true, message: decision === 'reject' ? 'Fee rejected. The team sees your reason.' : 'Fee approved. It is active and the client can pay it now.' };
}

export async function scheduleInspectionAction(inspectionId: string, code: string, inspectorId: string, on: string) {
  if (!isUuid(inspectorId)) return { ok: false, error: 'Choose the inspector.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { ok: false, error: 'Choose the date.' };
  return run(code, 'tk_schedule_inspection', { p_inspection: inspectionId, p_inspector: inspectorId, p_on: on }, 'Scheduled. The inspector sees it on their phone; the client sees the date.');
}

export async function cancelInspectionAction(inspectionId: string, code: string, reason: string) {
  if (!reason.trim()) return { ok: false, error: 'Tell the team why.' };
  return run(code, 'tk_cancel_inspection', { p_inspection: inspectionId, p_reason: reason.trim() }, 'Inspection cancelled. An unpaid proforma is cancelled too.');
}

export async function returnInspectionAction(inspectionId: string, code: string, reason: string) {
  if (!reason.trim()) return { ok: false, error: 'Tell the inspector what to check.' };
  return run(code, 'tk_return_inspection', { p_inspection: inspectionId, p_reason: reason.trim() }, 'Returned to the inspector.');
}

/** Another Turnkey editor (never the inspector) publishes the report: the client summary, and which photos stay hidden. */
export async function publishInspectionAction(inspectionId: string, code: string, summary: string, hidePhotos: string[]) {
  if (!summary.trim()) return { ok: false, error: 'Write the summary the client reads.' };
  if (hidePhotos.some((x) => !isUuid(x))) return { ok: false, error: 'Reload the page and try again.' };
  return run(code, 'tk_publish_inspection', { p_inspection: inspectionId, p_summary: summary.trim(), p_hide_photos: hidePhotos }, 'Report published. The client sees it now.');
}

/** Admins only, never the inspector of that inspection (the database checks both again). */
export async function overridePsiAction(inspectionId: string, code: string, reason: string): Promise<Result> {
  const s = await requireStaff('turnkey', 'view', `/admin/turnkey/projects/${code}`);
  if (!s.isAdmin) return { ok: false, error: 'Only admins can override a failed inspection.' };
  if (!reason.trim()) return { ok: false, error: 'Tell the team why shipment may go ahead.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_override_psi', { p_inspection: inspectionId, p_reason: reason.trim() });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(`/admin/turnkey/projects/${code}`);
  return { ok: true, message: 'Override saved. The project can move to Shipment.' };
}

/* ───────── T6: balance, shipments, documents, trips and handover ───────── */
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Issues the balance of the accepted quote (total − deposit) once the deposit is paid; Shipment starts after it is paid. */
export async function issueBalanceAction(projectId: string, code: string) {
  return run(code, 'tk_issue_balance_invoice', { p_project: projectId }, 'Balance invoice issued. The client sees it with Pay; Shipment starts after it is paid.');
}

export type ShipmentInput = { mode: string; carrier: string; bookingRef: string; containerNo: string; trackingNo: string; origin: string; destination: string; etd: string; eta: string; staffNote: string };
const shipmentArgs = (s: ShipmentInput) => ({
  p_carrier: s.carrier.trim(), p_booking_ref: s.bookingRef.trim() || null, p_container_no: s.containerNo.trim() || null, p_tracking_no: s.trackingNo.trim() || null,
  p_origin: s.origin.trim() || null, p_destination: s.destination.trim() || null, p_etd: s.etd || null, p_eta: s.eta || null, p_staff_note: s.staffNote.trim() || null,
});

export async function createShipmentAction(projectId: string, code: string, s: ShipmentInput) {
  if (!s.carrier.trim()) return { ok: false, error: 'Enter the carrier or forwarder.' };
  if ((s.etd && !isDate(s.etd)) || (s.eta && !isDate(s.eta))) return { ok: false, error: 'Choose the dates again.' };
  return run(code, 'tk_create_shipment', { p_project: projectId, p_mode: s.mode, ...shipmentArgs(s) }, 'Shipment booked. The client sees the carrier, references and dates.');
}

export async function updateShipmentAction(shipmentId: string, code: string, s: ShipmentInput) {
  if (!s.carrier.trim()) return { ok: false, error: 'Enter the carrier or forwarder.' };
  if ((s.etd && !isDate(s.etd)) || (s.eta && !isDate(s.eta))) return { ok: false, error: 'Choose the dates again.' };
  return run(code, 'tk_update_shipment', { p_shipment: shipmentId, ...shipmentArgs(s) }, 'Shipment updated.');
}

/** A tracking event; `at` is the browser's local date-time turned into ISO by the form. */
export async function addShipmentEventAction(shipmentId: string, code: string, atIso: string, status: string, location: string, description: string) {
  if (!description.trim()) return { ok: false, error: 'Say what happened.' };
  if (!atIso || Number.isNaN(Date.parse(atIso))) return { ok: false, error: 'Choose when it happened.' };
  return run(code, 'tk_add_shipment_event', { p_shipment: shipmentId, p_happened_at: atIso, p_status: status || null, p_location: location.trim() || null, p_description: description.trim() },
    'Tracking event added. The client sees it now.');
}

export async function cancelShipmentAction(shipmentId: string, code: string, reason: string) {
  if (!reason.trim()) return { ok: false, error: 'Tell the team why.' };
  return run(code, 'tk_cancel_shipment', { p_shipment: shipmentId, p_reason: reason.trim() }, 'Shipment cancelled.');
}

/**
 * Registers a shipping or final document the browser has just uploaded to the private bucket (turnkey-documents/<project
 * id>/…) as a DRAFT the client cannot see yet. If the database refuses, the uploaded file is removed again.
 */
export async function registerDocumentAction(projectId: string, code: string, section: string, kind: string, title: string, path: string, fileName: string, shipmentId: string): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  if (!isUuid(projectId) || !path.startsWith(`${projectId}/`)) return { ok: false, error: 'Upload the file again.' };
  if (shipmentId && !isUuid(shipmentId)) return { ok: false, error: 'Choose the shipment again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_add_project_document', {
    p_project: projectId, p_section: section, p_kind: kind, p_title: title.trim() || null, p_path: path, p_file_name: fileName.slice(0, 200), p_shipment: shipmentId || null,
  });
  if (error) {
    await sb.storage.from('turnkey-documents').remove([path]);
    return { ok: false, error: clean(error.message) };
  }
  revalidatePath(p);
  return { ok: true, message: 'Uploaded as a draft. Share it when it is right; the client sees shared documents only.' };
}

export async function releaseDocumentAction(documentId: string, code: string) {
  return run(code, 'tk_release_project_document', { p_document: documentId }, 'Shared. The client can open it now.');
}
export async function withdrawDocumentAction(documentId: string, code: string, reason: string) {
  if (!reason.trim()) return { ok: false, error: 'Tell the team why.' };
  return run(code, 'tk_withdraw_project_document', { p_document: documentId, p_reason: reason.trim() }, 'Withdrawn. The client no longer sees it.');
}
/** Removes a draft (never seen by the client) and its file. */
export async function removeDocumentAction(documentId: string, code: string): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_remove_project_document', { p_document: documentId });
  if (error) return { ok: false, error: clean(error.message) };
  if (typeof data === 'string' && data) await sb.storage.from('turnkey-documents').remove([data]);
  revalidatePath(p);
  return { ok: true, message: 'Draft removed.' };
}

export async function addHandoverItemAction(projectId: string, code: string, label: string) {
  if (!label.trim()) return { ok: false, error: 'Name the document or step.' };
  return run(code, 'tk_add_handover_item', { p_project: projectId, p_label: label.trim() }, 'Checklist line added. The client sees it.');
}
export async function setHandoverItemAction(itemId: string, code: string, done: boolean, documentId: string) {
  if (documentId && !isUuid(documentId)) return { ok: false, error: 'Choose the document again.' };
  return run(code, 'tk_set_handover_item_done', { p_item: itemId, p_done: done, p_document: done && documentId ? documentId : null }, done ? 'Marked ready.' : 'Marked not ready.');
}
export async function removeHandoverItemAction(itemId: string, code: string) {
  return run(code, 'tk_remove_handover_item', { p_item: itemId }, 'Line removed.');
}

/* trips */
export async function proposeTripFeeAction(tripId: string, code: string, amountUsd: string, note: string): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  const cents = usdToCents(amountUsd);
  if (cents == null || Number.isNaN(cents) || cents <= 0) return { ok: false, error: 'Enter the fee in US dollars, for example 1880.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_propose_trip_fee', { p_trip: tripId, p_amount_cents: cents, p_note: note.trim() || null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(p);
  revalidatePath('/admin/turnkey/approvals');
  return {
    ok: true,
    message: (data as { status: string }).status === 'active' ? 'Fee set. It is within 2× the list price, so it is active now and the client can pay it.'
      : 'Fee proposed. It is above 2× the list price, so an admin who is not you must approve it before the client sees it.',
  };
}
export async function withdrawTripFeeAction(feeId: string, code: string) {
  return run(code, 'tk_withdraw_trip_fee', { p_fee: feeId }, 'Proposal withdrawn. It stays in the history.');
}
/** Admins only (the database checks again: admin on 2FA, never the person who proposed the fee). */
export async function decideTripFeeAction(feeId: string, code: string, decision: 'approve' | 'reject', reason: string): Promise<Result> {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/approvals');
  if (!s.isAdmin) return { ok: false, error: 'Only admins approve or reject fees.' };
  if (decision === 'reject' && !reason.trim()) return { ok: false, error: 'Tell the team why the fee is rejected.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_decide_trip_fee', { p_fee: feeId, p_decision: decision, p_reason: reason.trim() || null });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/turnkey/approvals');
  if (/^TKP-\d{5,}$/.test(code)) revalidatePath(`/admin/turnkey/projects/${code}`);
  return { ok: true, message: decision === 'reject' ? 'Fee rejected. The team sees your reason.' : 'Fee approved. It is active and the client can pay it now.' };
}
export async function confirmTripAction(tripId: string, code: string, itinerary: string, guide: string, notes: string) {
  if (!itinerary.trim()) return { ok: false, error: 'Write the itinerary the client sees.' };
  return run(code, 'tk_confirm_trip', { p_trip: tripId, p_itinerary: itinerary.trim(), p_guide_name: guide.trim() || null, p_staff_notes: notes.trim() || null },
    'Saved. The client sees the itinerary now.');
}
export async function completeTripAction(tripId: string, code: string, report: string) {
  return run(code, 'tk_complete_trip', { p_trip: tripId, p_report: report.trim() || null }, 'Trip closed. The client sees the trip report.');
}
export async function cancelTripStaffAction(tripId: string, code: string, reason: string) {
  if (!reason.trim()) return { ok: false, error: 'Tell the client why.' };
  return run(code, 'tk_cancel_trip', { p_trip: tripId, p_reason: reason.trim() }, 'Trip cancelled. An unpaid proforma is cancelled too.');
}
/** Staff with a need delete a passport copy on the client's request (row first, then the file). */
export async function deletePassportStaffAction(travellerId: string, code: string): Promise<Result> {
  const p = `/admin/turnkey/projects/${code}`;
  await requireStaff('turnkey', 'edit', p);
  if (!isUuid(travellerId)) return { ok: false, error: 'Reload the page and try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_delete_trip_passport', { p_id: travellerId });
  if (error) return { ok: false, error: clean(error.message) };
  if (typeof data === 'string' && data) await sb.storage.from('turnkey-passports').remove([data]);
  revalidatePath(p);
  return { ok: true, message: 'Passport copy deleted.' };
}
