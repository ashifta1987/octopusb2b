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
 * Public and sign-in pages are switched in proxy.ts (rewrite to app/ods/*, T3). Shop / My account / Back Office layouts
 * read it once per request (React `cache`) in each AREA LAYOUT, which then renders <OdsThemeRoot> + the ODS shell or the
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

/* ───────── staging preview (T3): a per-browser override for tests and owner previews ───────── */

/**
 * Cookie `ods_preview` = on | off | all. Honoured ONLY when APP_ENVIRONMENT = 'staging' (ignored on live, always):
 *   on  → the ODS theme for this browser, whatever the setting says;
 *   all → the same, plus the "all" behaviour (old service URLs 308 to /services/*);
 *   off → the current theme for this browser, even if the setting is on.
 * Set it with /dev/ods-preview?mode=on|off|all|clear (staging only) or, in Playwright, tests/e2e/helpers/ods.ts.
 * No database write is involved, so tests never change what other staging users see.
 */
export const ODS_PREVIEW_COOKIE = 'ods_preview';
export type OdsPreview = 'on' | 'off' | 'all' | null;

export function odsPreviewFrom(value: string | null | undefined, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): OdsPreview {
  if (env.APP_ENVIRONMENT !== 'staging') return null;
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'on' || v === '1') return 'on';
  if (v === 'all') return 'all';
  if (v === 'off' || v === '0') return 'off';
  return null;
}

/** The setting as this visitor experiences it (a staging preview wins). */
export function effectiveOdsSetting(setting: OdsThemeSetting, preview: OdsPreview): OdsThemeSetting {
  if (preview === 'off') return ODS_OFF;
  if (preview === 'on' || preview === 'all') return { mode: 'all', beta_org_ids: setting.beta_org_ids };
  return setting;
}

/** Old service URLs 308 to /services/* only when the switch is "all" (owner, 27 Nov), or a staging "all" preview. */
export function odsLegacyRedirectsOn(setting: OdsThemeSetting, preview: OdsPreview): boolean {
  if (preview === 'off') return false;
  if (preview === 'all') return true;
  return setting.mode === 'all';
}

/* ───────── reading the setting ───────── */

const MEMO_MS = 15_000;
let memo: { at: number; value: OdsThemeSetting } | null = null;

/**
 * Reads site_settings.ods_theme_v1 over REST with the service role (the row can stay private, so beta org ids are never
 * readable with the anon key). Pure fetch, so proxy.ts can use it too. Kept for 15 s per server instance, so a change
 * applies within 15 s without a database read on every request. Any failure → off.
 */
export async function fetchOdsThemeSetting(now: number = Date.now()): Promise<OdsThemeSetting> {
  if (memo && now - memo.at < MEMO_MS) return memo.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return ODS_OFF;
  try {
    const res = await fetch(`${url}/rest/v1/site_settings?select=value&key=eq.${ODS_SETTING}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return ODS_OFF;
    const rows = (await res.json()) as { value: unknown }[];
    const value = parseOdsThemeSetting(rows[0]?.value);
    memo = { at: now, value };
    return value;
  } catch {
    return ODS_OFF;
  }
}
/** Test hook: forget the 15 s memo. */
export const resetOdsThemeMemo = () => {
  memo = null;
};

/** Once per request (React cache) on top of the 15 s memo. */
export const getOdsThemeSetting = cache(() => fetchOdsThemeSetting());

/**
 * Use in each area layout:
 *   const ods = await isOdsTheme({ area: 'account', orgId: session.orgId, isStaff: session.isStaff }, preview);
 * Pages and layouts get `preview` from lib/ods-request.ts (`odsPreviewFromCookies()`); `read` is injectable for tests.
 */
export async function isOdsTheme(viewer: OdsViewer, preview: OdsPreview = null, read: () => Promise<OdsThemeSetting> = getOdsThemeSetting): Promise<boolean> {
  try {
    return odsThemeFor(effectiveOdsSetting(await read(), preview), viewer);
  } catch {
    return false;
  }
}
