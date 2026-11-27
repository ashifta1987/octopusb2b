/**
 * Pure helpers behind the selection group (Tabs, FilterPills, Segmented, CardTabs, Stepper, JumpBar).
 * No React, no DOM: server-safe and unit-tested in tests/unit/ods-selection.test.ts.
 */

export type SelectableItem = { id: string; disabled?: boolean };

/** `candidate` when it names an enabled item, otherwise the first enabled item (undefined when none). */
export function resolveSelectableId(items: readonly SelectableItem[], candidate?: string | null): string | undefined {
  if (candidate != null) {
    const hit = items.find((i) => i.id === candidate);
    if (hit && !hit.disabled) return hit.id;
  }
  return items.find((i) => !i.disabled)?.id;
}

/** Reads `?<param>=` from a search string ("?tab=reviews&x=1"); null when absent or empty. */
export function readSearchParam(search: string, param: string): string | null {
  const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(param);
  return v ? v : null;
}

/**
 * Returns `href` with `?<param>=<value>` set (or removed when value is null), keeping the path, other params and hash.
 * Works with absolute URLs and with path-only hrefs ("/orders/42?x=1#top").
 */
export function withSearchParam(href: string, param: string, value: string | null): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = new URL(href, 'http://local.invalid');
  if (value == null || value === '') url.searchParams.delete(param);
  else url.searchParams.set(param, value);
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

/**
 * FilterPills toggle. `multi`: adds / removes `id` (keeps the order of `order` when given). `single`: selects `id`,
 * or clears it when it was already selected and `allowEmpty` (default true).
 */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  opts: { mode?: 'multi' | 'single'; allowEmpty?: boolean; order?: readonly string[] } = {},
): string[] {
  const { mode = 'multi', allowEmpty = true, order } = opts;
  const has = selected.includes(id);
  if (mode === 'single') {
    if (has) return allowEmpty ? [] : [id];
    return [id];
  }
  if (has) {
    if (!allowEmpty && selected.length === 1) return [...selected];
    return selected.filter((s) => s !== id);
  }
  const next = [...selected, id];
  return order ? order.filter((o) => next.includes(o)) : next;
}

export type StepStatus = 'done' | 'current' | 'upcoming' | 'error';

/**
 * Statuses for `count` steps from the index of the current step: before = done, at = current, after = upcoming;
 * the step at `errorAt` is 'error'. `current >= count` means every step is done.
 */
export function stepStatuses(count: number, current: number, errorAt?: number): StepStatus[] {
  return Array.from({ length: count }, (_, i) => {
    if (errorAt === i) return 'error';
    if (i < current) return 'done';
    if (i === current) return 'current';
    return 'upcoming';
  });
}

/** Words read out (and shown for errors) for each step status: never colour alone. */
export const STEP_STATUS_TEXT: Record<StepStatus, string> = {
  done: 'Done',
  current: 'Current step',
  upcoming: 'Not started',
  error: 'Needs attention',
};

/** JumpBar: the section "in view" = the first section, in page order, that is intersecting; when none is, keep `prev`. */
export function pickCurrentSection(order: readonly string[], visible: Readonly<Record<string, boolean>>, prev: string | null): string | null {
  return order.find((id) => visible[id]) ?? prev;
}

/**
 * Horizontal delta to scroll a row by so the item (viewport rects) is fully visible; 0 when it already is.
 * Works in LTR and RTL because it only uses rect deltas.
 */
export function rowScrollDelta(row: { left: number; right: number }, item: { left: number; right: number }, pad = 8): number {
  if (item.left < row.left + pad) return item.left - row.left - pad;
  if (item.right > row.right - pad) return item.right - row.right + pad;
  return 0;
}
