/**
 * OctopusDataGrid + ContextMenu helpers (Part 7.2) — pure, server-safe, unit-tested in tests/unit/ods-data.test.ts.
 *
 * Why not @tanstack/react-table: v9.3 replaced the v8 hooks with a store/atom model (`table.Subscribe`, `table.atoms`,
 * feature plugins). For the grid's needs — one sort key, a selection set, column widths/visibility and pagination,
 * with the server doing the real work in production (`manual*` props) — these few pure functions are smaller, fully
 * typed and testable, and keep the component free of a fast-moving API. Revisit if we need grouping or pivoting.
 */

export type GridSort = { id: string; desc: boolean } | null;
export type GridCellValue = string | number | Date | boolean | null | undefined;

/** Header click cycle: none → ascending → descending → none. */
export function nextGridSort(current: GridSort, id: string): GridSort {
  if (!current || current.id !== id) return { id, desc: false };
  if (!current.desc) return { id, desc: true };
  return null;
}

const isEmpty = (v: GridCellValue) => v === null || v === undefined || v === '';

function cmp(a: GridCellValue, b: GridCellValue): number {
  if (a instanceof Date || b instanceof Date) return +new Date(a as Date) - +new Date(b as Date);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/** Stable sort by one column; empty values always last (both directions). */
export function sortGridRows<T>(rows: readonly T[], sort: GridSort, getValue: (row: T, columnId: string) => GridCellValue): T[] {
  if (!sort) return [...rows];
  return rows
    .map((row, i) => ({ row, i, v: getValue(row, sort.id) }))
    .sort((x, y) => {
      const xe = isEmpty(x.v);
      const ye = isEmpty(y.v);
      if (xe || ye) return xe === ye ? x.i - y.i : xe ? 1 : -1;
      const c = cmp(x.v, y.v);
      return (sort.desc ? -c : c) || x.i - y.i;
    })
    .map((x) => x.row);
}

/** Case-insensitive "contains" across the given text of each row. */
export function filterGridRows<T>(rows: readonly T[], query: string, getText: (row: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => getText(r).toLowerCase().includes(q));
}

export const GRID_PAGE_SIZES = [25, 50, 100] as const;

export function gridPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** Clamps a 0-based page into range. */
export function clampGridPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(0, page), gridPageCount(total, pageSize) - 1);
}

export function paginateGridRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const p = clampGridPage(page, rows.length, pageSize);
  return rows.slice(p * pageSize, p * pageSize + pageSize);
}

/** "1–25 of 312" numbers (1-based, inclusive); from = 0 when empty. */
export function gridPageRange(page: number, pageSize: number, total: number): { from: number; to: number; total: number } {
  if (total <= 0) return { from: 0, to: 0, total: 0 };
  const p = clampGridPage(page, total, pageSize);
  return { from: p * pageSize + 1, to: Math.min(total, (p + 1) * pageSize), total };
}

export function clampGridWidth(width: number, min = 64, max = 640): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Header checkbox state for the rows on screen. */
export function gridHeaderCheck(visibleIds: readonly string[], selected: ReadonlySet<string>): 'none' | 'some' | 'all' {
  if (!visibleIds.length) return 'none';
  const n = visibleIds.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === visibleIds.length ? 'all' : 'some';
}

/** Header checkbox click: all selected → unselect those rows, otherwise select all of them. Other pages keep theirs. */
export function toggleGridAll(visibleIds: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (gridHeaderCheck(visibleIds, selected) === 'all') visibleIds.forEach((id) => next.delete(id));
  else visibleIds.forEach((id) => next.add(id));
  return next;
}

export function toggleGridRow(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Context menu order: normal items (tidy separators), then one separator, then destructive items last (Part 7.2). */
export function orderMenuItems<T extends { id: string; destructive?: boolean; separator?: boolean }>(items: readonly T[]): (T | { id: string; separator: true })[] {
  const normal = items.filter((i) => !i.destructive);
  const danger = items.filter((i) => i.destructive && !i.separator);
  const tidy: T[] = [];
  for (const i of normal) {
    if (i.separator && (!tidy.length || tidy[tidy.length - 1].separator)) continue;
    tidy.push(i);
  }
  while (tidy.length && tidy[tidy.length - 1].separator) tidy.pop();
  if (!danger.length) return tidy;
  return [...tidy, ...(tidy.length ? [{ id: '__danger-sep', separator: true as const }] : []), ...danger];
}
