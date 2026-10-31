'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES, mapDbError, toCents } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

const PATH = '/account/ads';

const CampaignInput = z.object({
  name: z.string().trim().min(2, 'Campaign name is too short.').max(80),
  placement: z.string().trim().min(1, 'Choose where the ad shows.'),
  headline: z.string().trim().min(3, 'Headline is too short.').max(45, 'Headline: max 45 characters.'),
  body: z.string().trim().max(80, 'Short line: max 80 characters.').optional().default(''),
  link: z.string().trim().max(500).refine(
    (v) => (v.startsWith('/') && !v.startsWith('//')) || /^https:\/\/[^\s]+$/i.test(v),
    'Link must be a path on our site (starting with /) or an https:// URL.',
  ),
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Countries must be ISO-2 codes.')).max(60).default([]),
  daily_budget_usd: z.union([z.string(), z.number()]),
  max_cpc_usd: z.union([z.string(), z.number()]),
});

export type CampaignFormInput = z.input<typeof CampaignInput>;

export async function createCampaign(input: CampaignFormInput): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: 'Please sign in again.' };
  if (!s.org) return { ok: false, error: 'Please complete your company profile first.' };
  const parsed = CampaignInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const unknown = d.countries.filter((c) => !COUNTRY_NAMES[c]);
  if (unknown.length) return { ok: false, error: `Unknown country code: ${unknown.join(', ')}` };

  const daily = toCents(d.daily_budget_usd);
  const cpc = toCents(d.max_cpc_usd);
  if (!Number.isFinite(daily) || daily < 100) return { ok: false, error: 'Daily budget must be at least $1.00.' };
  if (!Number.isFinite(cpc) || cpc <= 0) return { ok: false, error: 'Enter a valid bid per click.' };
  if (cpc > daily) return { ok: false, error: 'Bid per click cannot exceed the daily budget.' };

  const sb = await createClient();
  const [{ data: placement }, { data: setting }] = await Promise.all([
    sb.from('ad_placements').select('code, min_cpc_cents').eq('code', d.placement).maybeSingle(),
    sb.from('site_settings').select('value').eq('key', 'ads_enabled').maybeSingle(),
  ]);
  const enabled = setting?.value === true || setting?.value === 'true';
  if (!enabled) return { ok: false, error: 'Advertising is switched off right now.' };
  if (!placement) return { ok: false, error: 'Unknown placement.' };
  const min = Number(placement.min_cpc_cents);
  if (cpc < min) return { ok: false, error: `Bid must be at least $${(min / 100).toFixed(2)} per click for this placement.` };

  const { error } = await sb.from('ad_campaigns').insert({
    org_id: s.org.id,
    name: d.name,
    placement: placement.code,
    headline: d.headline,
    body: d.body || null,
    link: d.link,
    target_countries: [...new Set(d.countries)],
    daily_budget_cents: daily,
    max_cpc_cents: cpc,
    status: 'in_review',
    created_by: s.userId,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(PATH);
  return { ok: true };
}

/** Customers may only pause their own live campaign; resuming goes through review (staff). */
export async function pauseCampaign(id: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: 'Please sign in again.' };
  if (!s.org) return { ok: false, error: 'Please complete your company profile first.' };
  const sb = await createClient();
  const { data, error } = await sb.from('ad_campaigns').update({ status: 'paused' })
    .eq('id', id).eq('org_id', s.org.id).eq('status', 'active').select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'Only active campaigns can be paused.' };
  revalidatePath(PATH);
  return { ok: true };
}
