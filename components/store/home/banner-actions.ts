'use server';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';

/** Banner impressions / clicks (ADDON-32 §5). Best-effort, rate-limited per IP, region from the edge geo header. */
export async function logBannerEvent(bannerId: string | null, slot: string, event: 'impression' | 'click') {
  if (!['lead', 'side-pools', 'side-shipping', 'announcement'].includes(slot) || !['impression', 'click'].includes(event)) return;
  if (bannerId && !/^[0-9a-f-]{36}$/.test(bannerId)) return;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const region = (h.get('x-vercel-ip-country') ?? '').toUpperCase() || null;
  const admin = createAdminClient();
  try {
    if (ip) {
      const { data } = await admin.rpc('auth_rate_hit', { p_bucket: `banner:${ip}`, p_limit: 60, p_window_s: 60 });
      if (data && (data as { allowed: boolean }).allowed === false) return;
    }
    await admin.rpc('log_banner_event', { p_banner: bannerId, p_slot: slot, p_event: event, p_region: region });
  } catch { /* analytics never break the page */ }
}

