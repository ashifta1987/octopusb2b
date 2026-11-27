'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cx } from '../cx';
import { useControllable } from '../hooks';
import { Icon } from '../icon';
import { EmptyState, ErrorState, Skeleton } from './states';

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Numbers and money: right-aligned (logical end) with tabular figures. */
  numeric?: boolean;
  align?: 'start' | 'end';
  sortable?: boolean;
  /** Value used for sorting (default: the cell must be sortable via this; without it the column can't sort locally). */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  /** The row's title: holds the row link and is the heading of the phone card. Mark exactly one column. */
  primary?: boolean;
  /** Leave this column out of the phone cards. */
  hideOnPhone?: boolean;
  /** Extra classes for th and td (e.g. a width). */
  className?: string;
};

export type DataTableSort = { id: string; direction: 'asc' | 'desc' };

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Required: names the table (and the phone list). */
  caption: string;
  /** Keep the caption for screen readers only. */
  captionHidden?: boolean;
  /** Makes each row a link (the primary cell is the link; the whole row is clickable). */
  rowHref?: (row: T) => string;
  sort?: DataTableSort | null;
  defaultSort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  /** The server sorts (e.g. ?sort= in the URL): rows are shown as given. */
  manualSort?: boolean;
  loading?: boolean;
  skeletonRows?: number;
  /** `true` = default ErrorState, or your own node. */
  error?: ReactNode;
  onRetry?: () => void;
  /** Custom empty state; default EmptyState with `emptyTitle`. */
  empty?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  /** Extra attributes per body row (e.g. data-testid). */
  getRowProps?: (row: T, index: number) => Record<`data-${string}`, string | undefined>;
  className?: string;
  'data-testid'?: string;
};

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * DataTable (comfortable lists, Part 2.5): 52 px rows / 44 px header (36 / 34 compact), caption, sortable headers
 * (button inside th, aria-sort on the sorted column), number columns right-aligned with tabular figures, optional row
 * links. Loading keeps the header and shows skeleton rows; empty and error replace the body.
 * Phones (< 768): the table is replaced by stacked cards — one card per row with "label: value" pairs, never a
 * sideways-scrolling table. Tablet/desktop: if columns don't fit, the table scrolls inside its own box.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  captionHidden,
  rowHref,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  manualSort,
  loading,
  skeletonRows = 5,
  error,
  onRetry,
  empty,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  getRowProps,
  className,
  'data-testid': testId,
}: DataTableProps<T>) {
  const [sort, setSort] = useControllable<DataTableSort | null>(sortProp, defaultSort, onSortChange);
  const primary = columns.find((c) => c.primary) ?? columns[0];

  const sorted = useMemo(() => {
    if (manualSort || !sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const out = [...rows].sort((a, b) => compare(get(a), get(b)));
    return sort.direction === 'desc' ? out.reverse() : out;
  }, [rows, columns, sort, manualSort]);

  const toggle = (id: string) => setSort(sort?.id === id && sort.direction === 'asc' ? { id, direction: 'desc' } : { id, direction: 'asc' });
  const end = (c: DataTableColumn<T>) => c.numeric || c.align === 'end';

  const state: 'error' | 'loading' | 'empty' | 'rows' = error ? 'error' : loading ? 'loading' : rows.length === 0 ? 'empty' : 'rows';
  const stateNode =
    state === 'error' ? (
      error === true ? <ErrorState onRetry={onRetry} /> : (error as ReactNode)
    ) : state === 'empty' ? (
      (empty ?? <EmptyState title={emptyTitle} description={emptyDescription} />)
    ) : null;

  const cellContent = (c: DataTableColumn<T>, row: T) => {
    const v = c.cell(row);
    if (rowHref && c.id === primary.id) {
      return (
        <Link href={rowHref(row)} className="font-semibold text-ods-blue underline-offset-4 after:absolute after:inset-0 hover:underline">
          {v}
        </Link>
      );
    }
    return v;
  };

  return (
    <div className={cx('min-w-0', className)} data-testid={testId}>
      {/* tablet + desktop: a real table */}
      <div className="hidden overflow-x-auto rounded-ods-card border border-ods-line bg-ods-surface ods-tablet:block">
        <table className="w-full border-collapse text-ods-table" aria-busy={loading || undefined}>
          <caption className={captionHidden ? 'sr-only' : 'px-3 py-2 text-start text-ods-label font-semibold text-ods-navy'}>{caption}</caption>
          <thead>
            <tr className="h-ods-head border-b border-ods-line bg-ods-canvas">
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx('px-3 text-ods-label font-semibold whitespace-nowrap text-ods-slate', end(c) ? 'text-end' : 'text-start', c.className)}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        className={cx(
                          'inline-flex min-h-[calc(var(--ods-head-h)-8px)] items-center gap-1 rounded-ods-control px-1 -mx-1 font-semibold hover:text-ods-navy',
                          active ? 'text-ods-navy' : 'text-ods-slate',
                          end(c) && 'flex-row-reverse',
                        )}
                      >
                        {c.header}
                        <Icon icon={active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown} size="xs" className={active ? undefined : 'opacity-70'} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {state === 'rows'
              ? sorted.map((row, i) => (
                  <tr
                    key={getRowId(row)}
                    {...getRowProps?.(row, i)}
                    className={cx('h-ods-row border-b border-ods-line last:border-b-0', rowHref && 'relative hover:bg-ods-canvas')}
                  >
                    {columns.map((c) =>
                      c.id === primary.id ? (
                        <th key={c.id} scope="row" className={cx('px-3 font-normal text-ods-navy', end(c) ? 'num text-end' : 'text-start', c.className)}>
                          {cellContent(c, row)}
                        </th>
                      ) : (
                        <td key={c.id} className={cx('px-3 text-ods-navy', end(c) ? 'num text-end whitespace-nowrap' : 'text-start', c.className)}>
                          {cellContent(c, row)}
                        </td>
                      ),
                    )}
                  </tr>
                ))
              : state === 'loading'
                ? Array.from({ length: skeletonRows }, (_, i) => (
                    <tr key={i} className="h-ods-row border-b border-ods-line last:border-b-0">
                      {columns.map((c) => (
                        <td key={c.id} className="px-3">
                          <Skeleton silent className={cx('h-3.5', end(c) ? 'ms-auto w-16' : 'w-3/4')} />
                        </td>
                      ))}
                    </tr>
                  ))
                : (
                    <tr>
                      <td colSpan={columns.length}>{stateNode}</td>
                    </tr>
                  )}
          </tbody>
        </table>
      </div>

      {/* phones: stacked cards */}
      <div className="ods-tablet:hidden">
        {state === 'rows' ? (
          <ul aria-label={caption} className="m-0 flex list-none flex-col gap-3 p-0">
            {sorted.map((row) => (
              <li key={getRowId(row)} className="relative rounded-ods-card border border-ods-line bg-ods-surface p-4">
                <p className="m-0 text-ods-body font-semibold text-ods-navy">{cellContent(primary, row)}</p>
                <dl className="m-0 mt-2 flex flex-col gap-1">
                  {columns
                    .filter((c) => c.id !== primary.id && !c.hideOnPhone)
                    .map((c) => (
                      <div key={c.id} className="flex items-baseline justify-between gap-3 text-ods-table">
                        <dt className="text-ods-slate">{c.header}</dt>
                        <dd className={cx('m-0 text-end text-ods-navy', c.numeric && 'tabular-nums')}>{c.cell(row)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
        ) : state === 'loading' ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: Math.min(skeletonRows, 3) }, (_, i) => (
              <div key={i} className="rounded-ods-card border border-ods-line bg-ods-surface p-4">
                <Skeleton silent lines={3} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-ods-card border border-ods-line bg-ods-surface">
            <p className="sr-only">{caption}</p>
            {stateNode}
          </div>
        )}
      </div>
      {loading ? (
        <span role="status" className="sr-only">
          Loading {caption}
        </span>
      ) : null}
    </div>
  );
}
