/**
 * Warehouse OS · W4 — carrier rule evaluation (board 9). Pure and client-safe: the same rule as wh_carrier_pick() in the
 * database (the database decides; this mirrors it for the "try the rules" preview on the Carriers screen and for unit tests).
 * First rule in order whose countries, product type and weight match AND whose service can carry the parcel; otherwise the
 * fallback (when it can carry it); otherwise no service.
 */
export const PRODUCT_TYPES = ['any', 'general', 'battery', 'liquid', 'dangerous'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  any: 'any product', general: 'no dangerous goods', battery: 'battery', liquid: 'liquid', dangerous: 'any dangerous goods',
};

export type RuleDraft = { seq: number; countries: string[]; product_type: ProductType; min_weight_g: number | null; max_weight_g: number | null; service_id: string };
export type ServiceForRules = {
  id: string; name: string; active: boolean; accountActive: boolean; accountName: string; sandbox: boolean;
  accepts_battery: boolean; accepts_liquid: boolean; max_weight_g: number | null;
  /** CONN S4 (missing on older data = takes magnets, as before) */
  accepts_magnet?: boolean;
};
export type PickInput = {
  rules: RuleDraft[]; fallbackId: string | null; services: ServiceForRules[];
  country: string; dg: string[]; weightG: number | null; staging: boolean;
};
export type PickResult = { ok: boolean; serviceId: string | null; ruleSeq: number | null; fallback: boolean; reason: string; skipped: { seq: number | null; why: string }[] };

const g = (n: number) => n.toLocaleString('en-US');

export function productTypeMatches(type: ProductType, dg: string[]): boolean {
  switch (type) {
    case 'any': return true;
    case 'general': return dg.length === 0;
    case 'battery': return dg.includes('battery');
    case 'liquid': return dg.includes('liquid');
    case 'dangerous': return dg.length > 0;
    default: return false;
  }
}

/** Same words as the database: "DE, FR · battery · up to 2,000 g". */
export function ruleText(countries: string[], type: ProductType, min: number | null, max: number | null): string {
  const c = countries.length === 0 ? 'any country' : countries.join(', ');
  const w = min == null && max == null ? 'any weight' : max == null ? `from ${g(min!)} g` : min == null ? `up to ${g(max)} g` : `${g(min)}–${g(max)} g`;
  return [c, PRODUCT_TYPE_LABEL[type] ?? type, w].join(' · ');
}

/** Why a service can't carry the parcel (null = it can) — wh_service_problem(). */
export function serviceProblem(s: ServiceForRules | undefined, dg: string[], weightG: number | null, staging: boolean): string | null {
  if (!s) return 'service not found';
  if (!s.active) return `${s.name} is switched off`;
  if (!s.accountActive) return `account ${s.accountName} is switched off`;
  if (s.sandbox && !staging) return `${s.accountName} is a sandbox account (staging only)`;
  if (dg.includes('battery') && !s.accepts_battery) return `${s.name} does not take batteries`;
  if (dg.includes('liquid') && !s.accepts_liquid) return `${s.name} does not take liquids`;
  if (dg.includes('magnet') && s.accepts_magnet === false) return `${s.name} does not take magnets`;
  if (s.max_weight_g != null && weightG != null && weightG > s.max_weight_g) return `${s.name} takes up to ${g(s.max_weight_g)} g`;
  return null;
}

export function pickService(i: PickInput): PickResult {
  const country = i.country.trim().toUpperCase();
  const dg = [...new Set(i.dg)];
  const byId = new Map(i.services.map((s) => [s.id, s]));
  const skipped: { seq: number | null; why: string }[] = [];
  for (const r of [...i.rules].sort((a, b) => a.seq - b.seq)) {
    if (r.countries.length > 0 && !r.countries.includes(country)) continue;
    if (!productTypeMatches(r.product_type, dg)) continue;
    if ((r.min_weight_g != null || r.max_weight_g != null) && i.weightG == null) { skipped.push({ seq: r.seq, why: 'weight unknown' }); continue; }
    if (r.min_weight_g != null && i.weightG! < r.min_weight_g) continue;
    if (r.max_weight_g != null && i.weightG! > r.max_weight_g) continue;
    const problem = serviceProblem(byId.get(r.service_id), dg, i.weightG, i.staging);
    if (problem) { skipped.push({ seq: r.seq, why: problem }); continue; }
    const s = byId.get(r.service_id)!;
    return { ok: true, serviceId: s.id, ruleSeq: r.seq, fallback: false, skipped, reason: `Rule ${r.seq} (${ruleText(r.countries, r.product_type, r.min_weight_g, r.max_weight_g)}) → ${s.name}` };
  }
  if (!i.fallbackId) return { ok: false, serviceId: null, ruleSeq: null, fallback: false, skipped, reason: 'Choose a fallback service' };
  const fb = byId.get(i.fallbackId);
  const problem = serviceProblem(fb, dg, i.weightG, i.staging);
  if (!problem && fb) {
    const reason = skipped.length === 0
      ? `No rule matched → fallback ${fb.name}`
      : `No usable rule (${skipped.map((x) => `rule ${x.seq}: ${x.why}`).join('; ')}) → fallback ${fb.name}`;
    return { ok: true, serviceId: fb.id, ruleSeq: null, fallback: true, skipped, reason };
  }
  skipped.push({ seq: null, why: `fallback: ${problem}` });
  return {
    ok: false, serviceId: null, ruleSeq: null, fallback: false, skipped,
    reason: `No carrier service can take this parcel (${skipped.map((x) => (x.seq == null ? x.why : `rule ${x.seq}: ${x.why}`)).join('; ')})`,
  };
}

/** "DE, fr ,  us" → ["DE","FR","US"] (sorted, unique); returns null when a code is not two letters. */
export function parseCountries(text: string): string[] | null {
  const parts = text.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (parts.some((p) => !/^[A-Z]{2}$/.test(p))) return null;
  return [...new Set(parts)].sort();
}
