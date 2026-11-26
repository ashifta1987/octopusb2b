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
