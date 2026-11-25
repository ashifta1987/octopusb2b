import 'server-only';
import { redirect } from 'next/navigation';
import { can, getSession, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isDropshipV2UiEnabled } from '@/lib/dropship';

export type DropshipStaffAccess = {
  session: Session;
  dsDivisionId: string;
  inDs: boolean;
  canEdit: boolean;       // DS division manager/staff or company-wide admin
  canSeeCosts: boolean;   // DS division member, admin, or finance (NOT support-only)
  canSeeSaas: boolean;    // company-wide Finance or Admin
  isSupportOnly: boolean;
};

/**
 * Staff guard for /office/dropship (and its actions):
 *  · requires a 2FA-verified (aal2) staff session;
 *  · allows Dropshipping (DS) division members and company-wide roles (admin, finance, support);
 *  · enforces decision 5:
 *      - DS division staff and company-wide admins can edit;
 *      - Finance is read-only and sees cost, margin and supplier;
 *      - Support is read-only and does NOT see cost, margin, supplier or carrier.
 */
export async function requireDropshipStaff(
  needEdit = false,
  next = '/office/dropship',
): Promise<DropshipStaffAccess> {
  const s = await getSession();
  if (!s) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  if (!s.isStaff) redirect('/login');
  if (s.aal !== 'aal2') redirect(`/staff/verify?next=${encodeURIComponent(next)}`);

  const sb = await createClient();
  const [{ data: dsDiv }, { data: myDivs }] = await Promise.all([
    sb.from('divisions').select('id').eq('code', 'DS').single(),
    sb.from('division_members').select('division_id, role').eq('user_id', s.userId),
  ]);
  const dsDivisionId = dsDiv?.id as string;
  const dsMembership = (myDivs ?? []).find((m) => m.division_id === dsDivisionId);
  const inDs = Boolean(dsMembership);
  const isFin = can(s, 'finance', 'view');
  const isSup = can(s, 'support', 'edit');
  const isCompanyWide = s.isAdmin || isFin || isSup;

  if (!inDs && !isCompanyWide) {
    redirect('/forbidden');
  }

  const canEdit =
    s.isAdmin ||
    Boolean(dsMembership && ['manager', 'staff'].includes(String(dsMembership.role)));
  const canSeeCosts = s.isAdmin || isFin || inDs;
  const isSupportOnly = !canSeeCosts && isSup;

  if (needEdit && !canEdit) {
    redirect('/forbidden');
  }

  return {
    session: s,
    dsDivisionId,
    inDs,
    canEdit,
    canSeeCosts,
    canSeeSaas: s.isAdmin || isFin,
    isSupportOnly,
  };
}

/**
 * Staff guard for Step U1 design v2 placeholder/UI-kit pages (/office/dropship/* placeholders and ui-kit).
 * Requires dropship_v2_ui to be ON, plus Dropshipping division membership or company-wide admin.
 */
export async function requireDropshipV2Staff(
  needEdit = false,
  next = '/office/dropship',
): Promise<DropshipStaffAccess> {
  const [access, v2On] = await Promise.all([
    requireDropshipStaff(needEdit, next),
    isDropshipV2UiEnabled(),
  ]);
  if (!v2On) {
    redirect('/office/dropship');
  }
  return access;
}

/**
 * Strip leading formula characters (=, +, -, @) and tab / CR characters from a CSV cell so exported or previewed
 * spreadsheet cells can never execute a formula injection.
 */
export function sanitiseCsvCell(val: string | null | undefined): string {
  let s = String(val ?? '').replace(/[\t\r]/g, ' ').trim();
  while (s.length > 0 && /^[=+\-@]/.test(s)) {
    s = s.slice(1).trimStart();
  }
  return s;
}

/**
 * Route margin calculation in integer cents and basis points:
 *   margin_cents = landed_price_cents - unit_cost_cents - est_shipping_cents - est_duties_cents
 *   margin_bp = round((margin_cents * 10000) / landed_price_cents)
 */
export function computeRouteMargin(params: {
  landedPriceCents: number;
  unitCostCents: number;
  estShippingCents: number;
  estDutiesCents: number;
  minMarginBp: number;
}) {
  const marginCents =
    params.landedPriceCents -
    params.unitCostCents -
    params.estShippingCents -
    params.estDutiesCents;
  const marginBp =
    params.landedPriceCents > 0
      ? Math.round((marginCents * 10000) / params.landedPriceCents)
      : 0;
  const marginPct = (marginBp / 100).toFixed(1);
  const belowMin = marginBp < params.minMarginBp;
  return { marginCents, marginBp, marginPct, belowMin };
}
