/**
 * CONN S6 · daily exchange rates from the European Central Bank's public reference rates (no key, named source). The ECB publishes
 * "1 EUR = x CUR" around 16:00 CET on working days; Octopus keeps "units of a currency per 1 USD" (dropship_fx_rates), so
 * rate_per_usd(CUR) = x(CUR) / x(USD) and rate_per_usd(EUR) = 1 / x(USD). Currencies the ECB does not publish (AED, SAR, KWD …)
 * are left to staff. Decimal maths on strings → numbers rounded to 6 decimals (the database keeps 6).
 */
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_SOURCE = 'European Central Bank reference rate';

export type EcbDay = { date: string; perEur: Record<string, number> };

/** Parses the ECB daily XML (Cube time="YYYY-MM-DD" with Cube currency="USD" rate="1.0812"). */
export function parseEcbXml(xml: string): EcbDay | null {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const perEur: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/g)) {
    const v = Number(m[2]);
    if (Number.isFinite(v) && v > 0) perEur[m[1]] = v;
  }
  return Object.keys(perEur).length ? { date, perEur } : null;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Units of each currency per 1 USD (EUR included); null when the ECB day has no USD rate. */
export function ratesPerUsd(day: EcbDay): { currency: string; rate_per_usd: number }[] | null {
  const usd = day.perEur.USD;
  if (!usd) return null;
  const out = [{ currency: 'EUR', rate_per_usd: r6(1 / usd) }];
  for (const [cur, perEur] of Object.entries(day.perEur)) {
    if (cur === 'USD' || cur === 'EUR') continue;
    out.push({ currency: cur, rate_per_usd: r6(perEur / usd) });
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function fetchEcbDay(fetchImpl: typeof fetch = fetch): Promise<EcbDay> {
  const res = await fetchImpl(ECB_DAILY_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { accept: 'application/xml, text/xml' } });
  if (!res.ok) throw new Error(`The ECB feed answered HTTP ${res.status}.`);
  const day = parseEcbXml(await res.text());
  if (!day) throw new Error('The ECB feed could not be read.');
  return day;
}
