/**
 * White-label guards for the Shop catalogue (Part 1 rule 7). Pure + client-safe.
 * Customers never see supplier/factory names or codes, Sourcing model numbers, cost or margin. The loaders select only
 * customer-safe columns; these helpers are the second line of defence for free-text rows staff typed (specs).
 */
const BLOCKED_SPEC = /(supplier|factory|vendor|manufacturer|maker|oem\s*code|model\s*(no|nr|number|#)|item\s*(no|nr|number|#|code)|\bsku\b|article\s*(no|number)|cost|margin|purchase\s*price|ex[- ]?works\s*price)/i;

export function safeSpecs<T extends { name: string; value: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.name.trim() && r.value.trim() && !BLOCKED_SPEC.test(r.name));
}

/** Customer-facing origin line. Always the country only, never a province, city or factory. */
export const SHIPS_FROM = 'China';
