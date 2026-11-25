'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';

type R = { ok: boolean; message?: string; error?: string };
const clean = (m: string): R => ({ ok: false, error: m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase()) });

export async function saveChecksAction(id: string, checks: { documents: boolean; dangerous: boolean; terms: boolean; plan: string | null }): Promise<R> {
  await requireWarehouseStaff('/office/warehouse/clients');
  const sb = await createClient();
  const { error } = await sb.rpc('wh_review_application', { p_id: id, p_documents: checks.documents, p_dangerous_goods: checks.dangerous, p_terms_sent: checks.terms, p_plan: checks.plan });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/clients');
  return { ok: true, message: 'Checks saved.' };
}

export async function decideAction(id: string, decision: 'approve' | 'decline', reason?: string): Promise<R> {
  await requireWarehouseStaff('/office/warehouse/clients');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_decide_application', { p_id: id, p_decision: decision, p_reason: reason ?? null });
  if (error) return clean(error.message);
  revalidatePath('/office/warehouse/clients');
  const d = data as { status: string; linked?: boolean };
  return { ok: true, message: d.status === 'declined' ? 'Declined.' : d.linked ? 'Approved. The client’s portal is open.' : 'Approved. The portal opens when they sign in with this email.' };
}
