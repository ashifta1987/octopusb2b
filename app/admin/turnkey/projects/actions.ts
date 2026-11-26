'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: boolean; message?: string; error?: string };
const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());

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
