'use client';

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable } from '../hooks';
import { formatMoney, formatNumber } from '../format';

export type CardTabItem = {
  id: string;
  /** e.g. "Waiting for payment". */
  label: ReactNode;
  /** A number (formatted with thousands separators), money (`money: true` → "US$ 1,234.56") or any node. */
  value: number | ReactNode;
  money?: boolean;
  /** One short line under the value, e.g. "3 overdue". */
  hint?: ReactNode;
  disabled?: boolean;
  disabledReason?: ReactNode;
  testId?: string;
};

export type CardTabsProps = {
  items: CardTabItem[];
  /** Selected card id, or null for none (the whole list). */
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string | null) => void;
  /** Clicking the selected card again clears the filter (default true). */
  allowDeselect?: boolean;
  /** Accessible name, e.g. "Filter orders". */
  label: string;
  loading?: boolean;
  /** Error text in place of the cards. */
  error?: ReactNode;
  /** Shown when there are no items. */
  emptyText?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

/**
 * CardTabs, Part 2.5: numbers that filter (top of Orders, Requests, Wallet). Each card ≥ 96 px tall; selected =
 * 2 px blue border (1 px border + 1 px ring, so nothing shifts) + blue tint.
 *
 * ARIA choice: toggle buttons with `aria-pressed` inside a labelled group, because the cards FILTER the list below
 * (same job as FilterPills, single-select); they don't swap panels, so they are not tabs. Tab moves between cards,
 * Enter / Space toggles. Disabled cards are aria-disabled with the reason as text inside the card.
 * Loading = skeleton cards (aria-busy + one "Loading" status). 4 per row on tablet / desktop, 2 per row on phones.
 */
export function CardTabs({ items, value, defaultValue = null, onChange, allowDeselect = true, label, loading, error, emptyText = 'Nothing to show yet.', className, 'data-testid': testId }: CardTabsProps) {
  const [current, setCurrent] = useControllable<string | null>(value, defaultValue, onChange);
  const grid = 'grid grid-cols-2 gap-3 ods-tablet:grid-cols-4';

  let body: ReactNode;
  if (loading) {
    body = (
      <>
        <div className={grid} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="min-h-[96px] rounded-ods-card border border-ods-line bg-ods-surface p-4">
              <div className="h-3 w-3/5 animate-pulse rounded bg-ods-line" />
              <div className="mt-3 h-6 w-2/5 animate-pulse rounded bg-ods-line" />
            </div>
          ))}
        </div>
        <span role="status" className="sr-only">
          Loading
        </span>
      </>
    );
  } else if (error) {
    body = (
      <p role="alert" className="flex items-center gap-2 rounded-ods-card border border-ods-danger bg-ods-danger-tint p-4 text-ods-small font-medium text-ods-danger">
        <Icon icon={AlertTriangle} size="auto" />
        {error}
      </p>
    );
  } else if (!items.length) {
    body = <p className="rounded-ods-card border border-dashed border-ods-line-strong p-4 text-ods-small text-ods-slate">{emptyText}</p>;
  } else {
    body = (
      <div className={grid}>
        {items.map((item) => {
          const on = item.id === current;
          const shown = typeof item.value === 'number' ? (item.money ? formatMoney(item.value) : formatNumber(item.value)) : item.value;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              aria-disabled={item.disabled || undefined}
              data-testid={item.testId}
              onClick={() => {
                if (item.disabled) return;
                setCurrent(on ? (allowDeselect ? null : item.id) : item.id);
              }}
              className={cx(
                'flex min-h-[96px] min-w-0 flex-col items-start justify-start gap-1 rounded-ods-card border p-4 text-start',
                'transition-colors duration-(--ods-motion) ease-ods',
                on ? 'border-ods-blue bg-ods-blue-tint ring-1 ring-ods-blue' : 'border-ods-line bg-ods-surface',
                item.disabled ? 'cursor-not-allowed bg-ods-canvas' : !on && 'hover:border-ods-line-strong hover:shadow-ods-card',
              )}
            >
              <span className="text-ods-label font-semibold text-ods-slate">{item.label}</span>
              <span className={cx('text-ods-h1 font-bold tabular-nums', item.money && typeof item.value === 'number' && item.value < 0 ? 'text-ods-danger' : 'text-ods-navy')}>{shown}</span>
              {item.disabled && item.disabledReason ? (
                <span className="text-ods-small text-ods-slate">{item.disabledReason}</span>
              ) : item.hint ? (
                <span className="text-ods-small text-ods-slate">{item.hint}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} aria-busy={loading || undefined} className={cx('min-w-0', className)} data-testid={testId}>
      {body}
    </div>
  );
}
