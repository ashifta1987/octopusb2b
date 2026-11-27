import 'server-only';
import { cookies } from 'next/headers';
import {
  ODS_OFF, ODS_PREVIEW_COOKIE, effectiveOdsSetting, fetchOdsThemeSetting, isOdsTheme, odsPreviewFrom, odsThemeFor, type OdsPreview, type OdsViewer,
} from '@/lib/ods-flag';

/** The staging preview cookie for this request (null on live, always). Reading cookies makes the caller dynamic. */
export async function odsPreviewFromCookies(): Promise<OdsPreview> {
  return odsPreviewFrom((await cookies()).get(ODS_PREVIEW_COOKIE)?.value);
}

/** isOdsTheme for the current request (setting + staging preview). For T4+ area layouts (Shop, My account, Back Office). */
export async function isOdsThemeForRequest(viewer: OdsViewer): Promise<boolean> {
  return isOdsTheme(viewer, await odsPreviewFromCookies());
}

/**
 * ODS T3 (AUTH): is the new theme on for this visitor on the introduction site / sign-in — the SAME rule as proxy.ts
 * odsForVisitor(), usable from a route handler (/auth/callback) or a server action:
 *  - staging preview cookie first (no database read);
 *  - otherwise ods_theme_v1 (15 s memo);
 *  - "staff" / "beta" modes → only staff (public areas have no company). `isStaff` is asked only in those modes, so pass a
 *    lazy lookup (e.g. () => isStaffUser(uid)).
 * Any failure → off.
 */
export async function odsOnForPublicRequest(cookieValue: string | null | undefined, isStaff: boolean | (() => Promise<boolean>)): Promise<boolean> {
  try {
    const preview = odsPreviewFrom(cookieValue);
    const eff = effectiveOdsSetting(preview ? ODS_OFF : await fetchOdsThemeSetting(), preview);
    let staff = false;
    if (eff.mode === 'staff' || eff.mode === 'beta') staff = typeof isStaff === 'function' ? await isStaff().catch(() => false) : isStaff;
    return odsThemeFor(eff, { area: 'public', isStaff: staff });
  } catch {
    return false;
  }
}
