import 'server-only';
import { redirect } from 'next/navigation';
import { getSession, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type DropshipStaffAccess = {
  session: Session;
  dsDivisionId: string;
  canEdit: boolean;       // DS division manager/staff or company-wide admin
  canSeeCosts: boolean;   // DS division member, admin, or finance (NOT support-only)
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
  const isFin = s.roles.includes('finance');
  const isSup = s.roles.includes('support');
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
    canEdit,
    canSeeCosts,
    isSupportOnly,
  };
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
