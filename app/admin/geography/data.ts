import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCurrencyContext, toPlatform, type CurrencyContext } from '@/lib/currency';

export const REGION: Record<string, string> = {
  DE: 'Europe', NL: 'Europe', GB: 'Europe', FR: 'Europe', ES: 'Europe', IT: 'Europe', PL: 'Europe', TR: 'Europe',
  US: 'North America', CA: 'North America', MX: 'Latin America', BR: 'Latin America',
  AE: 'Middle East', SA: 'Middle East', QA: 'Middle East', KW: 'Middle East', OM: 'Middle East', BH: 'Middle East', EG: 'Africa',
  CN: 'Asia-Pacific', VN: 'Asia-Pacific', LK: 'Asia-Pacific', MY: 'Asia-Pacific', IN: 'Asia-Pacific', AU: 'Asia-Pacific', JP: 'Asia-Pacific',
  KR: 'Asia-Pacific', SG: 'Asia-Pacific', PK: 'Asia-Pacific', BD: 'Asia-Pacific', ID: 'Asia-Pacific', TH: 'Asia-Pacific', PH: 'Asia-Pacific',
  ZA: 'Africa', NG: 'Africa',
};
export const REGIONS = ['Europe', 'North America', 'Middle East', 'Asia-Pacific', 'Latin America', 'Africa', 'Other'];
export const regionOf = (c: string | null) => (c && REGION[c]) || 'Other';

export type CountryRow = { country: string; region: string; customers: number; verified: number; pending: number; rejected: number; notStarted: number; orders: number; gmv: number; gmvBy: Record<string, number> };
export type Org = { id: string; country: string | null; city: string | null; business_type: string | null; kyc_status: string; created_at: string };

/** Customers by country with KYC breakdown and GMV (orders.total_cents by org country).
 *  `gmv` is converted into the platform currency at the approved rate; `gmvBy` keeps each order currency (SPEC §15.1). */
export async function loadGeography(f: { kyc?: string; type?: string; since?: string; region?: string }) {
  const sb = await createClient();
  const [{ data: orgsRaw }, { data: orders }, ctx] = await Promise.all([
    sb.from('organizations').select('id, country, city, business_type, kyc_status, created_at').is('archived_at', null).limit(20000),
    sb.from('orders').select('org_id, total_cents, currency, status, created_at').neq('status', 'cancelled').limit(50000),
    getCurrencyContext(),
  ]);
  let orgs = (orgsRaw ?? []) as Org[];
  if (f.kyc) orgs = orgs.filter((o) => (f.kyc === 'pending' ? ['submitted', 'in_review', 'more_info'].includes(o.kyc_status) : o.kyc_status === f.kyc));
  if (f.type) orgs = orgs.filter((o) => o.business_type === f.type);
  if (f.since) orgs = orgs.filter((o) => o.created_at >= f.since!);
  const allOrgsForRegion = orgs;
  if (f.region) orgs = orgs.filter((o) => regionOf(o.country) === f.region);
  const orgCountry = new Map(orgs.map((o) => [o.id, o.country ?? '??']));
  const rows = new Map<string, CountryRow>();
  const row = (c: string) => {
    let r = rows.get(c);
    if (!r) { r = { country: c, region: regionOf(c), customers: 0, verified: 0, pending: 0, rejected: 0, notStarted: 0, orders: 0, gmv: 0, gmvBy: {} }; rows.set(c, r); }
    return r;
  };
  orgs.forEach((o) => {
    const r = row(o.country ?? '??');
    r.customers++;
    if (o.kyc_status === 'verified') r.verified++;
    else if (o.kyc_status === 'rejected') r.rejected++;
    else if (o.kyc_status === 'not_started') r.notStarted++;
    else r.pending++;
  });
  const regionGmv = new Map<string, { customers: number; gmv: number }>();
  const allCountry = new Map(allOrgsForRegion.map((o) => [o.id, o.country]));
  allOrgsForRegion.forEach((o) => { const k = regionOf(o.country); const a = regionGmv.get(k) ?? { customers: 0, gmv: 0 }; a.customers++; regionGmv.set(k, a); });
  (orders ?? []).forEach((o) => {
    if (f.since && o.created_at < f.since) return;
    const conv = toPlatform(ctx, Number(o.total_cents), o.currency) ?? 0;
    if (allCountry.has(o.org_id)) { const k = regionOf(allCountry.get(o.org_id) ?? null); const a = regionGmv.get(k) ?? { customers: 0, gmv: 0 }; a.gmv += conv; regionGmv.set(k, a); }
    const c = orgCountry.get(o.org_id);
    if (c === undefined) return;
    const r = row(c);
    r.orders++; r.gmv += conv;
    const cur = String(o.currency ?? 'USD');
    r.gmvBy[cur] = (r.gmvBy[cur] ?? 0) + Number(o.total_cents);
  });
  const list = [...rows.values()].sort((a, b) => b.gmv - a.gmv || b.customers - a.customers);
  return { rows: list, orgs, allOrgs: (orgsRaw ?? []) as Org[], regionGmv, ctx: ctx as CurrencyContext };
}
