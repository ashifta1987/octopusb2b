'use client';

import { useId, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable } from '../hooks';
import { toggleSelection } from '../selection-logic';
import { INSET_RING, SCROLL_ROW } from './selection-shared';

export type FilterPillItem = {
  id: string;
  label: ReactNode;
  count?: number;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Why the filter can't be used; shown as text under the row and linked with aria-describedby. */
  disabledReason?: ReactNode;
  testId?: string;
};

export type FilterPillsProps = {
  items: FilterPillItem[];
  /** multi (default): any number; single: one at a time (click again to clear unless `allowEmpty` is false). */
  mode?: 'multi' | 'single';
  value?: string[];
  defaultValue?: string[];
  onChange?: (ids: string[]) => void;
  allowEmpty?: boolean;
  /** Accessible name of the group, e.g. "Filter orders by status". */
  label: string;
  /** Result count read out politely after every change, e.g. "24 orders". Always rendered (visible, small). */
  resultText?: ReactNode;
  loading?: boolean;
  /** Error text in place of the pills (e.g. "We couldn't load the filters. Reload the page to try again."). */
  error?: ReactNode;
  /** Shown when there are no items. */
  emptyText?: ReactNode;
  className?: string;
  'data-testid'?: string;
  /** data-testid on the aria-live result region. */
  resultTestId?: string;
};

/**
 * FilterPills, Part 2.5: filtering lists, category chips. 40 px comfortable / 28 compact
 * (`calc(var(--ods-control-h) - 4px)` = 44−4 / 32−4); radius `rounded-ods-pill` (pill, 4 px chips in compact).
 * Selected = navy fill + check mark (never colour alone); counts after the label; each pill is a toggle button with
 * `aria-pressed` (Tab between pills, Enter / Space toggle). The result count lives in an `aria-live="polite"` region.
 * Disabled pills are aria-disabled (still focusable so the reason is reachable) and the reason is shown under the row.
 * Phones: the row scrolls sideways (no wrapping).
 */
export function FilterPills({
  items,
  mode = 'multi',
  value,
  defaultValue = [],
  onChange,
  allowEmpty = true,
  label,
  resultText,
  loading,
  error,
  emptyText = 'No filters for this list.',
  className,
  'data-testid': testId,
  resultTestId,
}: FilterPillsProps) {
  const uid = useId();
  const [selected, setSelected] = useControllable<string[]>(value, defaultValue, onChange);
  const order = items.map((i) => i.id);
  const reasons = items.filter((i) => i.disabled && i.disabledReason);

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex gap-2" aria-hidden="true">
        {[72, 96, 64, 88].map((w) => (
          <span key={w} className="h-[calc(var(--ods-control-h)-4px)] shrink-0 animate-pulse rounded-ods-pill bg-ods-line" style={{ width: w }} />
        ))}
      </div>
    );
  } else if (error) {
    body = (
      <p role="alert" className="text-ods-small font-medium text-ods-danger">
        {error}
      </p>
    );
  } else if (!items.length) {
    body = <p className="text-ods-small text-ods-slate">{emptyText}</p>;
  } else {
    body = (
      <div className={cx(SCROLL_ROW, 'gap-2 py-0.5')}>
        {items.map((item) => {
          const on = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              aria-disabled={item.disabled || undefined}
              aria-describedby={item.disabled && item.disabledReason ? `${uid}-why-${item.id}` : undefined}
              data-testid={item.testId}
              onClick={() => !item.disabled && setSelected(toggleSelection(selected, item.id, { mode, allowEmpty, order }))}
              className={cx(
                'inline-flex h-[calc(var(--ods-control-h)-4px)] shrink-0 items-center gap-1.5 rounded-ods-pill border px-3 whitespace-nowrap',
                'text-ods-label font-semibold transition-colors duration-(--ods-motion) ease-ods',
                INSET_RING,
                on ? 'border-ods-navy bg-ods-navy text-white hover:bg-ods-navy-hover' : 'border-ods-line-strong bg-ods-surface text-ods-text',
                item.disabled ? 'cursor-not-allowed border-ods-line bg-ods-canvas text-ods-slate' : !on && 'hover:border-ods-navy hover:bg-ods-canvas',
              )}
            >
              {on ? <Icon icon={Check} size="auto" /> : item.icon ? <Icon icon={item.icon} size="auto" /> : null}
              <span>{item.label}</span>
              {item.count != null ? <span className={cx('tabular-nums', on ? 'text-white' : 'text-ods-slate')}>{item.count}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} aria-busy={loading || undefined} className={cx('min-w-0', className)} data-testid={testId}>
      {body}
      {loading ? <span className="sr-only">Loading filters</span> : null}
      {reasons.length && !loading && !error ? (
        <div className="mt-1.5 space-y-0.5">
          {reasons.map((i) => (
            <p key={i.id} id={`${uid}-why-${i.id}`} className="text-ods-small text-ods-slate">
              <span className="font-semibold text-ods-navy">{i.label}</span> is unavailable: {i.disabledReason}
            </p>
          ))}
        </div>
      ) : null}
      <p aria-live="polite" aria-atomic="true" data-testid={resultTestId} className={cx('text-ods-small text-ods-slate', resultText ? 'mt-2' : 'sr-only')}>
        {resultText}
      </p>
    </div>
  );
}
