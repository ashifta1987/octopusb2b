'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  ExternalLink,
  Monitor,
  MoreHorizontal,
  PanelRight,
  RefreshCw,
  Rows3,
  Rows4,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable, useHotkey } from '../hooks';
import {
  GRID_PAGE_SIZES,
  clampGridPage,
  clampGridWidth,
  filterGridRows,
  gridHeaderCheck,
  gridPageCount,
  gridPageRange,
  nextGridSort,
  paginateGridRows,
  sortGridRows,
  toggleGridAll,
  toggleGridRow,
  type GridCellValue,
  type GridSort,
} from '../grid-state';
import { Button, IconButton } from './button';
import { ContextMenu, type ContextMenuAnchor, type ContextMenuItem } from './context-menu';
import { EmptyState, ErrorState, Skeleton } from './states';
import { GridColumnsMenu, GridFilterChips, GridFilterPanel, type GridFilterChip, type GridFilterCondition, type GridFilterField, type GridFilterJoin } from './grid-toolbar';

export type { GridSort };

export type GridColumn<T> = {
  id: string;
  /** Plain-text header (also used by the columns menu, sort and resize labels). */
  header: string;
  /** Money columns: shown in the header, "Amount (US$)"; cells then show plain figures or `<Money>`. */
  currency?: string;
  /** Value for sorting, searching, copying and the phone list. */
  accessor?: (row: T) => GridCellValue;
  /** Cell content (defaults to the accessor's text). */
  cell?: (row: T) => ReactNode;
  /** Right-aligned tabular figures (money, quantities). */
  numeric?: boolean;
  /** Width in px (default 140); resizable between minWidth (64) and maxWidth (640). */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Default: true when there's an accessor. */
  sortable?: boolean;
  /** Default true; the first column is always shown. */
  hideable?: boolean;
  /** Hidden at first (the user can show it from Columns). */
  defaultHidden?: boolean;
};

export type GridSavedView = { id: string; label: string; shared?: boolean };
export type GridBulkAction<T> = { id: string; label: string; icon?: LucideIcon; onClick: (rows: T[]) => void };
export type GridOpenOptions = { newTab: boolean };
export type GridExportFormat = 'csv' | 'xlsx';
export type { GridFilterChip, GridFilterCondition, GridFilterField, GridFilterJoin };

export type OctopusDataGridProps<T> = {
  /** Accessible name of the table, e.g. "Invoices". */
  label: string;
  rows: T[];
  columns: GridColumn<T>[];
  getRowId: (row: T) => string;
  /** The record number ("INV-1042"): used for checkbox labels, "Copy number" and menu names. */
  rowNumber?: (row: T) => string;

  /* states */
  loading?: boolean;
  /** Error message (true = the default message); shows ErrorState with Try again. */
  error?: boolean | string;
  onRetry?: () => void;
  /** Shown when there are no rows and no filters, e.g. "No invoices yet". */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  onClearFilters?: () => void;
  onSaveView?: () => void;
  /** Heading level of the empty/error titles (default 3). */
  headingLevel?: 2 | 3 | 4;

  /* sort (client-side unless manualSort; onSortChange always fires so the page can put ?sort= in the URL) */
  sort?: GridSort;
  defaultSort?: GridSort;
  onSortChange?: (sort: GridSort) => void;
  manualSort?: boolean;

  /* selection */
  selectable?: boolean;
  selected?: string[];
  defaultSelected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** Bulk bar text after "n selected", e.g. "balance US$ 4,730.00". */
  bulkSummary?: (rows: T[]) => ReactNode;
  bulkActions?: GridBulkAction<T>[];

  /* row actions */
  onOpenRow?: (row: T, opts: GridOpenOptions) => void;
  onOpenInDrawer?: (row: T) => void;
  /** Extra menu items for a row (destructive ones go last, in red). */
  rowActions?: (row: T) => ContextMenuItem[];

  /* pagination (client-side unless manualPagination + totalRows) */
  pagination?: boolean;
  pageSizes?: readonly number[];
  page?: number;
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  defaultPageSize?: number;
  onPageSizeChange?: (size: number) => void;
  manualPagination?: boolean;
  totalRows?: number;

  /** Virtualise the body above this many rows (default 200). */
  virtualizeAbove?: number;
  /** Max height of the scroll box (the header sticks inside it). Default "min(70vh, 640px)". */
  maxHeight?: string;

  /* toolbar */
  search?: string;
  defaultSearch?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  /** Search is done by the server (no client filtering). */
  manualFiltering?: boolean;
  views?: GridSavedView[];
  viewId?: string;
  onViewChange?: (id: string) => void;
  filters?: GridFilterChip[];
  onRemoveFilter?: (id: string) => void;
  filterFields?: GridFilterField[];
  onApplyFilters?: (conditions: GridFilterCondition[], join: GridFilterJoin) => void;
  /** Shows the Compact / Comfortable toggle; the choice sets data-density on the grid only. */
  densityToggle?: boolean;
  /** Column ids the user may export (permissions: no cost or supplier columns without the right). Shows Export. */
  exportColumns?: string[];
  onExport?: (format: GridExportFormat, columnIds: string[]) => void;
  onRefresh?: () => void;

  /** "/" focuses this grid's search. Turn off on secondary grids on the same page. Default true. */
  hotkeys?: boolean;
  /** Rows listed read-only on phones (default 20). */
  phoneRows?: number;
  className?: string;
  'data-testid'?: string;
};

const SELECT_W = 40;
const ACTIONS_W = 52;
const SKELETON_ROWS = 8;
/** Native checkbox with a 24 px target (WCAG 2.5.8) drawn as a 16 px box: appearance none + ::before box / ::after tick. */
const CHECK =
  'relative m-0 size-6 shrink-0 cursor-pointer appearance-none rounded-[4px] align-middle before:absolute before:inset-1 before:rounded-[3px] before:border-[1.5px] before:border-ods-slate before:bg-ods-surface checked:before:border-ods-blue checked:before:bg-ods-blue indeterminate:before:border-ods-blue indeterminate:before:bg-ods-blue checked:after:absolute checked:after:start-[9px] checked:after:top-[6px] checked:after:h-[9px] checked:after:w-[5px] checked:after:rotate-45 checked:after:border-e-2 checked:after:border-b-2 checked:after:border-white indeterminate:after:absolute indeterminate:after:inset-x-[8px] indeterminate:after:top-[11px] indeterminate:after:h-0.5 indeterminate:after:bg-white disabled:cursor-not-allowed disabled:opacity-50';

/**
 * OctopusDataGrid (Part 7.2) — the Back Office grid. Foundations:
 * - Layout: a real `<table>` (th scope="col", one Tab stop per row); rows `h-ods-row` (36 compact / 52 comfortable),
 *   sticky `h-ods-head` header inside its own scroll box, checkbox + first data column frozen (sticky
 *   inset-inline-start) with a divider; numeric columns right-aligned with tabular figures, currency in the header.
 * - Columns: sort (header button, `aria-sort`, arrow shows direction, ascending → descending → none), resize (drag the
 *   header edge, or focus the `role="separator"` handle and use ← →, Shift for bigger steps), show/hide (Columns).
 * - Selection: native checkboxes, header select-all with indeterminate → navy bulk bar "n selected · …" with actions
 *   and Clear selection; the count is announced (aria-live).
 * - Row actions: ⋯ button, right-click or Shift+F10 → ContextMenu (Open in new tab, Open in drawer, Copy number,
 *   `rowActions`, destructive last in red).
 * - Keyboard (focus a row with Tab): ↑ ↓ or J K move, Home/End, Enter opens (`onOpenRow`), Ctrl/⌘ Enter opens in a new
 *   tab, Space selects, Shift+F10 / Menu key opens the row menu; "/" anywhere focuses the grid search.
 *   Ctrl/⌘-click or middle-click a row opens it in a new tab.
 * - Virtualised above `virtualizeAbove` (200) rows with @tanstack/react-virtual: spacer rows keep the table layout, so
 *   the sticky header and frozen column still work; `aria-rowcount` / `aria-rowindex` give the real positions.
 * - Pager 25 / 50 / 100. Toolbar shells: search, saved views, filter chips + advanced filter panel, columns, density,
 *   export (only `exportColumns`), refresh.
 * - States: loading skeleton rows (header stays), "No results for these filters" (Clear filters / Save as view),
 *   error with Try again.
 * - Sort/selection/resize state is implemented here (pure helpers in grid-state.ts) rather than with
 *   @tanstack/react-table v9 — see the note at the top of grid-state.ts.
 * Phones (< 768): grids are staff desktop tools. The table is replaced by a note "Open this on a computer to edit" and a
 * read-only stacked list of the first `phoneRows` rows (search stays; selection, menus and the pager are desktop only).
 */
export function OctopusDataGrid<T>(props: OctopusDataGridProps<T>) {
  const {
    label,
    rows,
    columns,
    getRowId,
    rowNumber,
    loading,
    error,
    onRetry,
    emptyTitle,
    emptyDescription,
    onClearFilters,
    onSaveView,
    headingLevel = 3,
    manualSort,
    selectable,
    bulkSummary,
    bulkActions = [],
    onOpenRow,
    onOpenInDrawer,
    rowActions,
    pagination = true,
    pageSizes = GRID_PAGE_SIZES,
    manualPagination,
    totalRows,
    virtualizeAbove = 200,
    maxHeight = 'min(70vh, 640px)',
    searchPlaceholder,
    manualFiltering,
    views,
    viewId,
    onViewChange,
    filters = [],
    onRemoveFilter,
    filterFields,
    onApplyFilters,
    densityToggle,
    exportColumns,
    onExport,
    onRefresh,
    hotkeys = true,
    phoneRows = 20,
    className,
    'data-testid': testId,
  } = props;

  const uid = useId();
  const [sort, setSort] = useControllable<GridSort>(props.sort, props.defaultSort ?? null, props.onSortChange);
  const [page, setPage] = useControllable(props.page, props.defaultPage ?? 0, props.onPageChange);
  const [pageSize, setPageSize] = useControllable(props.pageSize, props.defaultPageSize ?? pageSizes[0] ?? 25, props.onPageSizeChange);
  const [selectedArr, setSelectedArr] = useControllable<string[]>(props.selected, props.defaultSelected ?? [], props.onSelectedChange);
  const [search, setSearch] = useControllable(props.search, props.defaultSearch ?? '', props.onSearchChange);
  const [density, setDensity] = useState<'compact' | 'comfortable' | null>(null);
  const [inheritedDensity, setInheritedDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(columns.map((c) => [c.id, c.width ?? 140])));
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(columns.filter((c, i) => i > 0 && c.defaultHidden).map((c) => c.id)));
  const [filterOpen, setFilterOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const [menu, setMenu] = useState<{ row: T; anchor: ContextMenuAnchor } | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuReturn = useRef<HTMLElement | null>(null);
  const wantFocus = useRef<number | null>(null);
  const rowH = useRef(36);

  const selected = useMemo(() => new Set(selectedArr), [selectedArr]);
  const visibleCols = columns.filter((c, i) => i === 0 || !hiddenCols.has(c.id));
  const colById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const hasActions = !!(onOpenRow || onOpenInDrawer || rowNumber || rowActions);
  const rowLabel = (r: T) => rowNumber?.(r) ?? getRowId(r);
  const text = (v: GridCellValue) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v));

  const processed = useMemo(() => {
    let r: T[] = rows;
    if (!manualFiltering && search) r = filterGridRows(r, search, (row) => columns.map((c) => text(c.accessor?.(row))).join(' '));
    if (!manualSort && sort) r = sortGridRows(r, sort, (row, id) => colById.get(id)?.accessor?.(row));
    return r;
  }, [rows, columns, colById, search, sort, manualFiltering, manualSort]);

  const total = manualPagination ? (totalRows ?? rows.length) : processed.length;
  const safePage = pagination ? clampGridPage(page, total, pageSize) : 0;
  const pageRows = pagination && !manualPagination ? paginateGridRows(processed, safePage, pageSize) : processed;
  const virtual = !loading && !error && pageRows.length > virtualizeAbove;
  const ids = pageRows.map(getRowId);
  const headState = gridHeaderCheck(ids, selected);
  const selectedRows = rows.filter((r) => selected.has(getRowId(r)));
  const isFiltered = !!search || filters.length > 0;
  const colCount = visibleCols.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);
  const tableWidth = visibleCols.reduce((s, c) => s + (widths[c.id] ?? 140), 0) + (selectable ? SELECT_W : 0) + (hasActions ? ACTIONS_W : 0);
  const fIdx = Math.min(focusIdx, Math.max(0, pageRows.length - 1));

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns functions that read live scroll state
  const virtualizer = useVirtualizer({
    count: virtual ? pageRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH.current,
    overscan: 12,
    initialRect: { width: 1200, height: 520 },
  });

  // the row height follows the density token (36 / 52)
  useLayoutEffect(() => {
    const el = scrollRef.current ?? rootRef.current;
    if (!el) return;
    const h = parseFloat(getComputedStyle(el).getPropertyValue('--ods-row-h'));
    if (h && h !== rowH.current) {
      rowH.current = h;
      virtualizer.measure();
    }
    const d = rootRef.current?.parentElement?.closest('[data-density]')?.getAttribute('data-density');
    if (d === 'compact' || d === 'comfortable') setInheritedDensity(d);
  }, [density, virtualizer]);

  // move DOM focus to the requested row once it is rendered
  useEffect(() => {
    if (wantFocus.current === null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`tr[data-row-index="${wantFocus.current}"]`);
    if (el) {
      el.focus({ preventScroll: virtual });
      wantFocus.current = null;
    }
  });

  useHotkey('/', () => searchRef.current?.focus(), { enabled: hotkeys });

  const focusRow = (i: number) => {
    const n = Math.max(0, Math.min(pageRows.length - 1, i));
    setFocusIdx(n);
    wantFocus.current = n;
    if (virtual) virtualizer.scrollToIndex(n, { align: 'auto' });
  };
  const toggleSort = (id: string) => {
    setSort(nextGridSort(sort, id));
    setPage(0);
  };
  const setSel = (s: Set<string>) => setSelectedArr([...s]);
  const openMenu = (row: T, anchor: ContextMenuAnchor, from: HTMLElement | null) => {
    menuReturn.current = from;
    setMenu({ row, anchor });
  };

  const menuItems = (row: T): ContextMenuItem[] => [
    ...(onOpenRow ? [{ id: 'open-tab', label: 'Open in new tab', icon: ExternalLink, shortcut: 'Ctrl ↵', onSelect: () => onOpenRow(row, { newTab: true }) }] : []),
    ...(onOpenInDrawer ? [{ id: 'open-drawer', label: 'Open in drawer', icon: PanelRight, onSelect: () => onOpenInDrawer(row) }] : []),
    ...(rowNumber ? [{ id: 'copy', label: 'Copy number', icon: Copy, onSelect: () => void navigator.clipboard?.writeText(rowNumber(row)).catch(() => undefined) }] : []),
    ...(rowActions ? [{ id: '__sep-actions', separator: true }, ...rowActions(row)] : []),
  ];

  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-row-index]');
    if (!tr || e.target !== tr) return; // keys inside a cell (checkbox, ⋯, links) keep their own behaviour
    const i = Number(tr.dataset.rowIndex);
    const row = pageRows[i];
    const k = e.key;
    if (k === 'ArrowDown' || (k === 'j' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      focusRow(i + 1);
    } else if (k === 'ArrowUp' || (k === 'k' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      focusRow(i - 1);
    } else if (k === 'Home') {
      e.preventDefault();
      focusRow(0);
    } else if (k === 'End') {
      e.preventDefault();
      focusRow(pageRows.length - 1);
    } else if (k === 'Enter' && row && onOpenRow) {
      e.preventDefault();
      onOpenRow(row, { newTab: e.ctrlKey || e.metaKey });
    } else if (k === ' ' && row && selectable) {
      e.preventDefault();
      setSel(toggleGridRow(selected, getRowId(row)));
    } else if (((k === 'F10' && e.shiftKey) || k === 'ContextMenu') && row && hasActions) {
      e.preventDefault();
      openMenu(row, tr.querySelector<HTMLElement>('[data-row-menu]') ?? tr, tr);
    }
  };

  /* ───────── resize ───────── */
  const setWidth = (id: string, w: number) => {
    const c = colById.get(id);
    setWidths((prev) => ({ ...prev, [id]: clampGridWidth(w, c?.minWidth ?? 64, c?.maxWidth ?? 640) }));
  };
  const startResize = (e: React.PointerEvent<HTMLElement>, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    const start = widths[id] ?? 140;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(id, start + (rtl ? startX - ev.clientX : ev.clientX - startX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  /* ───────── body rows ───────── */
  const vItems = virtual ? virtualizer.getVirtualItems() : [];
  const padTop = virtual && vItems.length ? vItems[0].start : 0;
  const padBottom = virtual && vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;
  const renderIdx = virtual ? vItems.map((v) => v.index) : pageRows.map((_, i) => i);
  const rowOffset = pagination && !manualPagination ? safePage * pageSize : 0;

  const frozenStyle = (start: number) => ({ insetInlineStart: start });
  const cellBox = 'h-ods-row border-b border-ods-line py-0';
  const cellBase = `${cellBox} px-3 overflow-hidden text-ellipsis whitespace-nowrap`;

  const renderRow = (i: number) => {
    const row = pageRows[i];
    const id = getRowId(row);
    const isSel = selected.has(id);
    const bg = isSel ? 'bg-ods-blue-tint' : 'bg-ods-surface group-hover/row:bg-ods-canvas';
    return (
      <tr
        key={id}
        data-testid="grid-row"
        data-row-index={i}
        aria-rowindex={virtual ? rowOffset + i + 2 : undefined}
        tabIndex={i === fIdx ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocusIdx(i);
        }}
        onClick={(e) => {
          setFocusIdx(i);
          if ((e.ctrlKey || e.metaKey) && onOpenRow) onOpenRow(row, { newTab: true });
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && onOpenRow) {
            e.preventDefault();
            onOpenRow(row, { newTab: true });
          }
        }}
        onDoubleClick={() => onOpenRow?.(row, { newTab: false })}
        onContextMenu={(e) => {
          if (!hasActions) return;
          e.preventDefault();
          setFocusIdx(i);
          openMenu(row, { x: e.clientX, y: e.clientY }, e.currentTarget);
        }}
        className="group/row scroll-mt-[var(--ods-head-h)] outline-offset-[-3px]"
      >
        {selectable ? (
          <td className={cx(cellBox, bg, 'sticky z-[2] px-0 text-center')} style={frozenStyle(0)}>
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => setSel(toggleGridRow(selected, id))}
              aria-label={`Select ${rowLabel(row)}`}
              className={CHECK}
            />
          </td>
        ) : null}
        {visibleCols.map((c, ci) => (
          <td
            key={c.id}
            className={cx(
              cellBase,
              bg,
              c.numeric && 'text-end tabular-nums',
              ci === 0 && 'sticky z-[2] border-e border-e-ods-line-strong font-semibold text-ods-navy',
            )}
            style={ci === 0 ? frozenStyle(selectable ? SELECT_W : 0) : undefined}
          >
            {c.cell ? c.cell(row) : text(c.accessor?.(row))}
          </td>
        ))}
        {hasActions ? (
          <td className={cx(cellBox, bg, 'px-1 text-center')}>
            <button
              type="button"
              data-row-menu
              aria-label={`Actions for ${rowLabel(row)}`}
              aria-haspopup="menu"
              aria-expanded={menu !== null && getRowId(menu.row) === id}
              onClick={(e) => {
                e.stopPropagation();
                openMenu(row, e.currentTarget, e.currentTarget);
              }}
              className="inline-grid size-[calc(var(--ods-row-h)-8px)] max-h-ods-control max-w-ods-control place-items-center rounded-ods-control align-middle text-ods-slate hover:bg-ods-line hover:text-ods-navy"
            >
              <Icon icon={MoreHorizontal} />
            </button>
          </td>
        ) : null}
      </tr>
    );
  };

  const fullRow = (content: ReactNode) => (
    <tr>
      <td colSpan={colCount} className="border-b border-ods-line bg-ods-surface">
        <div className="sticky start-0 w-full max-w-[min(100%,100vw)]">{content}</div>
      </td>
    </tr>
  );

  const errorText = typeof error === 'string' ? error : undefined;
  const emptyNode = isFiltered ? (
    <EmptyState
      headingLevel={headingLevel}
      title="No results for these filters"
      description="Try fewer filters or another search."
      action={
        <>
          {onClearFilters ? (
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : null}
          {onSaveView ? (
            <Button variant="ghost" size="sm" onClick={onSaveView}>
              Save as view
            </Button>
          ) : null}
        </>
      }
    />
  ) : (
    <EmptyState headingLevel={headingLevel} title={emptyTitle ?? 'Nothing here yet'} description={emptyDescription} />
  );
  const errorNode = <ErrorState headingLevel={headingLevel} title={errorText ?? 'We couldn’t load these rows.'} onRetry={onRetry} />;

  let body: ReactNode;
  if (loading) {
    body = Array.from({ length: SKELETON_ROWS }, (_, i) => (
      <tr key={`sk${i}`} aria-hidden="true">
        {selectable ? <td className={cx(cellBase, 'bg-ods-surface')} /> : null}
        {visibleCols.map((c, ci) => (
          <td key={c.id} className={cx(cellBase, 'bg-ods-surface', ci === 0 && 'sticky z-[2] border-e border-e-ods-line-strong')} style={ci === 0 ? frozenStyle(selectable ? SELECT_W : 0) : undefined}>
            <Skeleton silent className={cx('h-3', c.numeric ? 'ms-auto w-1/2' : ci % 2 ? 'w-2/3' : 'w-4/5')} />
          </td>
        ))}
        {hasActions ? <td className={cx(cellBase, 'bg-ods-surface')} /> : null}
      </tr>
    ));
  } else if (error) {
    body = fullRow(errorNode);
  } else if (!pageRows.length) {
    body = fullRow(emptyNode);
  } else {
    body = (
      <>
        {padTop > 0 ? (
          <tr aria-hidden="true">
            <td colSpan={colCount} style={{ height: padTop, padding: 0, border: 0 }} />
          </tr>
        ) : null}
        {renderIdx.map(renderRow)}
        {padBottom > 0 ? (
          <tr aria-hidden="true">
            <td colSpan={colCount} style={{ height: padBottom, padding: 0, border: 0 }} />
          </tr>
        ) : null}
      </>
    );
  }

  const headCell = 'sticky top-0 h-ods-head border-b border-ods-line-strong bg-ods-canvas px-3 text-ods-label font-semibold text-ods-slate whitespace-nowrap';
  const range = gridPageRange(safePage, pageSize, total);
  const filterPanelId = `${uid}-filters`;
  const shownDensity = density ?? inheritedDensity;
  const allowedExport = (exportColumns ?? []).filter((id) => colById.has(id));

  return (
    <div ref={rootRef} data-testid={testId} data-density={density ?? undefined} className={cx('flex min-w-0 flex-col gap-2', className)}>
      {/* toolbar */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex h-ods-control w-full min-w-0 items-center gap-2 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 focus-within:border-ods-blue ods-tablet:w-60">
          <Icon icon={Search} className="text-ods-slate" />
          <span className="sr-only">Search in {label.toLowerCase()}</span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder ?? `Search in ${label.toLowerCase()}`}
            className="h-full min-w-0 flex-1 bg-transparent text-ods-body text-ods-text placeholder:text-ods-slate"
          />
          {hotkeys ? <kbd aria-hidden className="hidden rounded-[4px] border border-ods-line-strong px-1 font-ods text-[11px] text-ods-slate ods-tablet:inline">/</kbd> : null}
        </label>
        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 ods-tablet:flex">
          <GridFilterChips
            filters={filters}
            onRemove={onRemoveFilter}
            onAdd={filterFields ? () => setFilterOpen(!filterOpen) : undefined}
            addExpanded={filterOpen}
            addControls={filterPanelId}
          />
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {views?.length ? (
              <label className="flex items-center gap-2 text-ods-small text-ods-slate">
                View
                <select
                  value={viewId}
                  onChange={(e) => onViewChange?.(e.target.value)}
                  className="h-ods-control w-48 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text"
                >
                  {views.some((v) => !v.shared) ? (
                    <optgroup label="My views">
                      {views.filter((v) => !v.shared).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {views.some((v) => v.shared) ? (
                    <optgroup label="Shared views">
                      {views.filter((v) => v.shared).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            ) : null}
            <GridColumnsMenu
              columns={columns.map((c, i) => ({ id: c.id, label: c.header, visible: i === 0 || !hiddenCols.has(c.id), hideable: i === 0 ? false : c.hideable !== false }))}
              onToggle={(id, vis) =>
                setHiddenCols((prev) => {
                  const n = new Set(prev);
                  if (vis) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
            />
            {densityToggle ? (
              <div role="group" aria-label="Row density" className="flex">
                <IconButton icon={Rows4} label="Compact rows" variant="secondary" pressed={shownDensity === 'compact'} onClick={() => setDensity('compact')} className="rounded-e-none" />
                <IconButton icon={Rows3} label="Comfortable rows" variant="secondary" pressed={shownDensity === 'comfortable'} onClick={() => setDensity('comfortable')} className="-ms-px rounded-s-none" />
              </div>
            ) : null}
            {onRefresh ? <IconButton icon={RefreshCw} label="Refresh" variant="secondary" onClick={onRefresh} /> : null}
            {exportColumns && onExport ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  iconStart={Download}
                  aria-haspopup="menu"
                  aria-expanded={!!exportAnchor}
                  aria-describedby={`${uid}-export-note`}
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                >
                  Export
                </Button>
                <span id={`${uid}-export-note`} className="sr-only">
                  Exports {allowedExport.length} of {columns.length} columns with the current filters. Columns you don’t have permission for are left out.
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {filterOpen && filterFields ? (
        <div className="hidden ods-tablet:block">
          <GridFilterPanel
            id={filterPanelId}
            fields={filterFields}
            onCancel={() => setFilterOpen(false)}
            onApply={(c, j) => {
              onApplyFilters?.(c, j);
              setFilterOpen(false);
            }}
          />
        </div>
      ) : null}

      {/* bulk bar */}
      {selectable && selectedRows.length ? (
        <div
          role="group"
          aria-label="Bulk actions"
          data-testid="grid-bulkbar"
          className="hidden min-h-[calc(var(--ods-control-h)+8px)] flex-wrap items-center gap-2 rounded-ods-control bg-ods-navy px-3 py-1 text-ods-body text-white ods-tablet:flex"
        >
          <strong className="font-semibold">{selectedRows.length} selected</strong>
          {bulkSummary ? <span className="text-white/80">· {bulkSummary(selectedRows)}</span> : null}
          {bulkActions.length ? <span aria-hidden className="mx-1 h-5 w-px bg-white/25" /> : null}
          {bulkActions.map((a) => (
            <Button key={a.id} variant="on-navy" size="sm" iconStart={a.icon} onClick={() => a.onClick(selectedRows)}>
              {a.label}
            </Button>
          ))}
          <Button
            variant="on-navy"
            size="sm"
            className="ms-auto"
            onClick={() => {
              setSel(new Set());
              requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>('tr[tabindex="0"]')?.focus());
            }}
          >
            Clear selection
          </Button>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {selectable ? (selectedRows.length ? `${selectedRows.length} selected` : '') : ''}
      </p>
      {loading ? (
        <p role="status" className="sr-only">
          Loading {label.toLowerCase()}
        </p>
      ) : null}

      {/* desktop table */}
      <div className="hidden min-w-0 ods-tablet:block">
        <div ref={scrollRef} className="relative overflow-auto rounded-ods-card border border-ods-line bg-ods-surface" style={{ maxHeight }}>
          <table
            aria-label={label}
            aria-rowcount={virtual ? rowOffset + total + 1 : undefined}
            aria-busy={loading || undefined}
            className="table-fixed border-separate border-spacing-0 text-ods-table text-ods-text"
            style={{ width: tableWidth, minWidth: '100%' }}
          >
            <colgroup>
              {selectable ? <col style={{ width: SELECT_W }} /> : null}
              {visibleCols.map((c) => (
                <col key={c.id} style={{ width: widths[c.id] ?? 140 }} />
              ))}
              {hasActions ? <col style={{ width: ACTIONS_W }} /> : null}
            </colgroup>
            <thead>
              <tr aria-rowindex={virtual ? 1 : undefined}>
                {selectable ? (
                  <th scope="col" className={cx(headCell, 'z-(--z-sticky) px-0 text-center')} style={{ ...frozenStyle(0), zIndex: 'calc(var(--z-sticky) + 1)' }}>
                    <input
                      type="checkbox"
                      checked={headState === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = headState === 'some';
                      }}
                      disabled={!ids.length}
                      onChange={() => setSel(toggleGridAll(ids, selected))}
                      aria-label={pagination ? 'Select all rows on this page' : `Select all ${ids.length} rows`}
                      className={CHECK}
                    />
                  </th>
                ) : null}
                {visibleCols.map((c, ci) => {
                  const sortable = c.sortable ?? !!c.accessor;
                  const dir = sort?.id === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined;
                  const head = c.currency ? `${c.header} (${c.currency})` : c.header;
                  const w = widths[c.id] ?? 140;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={sortable ? (dir ?? 'none') : undefined}
                      className={cx(headCell, 'relative z-(--z-sticky)', c.numeric ? 'text-end' : 'text-start', ci === 0 && 'border-e border-e-ods-line-strong')}
                      style={ci === 0 ? { ...frozenStyle(selectable ? SELECT_W : 0), position: 'sticky', zIndex: 'calc(var(--z-sticky) + 1)' } : undefined}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.id)}
                          className={cx('inline-flex h-full max-w-full items-center gap-1 rounded-[4px] hover:text-ods-navy', c.numeric && 'flex-row-reverse', dir && 'text-ods-navy')}
                        >
                          <span className="truncate">{head}</span>
                          <Icon icon={dir === 'ascending' ? ArrowUp : dir === 'descending' ? ArrowDown : ChevronsUpDown} size="xs" className={dir ? '' : 'opacity-50'} />
                        </button>
                      ) : (
                        <span className="truncate">{head}</span>
                      )}
                      <span
                        role="separator"
                        tabIndex={0}
                        aria-orientation="vertical"
                        aria-label={`Resize ${c.header} column`}
                        aria-valuenow={w}
                        aria-valuemin={c.minWidth ?? 64}
                        aria-valuemax={c.maxWidth ?? 640}
                        onPointerDown={(e) => startResize(e, c.id)}
                        onKeyDown={(e) => {
                          const step = e.shiftKey ? 48 : 16;
                          const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                            e.preventDefault();
                            const grow = (e.key === 'ArrowRight') !== rtl;
                            setWidth(c.id, w + (grow ? step : -step));
                          }
                        }}
                        className="absolute inset-y-0 -end-1 z-[1] w-2 cursor-col-resize touch-none outline-offset-[-2px] after:absolute after:inset-y-2 after:start-1/2 after:w-px after:bg-ods-line-strong hover:after:w-0.5 hover:after:bg-ods-blue"
                      />
                    </th>
                  );
                })}
                {hasActions ? (
                  <th scope="col" className={cx(headCell, 'z-(--z-sticky)')}>
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody onKeyDown={onBodyKeyDown}>{body}</tbody>
          </table>
        </div>

        {/* pager */}
        {pagination && !loading && !error && total > 0 ? (
          <nav aria-label={`${label} pages`} className="mt-2 flex flex-wrap items-center gap-3 text-ods-small text-ods-slate">
            <label className="flex items-center gap-2">
              Rows per page
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text"
              >
                {pageSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <span className="ms-auto tabular-nums" aria-live="polite">
              {range.from.toLocaleString('en-US')}–{range.to.toLocaleString('en-US')} of {range.total.toLocaleString('en-US')}
            </span>
            <span className="flex gap-1">
              <IconButton icon={ChevronLeft} label="Previous page" variant="secondary" className="rtl:-scale-x-100" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
              <IconButton
                icon={ChevronRight}
                label="Next page"
                variant="secondary"
                className="rtl:-scale-x-100"
                disabled={safePage >= gridPageCount(total, pageSize) - 1}
                onClick={() => setPage(safePage + 1)}
              />
            </span>
          </nav>
        ) : !pagination && !loading && !error && total > 0 ? (
          <p className="mt-2 text-ods-small text-ods-slate tabular-nums">{total.toLocaleString('en-US')} rows</p>
        ) : null}
      </div>

      {/* phones: read-only list */}
      <div className="ods-tablet:hidden">
        <p className="flex items-start gap-2 rounded-ods-control bg-ods-info-tint p-3 text-ods-small text-ods-info">
          <Icon icon={Monitor} className="mt-0.5" />
          <span>
            <strong className="font-semibold">Open this on a computer to edit.</strong> On a phone this list is read-only.
          </span>
        </p>
        {loading ? (
          <div className="mt-2 rounded-ods-card border border-ods-line bg-ods-surface p-3">
            <Skeleton lines={4} silent />
          </div>
        ) : error ? (
          <div className="mt-2 rounded-ods-card border border-ods-line bg-ods-surface">{errorNode}</div>
        ) : !processed.length ? (
          <div className="mt-2 rounded-ods-card border border-ods-line bg-ods-surface">{emptyNode}</div>
        ) : (
          <>
            <ul aria-label={`${label} (read-only)`} className="mt-2 divide-y divide-ods-line rounded-ods-card border border-ods-line bg-ods-surface">
              {processed.slice(0, phoneRows).map((row) => (
                <li key={getRowId(row)} className="p-3">
                  <div className="font-semibold text-ods-navy">{visibleCols[0]?.cell ? visibleCols[0].cell(row) : text(visibleCols[0]?.accessor?.(row))}</div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-ods-small">
                    {visibleCols.slice(1, 5).map((c) => (
                      <div key={c.id} className="min-w-0">
                        <dt className="text-ods-slate">{c.currency ? `${c.header} (${c.currency})` : c.header}</dt>
                        <dd className={cx('m-0 truncate text-ods-text', c.numeric && 'tabular-nums')}>{c.cell ? c.cell(row) : text(c.accessor?.(row))}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            {total > phoneRows ? (
              <p className="mt-2 text-ods-small text-ods-slate">
                Showing {Math.min(phoneRows, processed.length)} of {total.toLocaleString('en-US')}.
              </p>
            ) : null}
          </>
        )}
      </div>

      <ContextMenu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        items={menu ? menuItems(menu.row) : []}
        label={menu ? `Actions for ${rowLabel(menu.row)}` : 'Row actions'}
        returnFocusRef={menuReturn}
        onClose={() => setMenu(null)}
      />
      {exportColumns && onExport ? (
        <ContextMenu
          open={!!exportAnchor}
          anchor={exportAnchor}
          label="Export"
          data-testid="grid-export-menu"
          onClose={() => setExportAnchor(null)}
          items={[
            { id: 'csv', label: `Export CSV · ${allowedExport.length} columns`, icon: Download, onSelect: () => onExport('csv', allowedExport) },
            { id: 'xlsx', label: `Export XLSX · ${allowedExport.length} columns`, icon: Download, onSelect: () => onExport('xlsx', allowedExport) },
          ]}
        />
      ) : null}
    </div>
  );
}
