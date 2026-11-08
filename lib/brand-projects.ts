import { COUNTRY_NAMES } from '@/lib/format';

/**
 * Make My Brand — labels and the staff status rules (bug 2, 8 Nov 2026). Pure, unit-tested. The database function
 * set_brand_project_status() enforces the same rules; this only decides which controls the Admin page shows.
 */
export const BRAND_METHOD: Record<string, string> = { pad: 'Pad or silk print', laser: 'Laser engraving', uv: 'UV print', box: 'Branded colour box', inserts: 'Inserts and manuals', unsure: 'Not sure yet' };
export const BRAND_PACK: Record<string, string> = { standard: 'Plain box with your label', colour_box: 'Branded colour box', gift_box: 'Premium gift box', unsure: 'Not sure yet' };
export const BRAND_STEPS = ['submitted', 'proof', 'sample', 'quoted', 'production', 'stocked'] as const;
export const BRAND_STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted', proof: 'Proof', sample: 'Sample', quoted: 'Quoted', production: 'In production', stocked: 'Stocked', closed: 'Closed',
};

export type BrandRow = {
  id: string; ref: string; status: string; closed_from: string | null; created_at: string; status_changed_at: string | null;
  org_id: string; company: string; product_id: string | null; product_title: string | null; product_slug: string | null; product_link: string | null;
  quantity: number | null; markets: string[]; method: string | null; packaging: string | null; colours: string | null; logo_paths: string[];
  stock_destination: string | null; bulk_country: string | null; stores: string[]; note: string | null;
  manager_id: string | null; manager_name: string | null; paid: boolean;
};
export const BRAND_TONE: Record<string, 'blue' | 'amber' | 'green' | 'gray'> = { submitted: 'blue', proof: 'amber', sample: 'blue', quoted: 'amber', production: 'blue', stocked: 'green', closed: 'gray' };
export const brandDestination = (r: Pick<BrandRow, 'stock_destination' | 'bulk_country'>) =>
  r.stock_destination === 'bulk' ? `Bulk to ${COUNTRY_NAMES[r.bulk_country ?? ''] ?? r.bulk_country ?? '—'}` : r.stock_destination === 'warehouse' ? 'Octopus warehouse' : '—';


export type BrandMove = { to: string; label: string; needsReason: boolean; disabled?: string; reopen?: boolean };

/** Moves the Admin page offers for a project. */
export function brandMoves(p: { status: string; closed_from: string | null; paid: boolean }, isAdmin: boolean): BrandMove[] {
  if (p.status === 'closed') {
    const back = p.closed_from ?? 'submitted';
    return isAdmin ? [{ to: back, label: `Reopen → ${BRAND_STATUS_LABEL[back] ?? back}`, needsReason: false, reopen: true }] : [];
  }
  const moves: BrandMove[] = BRAND_STEPS.filter((s) => s !== p.status).map((s) => ({ to: s, label: BRAND_STATUS_LABEL[s], needsReason: false }));
  moves.push({ to: 'closed', label: 'Close', needsReason: true, disabled: p.paid && !isAdmin ? 'Payment received on this project: only an admin can close it.' : undefined });
  return moves;
}

/** Plain-language errors for the database rule codes. */
export function brandStatusError(message: string): string {
  const m = /^(FORBIDDEN|NOT_FOUND|INVALID_STATUS|NO_CHANGE|ADMIN_ONLY|REOPEN_TO_PREVIOUS|REASON_REQUIRED|ADMIN_ONLY_PAID): ?(.*)$/.exec(message);
  if (!m) return message;
  return m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1) + '.' : 'Not allowed.';
}
