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
