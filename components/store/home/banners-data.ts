import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

/** CMS home banners (ADDON-32). Public read = active rows (RLS); the date window is applied here. Cached 5 min. */
export type HomeBanner = {
  id: string; eyebrow: string | null; title: string; body: string | null; cta_label: string | null; cta_href: string | null;
  cta2_label: string | null; cta2_href: string | null; ticks: string[]; theme: 'navy' | 'blue' | 'light'; image_url: string | null;
  show_open_project: boolean; starts_at: string | null; ends_at: string | null; sort: number;
};

export async function getHomeBanners(): Promise<HomeBanner[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('home-banners');
  const { data } = await createPublicClient().from('home_banners').select('*').eq('active', true).eq('position', 'lead').order('sort').limit(10);
  const now = Date.now();
  return ((data ?? []) as HomeBanner[])
    .filter((b) => (!b.starts_at || new Date(b.starts_at).getTime() <= now) && (!b.ends_at || new Date(b.ends_at).getTime() > now))
    .slice(0, 3);
}

