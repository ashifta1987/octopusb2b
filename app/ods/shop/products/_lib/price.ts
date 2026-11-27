/**
 * Price calculator maths for the Shop product page (Part 5.4 item 6). Pure: no React, no I/O; unit-tested in
 * tests/unit/ods-shop-price.test.ts. Money stays in MINOR units (cents) so totals are exact.
 *
 *   priceForQuantity(tiers, qty, moq)
 *     - invalid    quantity is empty, not a whole number, or ≤ 0
 *     - below-moq  quantity < minimum order (moq, or the first tier when no moq is given)
 *     - no-tiers   no price listed (price on request) — the quantity is still fine
 *     - ok         the tier that applies (highest min ≤ qty; quantities between the MOQ and the first tier use the first
 *                  tier), unit price, total, the tier's range and the next tier (+ units still to go)
 */
export type PriceTier = { minQty: number; unitCents: number };

export type TierRange = { from: number; to: number | null };

export type PriceResult =
  | { status: 'invalid' }
  | { status: 'below-moq'; minimum: number; shortBy: number }
  | { status: 'no-tiers'; quantity: number }
  | {
      status: 'ok';
      quantity: number;
      tier: PriceTier;
      tierIndex: number;
      range: TierRange;
      unitCents: number;
      totalCents: number;
      next: { tier: PriceTier; range: TierRange; unitsToGo: number } | null;
    };

/** Positive tiers only, sorted by minimum quantity, one per minimum (the lowest price wins on duplicates). */
export function normaliseTiers(tiers: readonly PriceTier[]): PriceTier[] {
  const byMin = new Map<number, number>();
  for (const t of tiers) {
    if (!Number.isFinite(t.minQty) || !Number.isFinite(t.unitCents) || t.unitCents <= 0 || t.minQty < 1) continue;
    const min = Math.floor(t.minQty);
    const prev = byMin.get(min);
    byMin.set(min, prev == null ? Math.round(t.unitCents) : Math.min(prev, Math.round(t.unitCents)));
  }
  return [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([minQty, unitCents]) => ({ minQty, unitCents }));
}

/** "500–999" style range of tier i (the last tier is open-ended). */
export function tierRange(tiers: readonly PriceTier[], i: number): TierRange {
  const next = tiers[i + 1];
  return { from: tiers[i].minQty, to: next ? next.minQty - 1 : null };
}

export function priceForQuantity(rawTiers: readonly PriceTier[], qty: number | null | undefined, moq?: number | null): PriceResult {
  if (qty == null || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) return { status: 'invalid' };
  const tiers = normaliseTiers(rawTiers);
  const minimum = moq != null && moq > 0 ? Math.floor(moq) : tiers[0]?.minQty ?? 1;
  if (qty < minimum) return { status: 'below-moq', minimum, shortBy: minimum - qty };
  if (!tiers.length) return { status: 'no-tiers', quantity: qty };
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (tiers[i].minQty <= qty) idx = i;
  const tier = tiers[idx];
  const nextTier = tiers[idx + 1] && tiers[idx + 1].minQty > qty ? tiers[idx + 1] : null;
  return {
    status: 'ok',
    quantity: qty,
    tier,
    tierIndex: idx,
    range: tierRange(tiers, idx),
    unitCents: tier.unitCents,
    totalCents: tier.unitCents * qty,
    next: nextTier ? { tier: nextTier, range: tierRange(tiers, idx + 1), unitsToGo: nextTier.minQty - qty } : null,
  };
}

/** Lowest listed unit price (the card's "From"); null = price on request (never 0). */
export function fromPriceCents(tiers: readonly PriceTier[], fallbackCents?: number | null): number | null {
  const t = normaliseTiers(tiers);
  if (t.length) return Math.min(...t.map((x) => x.unitCents));
  return fallbackCents != null && fallbackCents > 0 ? fallbackCents : null;
}
