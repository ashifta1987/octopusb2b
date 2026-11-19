/**
 * What buyers see about the factory behind a product / quote / order (19 Nov 2026 decision 1):
 *   "Verified factory · China (Guangdong)"   — verified supplier
 *   "Factory · China (Guangdong)"            — not verified
 * Missing parts are dropped ("Verified factory · China", "Factory"). Never the supplier code or id: buyers read the
 * `product_factory` / `quote_factory` / `order_factory` views, which only expose verified + country + province.
 */
export type FactoryInfo = { verified?: boolean | null; country?: string | null; province?: string | null };

const OVERRIDES: Record<string, string> = {
  CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', MO: 'Macau', KR: 'South Korea', KP: 'North Korea', VN: 'Vietnam',
  RU: 'Russia', IR: 'Iran', SY: 'Syria', LA: 'Laos', BO: 'Bolivia', VE: 'Venezuela', TZ: 'Tanzania', MD: 'Moldova',
  GB: 'United Kingdom', US: 'United States', AE: 'United Arab Emirates', CZ: 'Czechia', TR: 'Türkiye',
};

let display: Intl.DisplayNames | null | undefined;

/** ISO 3166 alpha-2 code → English country name. Unknown / non-code values are returned trimmed as they are. */
export function countryName(code: string | null | undefined): string | null {
  const c = (code ?? '').trim();
  if (!c) return null;
  const up = c.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return c;
  if (OVERRIDES[up]) return OVERRIDES[up];
  if (display === undefined) {
    try { display = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { display = null; }
  }
  try {
    const n = display?.of(up);
    if (n && n !== up) return n;
  } catch { /* invalid code */ }
  return up;
}

/** "Guangdong province" → "Guangdong"; blank → null. */
export function provinceName(p: string | null | undefined): string | null {
  const v = (p ?? '').trim().replace(/\s+(province|prov\.?)$/i, '').trim();
  return v || null;
}

/** "China (Guangdong)" / "China" / "Guangdong" / null. */
export function factoryPlace(f: FactoryInfo | null | undefined): string | null {
  const country = countryName(f?.country);
  const province = provinceName(f?.province);
  if (country && province) return `${country} (${province})`;
  return country ?? province ?? null;
}

/** "Verified factory · China (Guangdong)" / "Factory · China (Guangdong)" / "Factory". */
export function factoryLabel(f: FactoryInfo | null | undefined): string {
  const head = f?.verified ? 'Verified factory' : 'Factory';
  const place = factoryPlace(f);
  return place ? `${head} · ${place}` : head;
}
