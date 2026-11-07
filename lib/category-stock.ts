import type { Category } from './content';

/**
 * ADDON-36 C4 — only categories with at least one live product (counting sub-categories) are linked
 * from the category rail, the /products sidebar, the footer and the sitemap. Siblings are ordered by
 * live-product count (highest first), ties by the admin sort order.
 */
export function stockTotals(categories: Category[], counts: Record<string, number>): Map<string, number> {
  const kids = new Map<string | null, Category[]>();
  categories.forEach((c) => { const k = kids.get(c.parent_id) ?? []; k.push(c); kids.set(c.parent_id, k); });
  const out = new Map<string, number>();
  const walk = (c: Category, seen: Set<string>): number => {
    if (out.has(c.id)) return out.get(c.id)!;
    if (seen.has(c.id)) return 0; // defensive against a parent loop
    seen.add(c.id);
    const n = (counts[c.id] ?? 0) + (kids.get(c.id) ?? []).reduce((s, k) => s + walk(k, seen), 0);
    out.set(c.id, n);
    return n;
  };
  categories.forEach((c) => walk(c, new Set()));
  return out;
}

/** Categories that have live products, siblings ordered by count desc. Keeps the tree shape (parents before children). */
export function stockedCategories(categories: Category[], counts: Record<string, number>): Category[] {
  const totals = stockTotals(categories, counts);
  return categories
    .filter((c) => (totals.get(c.id) ?? 0) > 0)
    .sort((a, b) => (totals.get(b.id)! - totals.get(a.id)!) || a.sort - b.sort || a.name.localeCompare(b.name));
}

export function isStocked(categories: Category[], counts: Record<string, number>, id: string): boolean {
  return (stockTotals(categories, counts).get(id) ?? 0) > 0;
}

