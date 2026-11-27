'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../cx';
import { rovingKeyDown, useControllable } from '../hooks';
import { readSearchParam, resolveSelectableId, withSearchParam } from '../selection-logic';
import { INSET_RING, SCROLL_ROW, useRowScroll } from './selection-shared';

export type TabItem = {
  id: string;
  label: ReactNode;
  /** Shown after the label (e.g. 12 reviews). */
  count?: number;
  disabled?: boolean;
  /** Why the tab can't be opened. Shown as text under the tab row (and as the tab's description + title). */
  disabledReason?: ReactNode;
  /** Rendered the first time the tab is opened, then kept mounted (hidden) so its state survives switching back. */
  panel: ReactNode | (() => ReactNode);
  /** data-testid on the tab button. */
  testId?: string;
};

export type TabsProps = {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** URL search param to sync (`?tab=`): read on mount (and on Back/Forward), written with history.replaceState. */
  param?: string;
  /** Accessible name of the tab list, e.g. "Order sections". */
  label: string;
  /** Stick the tab row under the page header (default false). */
  sticky?: boolean;
  /** Sticky offset (the page header height), e.g. 48 or "var(--header-h)". Default 0. */
  stickyTop?: number | string;
  className?: string;
  /** Extra classes for the panel wrapper (padding etc.). Default `pt-4`. */
  panelClassName?: string;
  'data-testid'?: string;
};

/**
 * Tabs (underline), Part 2.5: parts of ONE record (product, request, order, project, Warehouse, customer).
 * - 48 px comfortable / 36 compact (`h-ods-tab`); selected = navy bold + a blue bar of `--ods-tab-bar` (3 / 2 px).
 * - Counts after the label. Optional sticky row under the page header (`sticky`, `stickyTop`, z = --z-sticky).
 * - ARIA: tablist / tab / tabpanel, aria-selected, aria-controls, aria-labelledby. Roving tabindex: only the selected
 *   tab is in the Tab order; ArrowLeft / ArrowRight (mirrored in RTL), Home / End move focus AND select (automatic
 *   activation). Disabled tabs are aria-disabled, skipped by the arrows, and their reason is shown as text under the
 *   row (linked with aria-describedby; also the native title tooltip).
 * - `param` syncs `?<param>=` (2.8) with window.history.replaceState and reads it on mount, so no useSearchParams
 *   (keeps the route prerenderable with Cache Components).
 * - Panels are lazy: rendered the first time they are opened, then kept mounted and hidden, so form input, scroll
 *   and fetched data survive switching back. Every tab has a (possibly empty) tabpanel so aria-controls is valid.
 * - Phones: the tab row scrolls sideways (no wrapping) and the selected tab is scrolled into view.
 */
export function Tabs({ items, value, defaultValue, onChange, param, label, sticky = false, stickyTop = 0, className, panelClassName, 'data-testid': testId }: TabsProps) {
  const uid = useId();
  const initial = resolveSelectableId(items, defaultValue) ?? '';
  const [raw, setRaw] = useControllable<string>(value, initial, onChange);
  const current = resolveSelectableId(items, raw) ?? '';
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([current]));
  if (current && !visited.has(current)) setVisited(new Set(visited).add(current));
  const rowRef = useRef<HTMLDivElement>(null);
  useRowScroll(rowRef, '[aria-selected="true"]', current);

  const select = useCallback(
    (id: string) => {
      setRaw(id);
      if (param && typeof window !== 'undefined') {
        window.history.replaceState(null, '', withSearchParam(window.location.href, param, id));
      }
    },
    [param, setRaw],
  );

  // read ?param= on mount and on Back / Forward
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  useEffect(() => {
    if (!param) return;
    const sync = () => {
      const fromUrl = readSearchParam(window.location.search, param);
      const id = fromUrl ? resolveSelectableId(itemsRef.current, fromUrl) : undefined;
      if (id && id === fromUrl) setRaw(id);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
    // setRaw changes identity with onChange; the URL only needs reading on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;
  const reasonId = (id: string) => `${uid}-why-${id}`;
  const disabledWithReason = items.filter((i) => i.disabled && i.disabledReason);
  const stickyStyle: CSSProperties | undefined = sticky ? { top: typeof stickyTop === 'number' ? `${stickyTop}px` : stickyTop } : undefined;

  return (
    <div className={cx('min-w-0', className)} data-testid={testId}>
      <div className={cx('bg-ods-surface', sticky && 'sticky z-(--z-sticky)')} style={stickyStyle}>
        <div
          ref={rowRef}
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          onKeyDown={(e) => rovingKeyDown(e, { orientation: 'horizontal', onMove: (el) => el.dataset.tabId && select(el.dataset.tabId) })}
          className={cx(SCROLL_ROW, 'border-b border-ods-line')}
        >
          {items.map((item) => {
            const selected = item.id === current;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={tabId(item.id)}
                data-roving=""
                data-tab-id={item.id}
                data-testid={item.testId}
                aria-selected={selected}
                aria-controls={panelId(item.id)}
                aria-disabled={item.disabled || undefined}
                aria-describedby={item.disabled && item.disabledReason ? reasonId(item.id) : undefined}
                title={item.disabled && typeof item.disabledReason === 'string' ? item.disabledReason : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => !item.disabled && select(item.id)}
                className={cx(
                  'relative inline-flex h-ods-tab shrink-0 items-center gap-2 px-4 whitespace-nowrap',
                  'text-ods-body transition-colors duration-(--ods-motion) ease-ods',
                  INSET_RING,
                  selected ? 'font-bold text-ods-navy' : 'font-medium text-ods-slate',
                  item.disabled ? 'cursor-not-allowed text-ods-slate/70' : !selected && 'hover:bg-ods-canvas hover:text-ods-navy',
                )}
              >
                {/* the bold copy reserves the selected width, so the row doesn't shift when the selection moves */}
                <span className="inline-grid">
                  <span className="col-start-1 row-start-1">{item.label}</span>
                  <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-bold">
                    {item.label}
                  </span>
                </span>
                {item.count != null ? (
                  <span
                    className={cx(
                      'rounded-ods-pill px-1.5 text-ods-small font-semibold tabular-nums',
                      selected ? 'bg-ods-blue-tint text-ods-navy' : 'bg-ods-canvas text-ods-slate',
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
                {item.disabled ? <span className="sr-only">(unavailable)</span> : null}
                <span
                  aria-hidden="true"
                  className={cx('absolute inset-x-0 bottom-0 bg-ods-blue', selected ? 'opacity-100' : 'opacity-0')}
                  style={{ height: 'var(--ods-tab-bar)' }}
                />
              </button>
            );
          })}
        </div>
      </div>
      {disabledWithReason.length ? (
        <div className="mt-2 space-y-0.5">
          {disabledWithReason.map((i) => (
            <p key={i.id} id={reasonId(i.id)} className="text-ods-small text-ods-slate">
              <span className="font-semibold text-ods-navy">{i.label}</span> is unavailable: {i.disabledReason}
            </p>
          ))}
        </div>
      ) : null}
      {items.map((item) => {
        const selected = item.id === current;
        const show = visited.has(item.id) && !item.disabled;
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={panelId(item.id)}
            aria-labelledby={tabId(item.id)}
            hidden={!selected}
            tabIndex={selected ? 0 : undefined}
            className={cx('min-w-0', panelClassName ?? 'pt-4')}
          >
            {show ? (typeof item.panel === 'function' ? item.panel() : item.panel) : null}
          </div>
        );
      })}
    </div>
  );
}
