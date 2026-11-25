'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DROPSHIP_FEATURES, type DropshipFeatures } from '@/lib/dropship-features-shared';

/** EA-2: Admin › Dropship features. Admin only; the database function checks again and writes the audit log. */
export async function saveDropshipFeaturesAction(features: DropshipFeatures): Promise<{ ok: boolean; message?: string; error?: string }> {
  const s = await getSession();
  if (!s?.isStaff || s.aal !== 'aal2' || !s.isAdmin) return { ok: false, error: 'Only an admin can change Dropship features.' };
  const clean = Object.fromEntries(DROPSHIP_FEATURES.map((f) => [f.key, Boolean(features[f.key])]));
  const sb = await createClient();
  const { error } = await sb.rpc('set_dropship_features', { p_features: clean });
  if (error) return { ok: false, error: error.message.replace(/^[A-Z_]+:\s*/, '') };
  revalidatePath('/admin/settings/dropship');
  revalidatePath('/account/dropship', 'layout');
  return { ok: true, message: 'Saved. Merchants see the change on their next page load.' };
}
