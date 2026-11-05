import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

/**
 * Social sign-in providers shown on the CUSTOMER /login and /signup (never on /staff/login).
 * A provider is offered only when BOTH the CMS setting `auth.social_providers` lists it AND it is enabled in
 * Supabase Auth → Providers — so the button appears by itself once Google is configured in Supabase.
 */
export async function getCustomerSocialProviders(): Promise<{ google: boolean }> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('site-content');
  try {
    const { data } = await createPublicClient().from('site_settings').select('value').eq('key', 'auth.social_providers').maybeSingle();
    const wanted = Array.isArray(data?.value) ? (data!.value as string[]) : [];
    if (!wanted.includes('google')) return { google: false };
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } });
    const s = (await r.json()) as { external?: { google?: boolean } };
    return { google: s.external?.google === true };
  } catch {
    return { google: false };
  }
}
