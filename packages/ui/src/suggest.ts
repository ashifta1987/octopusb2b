/**
 * Search suggestions (ShopHeader combobox) — pure helpers, server + client safe (no 'use client').
 * Response shape of a suggestions endpoint (e.g. /api/shop/suggest?q=): `{ groups: SuggestGroup[] }`.
 */
export type SuggestItem = { id: string; label: string; href: string; /** short second line, e.g. "MOQ pool · closes in 5 days" */ meta?: string };
export type SuggestGroup = { id: string; label: string; items: SuggestItem[] };

/** Minimum characters before suggestions are fetched (Part 5.1). */
export const SUGGEST_MIN_CHARS = 2;

/** All items in display order (groups top to bottom), for arrow-key navigation. */
export function flattenSuggestions(groups: SuggestGroup[]): SuggestItem[] {
  return groups.flatMap((g) => g.items);
}

/** Next active index for ArrowDown (+1) / ArrowUp (−1), wrapping; −1 = nothing active (the text box itself). */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  const next = current + delta;
  if (next < 0 || next >= count) return -1;
  return next;
}

/** Validates an untrusted JSON body into groups (drops anything that isn't label + same-site href). */
export function parseSuggestResponse(body: unknown): SuggestGroup[] {
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => {
      const items = Array.isArray(g?.items) ? g.items : [];
      return {
        id: String(g?.id ?? ''),
        label: String(g?.label ?? ''),
        items: items
          .filter((i: unknown) => {
            const x = i as { label?: unknown; href?: unknown };
            return typeof x?.label === 'string' && typeof x?.href === 'string' && x.href.startsWith('/') && !x.href.startsWith('//');
          })
          .map((i: { id?: unknown; label: string; href: string; meta?: unknown }) => ({
            id: String(i.id ?? i.href),
            label: i.label,
            href: i.href,
            ...(typeof i.meta === 'string' ? { meta: i.meta } : {}),
          })),
      };
    })
    .filter((g) => g.id && g.label && g.items.length > 0);
}
