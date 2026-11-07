'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';

export async function markNotificationsRead() {
  const s = await getSession();
  if (!s?.org || s.isStaff) return;
  const sb = await createClient();
  const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('org_id', s.org.id).is('read_at', null);
  if (error) throw new Error(`Could not mark notifications as read: ${error.message}`);
  revalidatePath('/account', 'layout');
}
