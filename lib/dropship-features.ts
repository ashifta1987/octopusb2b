import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  DROPSHIP_FEATURES,
  EARLY_ACCESS_DEFAULTS,
  type DropshipFeatureKey,
  type DropshipFeatures,
} from '@/lib/dropship-features-shared';

export { DROPSHIP_FEATURES, featureForPath, type DropshipFeatureKey, type DropshipFeatures } from '@/lib/dropship-features-shared';

/**
 * Release 1 · EA-2: the merchant feature list (site_settings.dropship_features, migration 222).
 * A missing row or a missing key falls back to the early-access set (live-safe). Same rule as dropship_feature_on().
 */
export const getDropshipFeatures = cache(async (): Promise<DropshipFeatures> => {
  const sb = await createClient();
  const { data } = await sb.from('site_settings').select('value').eq('key', 'dropship_features').maybeSingle();
  const raw = (data?.value ?? {}) as Partial<Record<DropshipFeatureKey, unknown>>;
  const out = {} as DropshipFeatures;
  for (const f of DROPSHIP_FEATURES) {
    out[f.key] = typeof raw[f.key] === 'boolean' ? (raw[f.key] as boolean) : EARLY_ACCESS_DEFAULTS[f.key];
  }
  return out;
});

/** Countries for the public Dropship page (ISO-2). Empty = that answer is hidden. */
export async function getDropshipLaunchCountries(): Promise<string[]> {
  const sb = await createClient();
  const { data } = await sb.from('site_settings').select('value').eq('key', 'dropship_launch_countries').maybeSingle();
  return Array.isArray(data?.value) ? (data.value as unknown[]).filter((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c)) : [];
}
