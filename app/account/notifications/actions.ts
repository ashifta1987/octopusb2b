'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only links inside the site are followed after opening (a notification never sends the customer off-site). */
const safeLink = (l: unknown) => (typeof l === 'string' && l.startsWith('/') && !l.startsWith('//') ? l : null);

/**
 * "Mark all as read" — only the notifications the customer was shown: rows created up to `seen` (the newest row on the
 * page, as returned by the database), so a notification that arrives after the click stays unread (bug 1, 8 Nov 2026).
 */
export async function markNotificationsRead(fd?: FormData) {
  const s = await getSession();
  if (!s?.org || s.isStaff) return;
  const seen = String(fd?.get('seen') ?? '').trim();
  if (!seen || Number.isNaN(Date.parse(seen))) return;
  const sb = await createClient();
  // RLS (notif_upd): only my rows / my company's rows without a named recipient; only read_at is writable
  const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).lte('created_at', seen);
  if (error) throw new Error(`Could not mark notifications as read: ${error.message}`);
  revalidatePath('/account', 'layout');
}

/**
 * Opening a notification (Open → or the row): marks THAT notification read — only while read_at is still empty and only
 * if it is the caller's own (RLS) — and returns its link. The layout's count is revalidated, so the next render agrees.
 */
export async function openNotification(id: string): Promise<{ ok: boolean; link: string | null }> {
  const s = await getSession();
  if (!s?.org || s.isStaff || !UUID.test(id)) return { ok: false, link: null };
  const sb = await createClient();
  const { data: n } = await sb.rpc('my_notifications').select('id, link, read_at').eq('id', id).maybeSingle();
  if (!n) return { ok: false, link: null };
  if (!n.read_at) {
    const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
    if (error) return { ok: false, link: safeLink(n.link) };
  }
  revalidatePath('/account', 'layout');
  return { ok: true, link: safeLink(n.link) };
}
