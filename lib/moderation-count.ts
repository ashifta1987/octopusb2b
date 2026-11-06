'use server';
import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Pending moderation (7 Nov 2026): products submitted or in review, not archived. Shown as a red count next to
 * "Moderation" in the staff side panel. Only for staff who can approve products; read with their RLS client.
 * Returns null when the caller may not see it.
 */
export async function moderationPendingCount(): Promise<number | null> {
  const s = await getSession();
  if (!s || !can(s, 'products', 'approve')) return null;
  const sb = await createClient();
  const { count, error } = await sb.from('products').select('id', { count: 'exact', head: true })
    .in('status', ['submitted', 'in_review']).is('archived_at', null);
  return error ? null : count ?? 0;
}

