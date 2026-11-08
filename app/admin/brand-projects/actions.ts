'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { actionSession, fail, ok, type Result } from '@/components/backoffice/server-utils';
import { brandStatusError } from '@/lib/brand-projects';

/**
 * Admin › Brand projects: move a project to another status (bug 2, 8 Nov 2026). Everything is decided and audited by
 * set_brand_project_status() in one transaction (staff only; close needs a reason; paid → admin only; reopen → admin,
 * back to the previous step). Returns the refund warning when a paid project was closed.
 */
export async function setBrandProjectStatus(id: string, to: string, reason: string | null): Promise<Result<{ warning: string | null }>> {
  const g = await actionSession();
  if ('error' in g) return fail(g.error);
  if (!g.s.isStaff) return fail('Staff only.');
  const sb = await createClient();
  const { data, error } = await sb.rpc('set_brand_project_status', { p_id: id, p_to: to, p_reason: reason });
  if (error) return fail(brandStatusError(error.message));
  revalidatePath('/admin/brand-projects');
  revalidatePath(`/admin/brand-projects/${id}`);
  const r = data as { ref: string; from: string; to: string; warning: string | null };
  return ok({ warning: r.warning }, `${r.ref}: ${r.from} → ${r.to}`);
}

