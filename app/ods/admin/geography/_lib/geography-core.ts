// ODS T9
/**
 * ODS T9 · Customer geography (Admin › Geography) — pure rules. Server + client safe.
 * Today's /admin/geography is a read-only report (customers by country / region from organizations.country, KYC and
 * order GMV converted at the approved rate). It has no edit action and no shipping-zone table, so the ODS screen is a
 * grid + a read-only country drawer; filters and the CSV export (/admin/geography/export, customers:view) are unchanged.
 */
export type GeoFilters = { period?: string; kyc?: string; type?: string; region?: string };

export const PERIODS: [string, string][] = [['', 'All time'], ['30', 'Signed up last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];
export const KYC_OPTIONS: [string, string][] = [['', 'All KYC statuses'], ['verified', 'Verified'], ['pending', 'Pending review'], ['not_started', 'Not started'], ['rejected', 'Rejected']];

/** Same as today's sinceFor(): only 30 / 90 / 365 count; anything else = all time. */
export function periodDays(period?: string): number {
  return period === '30' ? 30 : period === '90' ? 90 : period === '365' ? 365 : 0;
}

/** Public URL with the filters (empty values dropped), as today's qs(). */
export function geoHref(base: string, sp: GeoFilters, patch: Partial<GeoFilters> = {}): string {
  const [path, existing] = base.split('?');
  const u = new URLSearchParams(existing ?? '');
  (['period', 'kyc', 'type', 'region'] as const).forEach((k) => u.delete(k));
  Object.entries({ ...sp, ...patch }).forEach(([k, v]) => { if (v) u.set(k, v); });
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

/** Export link: same query as the page (today's exportQs). */
export const exportHref = (sp: GeoFilters) => {
  const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return `/admin/geography/export${q ? `?${q}` : ''}`;
};

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
export const share = (part: number, whole: number) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0');

export type GeoCountryRow = {
  country: string;
  name: string;
  region: string;
  customers: number;
  verified: number;
  pending: number;
  rejected: number;
  notStarted: number;
  orders: number;
  /** minor units, platform currency (converted at the approved rate) */
  gmv: number;
  gmvBy: Record<string, number>;
  cities: { city: string; n: number }[];
};

export type GeoRegionCard = { region: string; customers: number; gmv: number };

/** Top region by GMV (today's KPI): null when no GMV. */
export function topRegion(regions: GeoRegionCard[]): GeoRegionCard | null {
  const t = [...regions].sort((a, b) => b.gmv - a.gmv)[0];
  return t && t.gmv > 0 ? t : null;
}

/** True when a row has GMV in a currency other than the platform currency (today shows "· converted"). */
export const isMixed = (row: Pick<GeoCountryRow, 'gmvBy'>, currency: string) => Object.keys(row.gmvBy).some((c) => c !== currency);

/** Top cities overall, from the per-country lists (today: 8). */
export function topCities(rows: GeoCountryRow[], n = 8) {
  return rows.flatMap((r) => r.cities.map((c) => ({ ...c, country: r.country }))).sort((a, b) => b.n - a.n).slice(0, n);
}
