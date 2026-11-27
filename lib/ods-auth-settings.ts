import 'server-only';
import { getSiteContent } from '@/lib/content';
import { COUNTRY_NAMES } from '@/lib/format';

/**
 * ODS T3 · settings the sign-in pages read (one module, honest defaults). Owner fills them in Admin › Settings.
 *  - `signup_launch_countries` (new key, JSON array of ISO-2 codes, e.g. ["AE","SA","GB","US"]): shown first in the
 *    /welcome/setup country list under "Launch countries". Default [] → no such group; the full list is always below.
 *    (dropship_launch_countries is NOT reused: it lists where Dropshipping ships, not where customers may sign up.)
 */
export const SIGNUP_LAUNCH_COUNTRIES_KEY = 'signup_launch_countries';

export type CountryOption = { code: string; name: string };

export async function getSetupCountries(): Promise<{ launch: CountryOption[]; all: CountryOption[] }> {
  let raw: unknown = [];
  try {
    raw = (await getSiteContent()).settings[SIGNUP_LAUNCH_COUNTRIES_KEY] ?? [];
  } catch {
    raw = [];
  }
  const all = Object.entries(COUNTRY_NAMES)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const codes = Array.isArray(raw) ? [...new Set(raw.filter((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c)))] : [];
  const launch = codes.filter((c) => COUNTRY_NAMES[c]).map((code) => ({ code, name: COUNTRY_NAMES[code] }));
  return { launch, all };
}
