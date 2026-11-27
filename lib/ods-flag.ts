import { cache } from 'react';

/**
 * ODS 1.0 theme switch (NEW-THEME-MASTER-PROMPT Part 9, owner decision C9, 27 Nov 2026).
 *
 * One site_settings row, key `ods_theme_v1`, JSON value:
 *   { "mode": "off" | "staff" | "beta" | "all", "beta_org_ids": ["<org uuid>", …] }
 * - No row, an unreadable row or anything malformed = OFF (the safe state needs no migration and no action).
 * - The modes are cumulative: staff ⊂ beta ⊂ all.
 *     off   → nobody;
 *     staff → staff users only;
 *     beta  → staff + customers whose org is in beta_org_ids (Shop and My account only);
 *     all   → everyone.
 * - The introduction site and sign-in have no company yet, so `beta` never switches them on for customers
 *   (only for staff, who can preview them). Use off / all for those areas (audit C9).
 * - The row may stay private (is_public = false): it is read server-side with the service role, so beta org ids are
 *   never readable through the anon API.
 *
 * Read once per request (React `cache`) in each AREA LAYOUT, which then renders <OdsThemeRoot> + the ODS shell or the
 * current shell. Layouts are already dynamic (session + Suspense), so the uncached read is fine under Cache Components.
 * Set it on staging (example, not run by T1):
 *   insert into site_settings (key, value, is_public, description)
 *   values ('ods_theme_v1', '{"mode":"staff","beta_org_ids":[]}', false, 'ODS 1.0 theme (off/staff/beta/all)')
 *   on conflict (key) do update set value = excluded.value;
 */
export const ODS_SETTING = 'ods_theme_v1';
export const ODS_MODES = ['off', 'staff', 'beta', 'all'] as const;
export type OdsMode = (typeof ODS_MODES)[number];
export type OdsArea = 'public' | 'auth' | 'shop' | 'account' | 'office';
export type OdsThemeSetting = { mode: OdsMode; beta_org_ids: string[] };
export type OdsViewer = { area: OdsArea; orgId?: string | null; isStaff?: boolean };

export const ODS_OFF: OdsThemeSetting = Object.freeze({ mode: 'off', beta_org_ids: [] }) as OdsThemeSetting;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Areas where a customer belongs to a company, so `beta` can apply. */
const BETA_AREAS: ReadonlySet<OdsArea> = new Set(['shop', 'account']);

/** Anything → a valid setting. Missing or malformed → off. A bare mode string ("all") is accepted too. */
export function parseOdsThemeSetting(value: unknown): OdsThemeSetting {
  let v = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{')) {
      try {
        v = JSON.parse(s);
      } catch {
        return ODS_OFF;
      }
    } else {
      v = { mode: s };
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ODS_OFF;
  const o = v as Record<string, unknown>;
  const mode = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : '';
  if (!(ODS_MODES as readonly string[]).includes(mode)) return ODS_OFF;
  const ids = Array.isArray(o.beta_org_ids) ? o.beta_org_ids : [];
  const beta_org_ids = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID.test(x.trim())).map((x) => x.trim().toLowerCase()))];
  return { mode: mode as OdsMode, beta_org_ids };
}

/** The decision, pure: does this viewer get the ODS theme in this area? */
export function odsThemeFor(setting: OdsThemeSetting, viewer: OdsViewer): boolean {
  const isStaff = viewer.isStaff === true;
  switch (setting.mode) {
    case 'all':
      return true;
    case 'staff':
      return isStaff;
    case 'beta': {
      if (isStaff) return true;
      if (!BETA_AREAS.has(viewer.area) || !viewer.orgId) return false;
      return setting.beta_org_ids.includes(viewer.orgId.trim().toLowerCase());
    }
    default:
      return false;
  }
}

/** Density per area (Part 2.2): staff apps compact, customer areas comfortable. Warehouse floor pages override to comfortable (audit C13). */
export const odsDensityFor = (area: OdsArea): 'comfortable' | 'compact' => (area === 'office' ? 'compact' : 'comfortable');

/** Reads site_settings.ods_theme_v1 with the service role, once per request. Any failure → off. */
export const getOdsThemeSetting = cache(async (): Promise<OdsThemeSetting> => {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const { data, error } = await createAdminClient().from('site_settings').select('value').eq('key', ODS_SETTING).maybeSingle();
    if (error) return ODS_OFF;
    return parseOdsThemeSetting(data?.value);
  } catch {
    return ODS_OFF;
  }
});

/**
 * Use in each area layout:
 *   const ods = await isOdsTheme({ area: 'account', orgId: session.orgId, isStaff: session.isStaff });
 * `read` is injectable for tests.
 */
export async function isOdsTheme(viewer: OdsViewer, read: () => Promise<OdsThemeSetting> = getOdsThemeSetting): Promise<boolean> {
  try {
    return odsThemeFor(await read(), viewer);
  } catch {
    return false;
  }
}
