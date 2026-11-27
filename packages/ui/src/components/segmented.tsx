'use client';

import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { rovingKeyDown, useControllable } from '../hooks';
import { resolveSelectableId } from '../selection-logic';

export type SegmentedOption = {
  value: string;
  label: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Why the option can't be chosen; shown as text under the control. */
  disabledReason?: ReactNode;
  testId?: string;
};

export type SegmentedProps = {
  /** 2–3 views (Sea / Air, List / Board, Month / Quarter / Year). */
  options: SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Accessible name, e.g. "Shipping method". */
  label: string;
  /** Stretch the segments to fill the width (phones). */
  fullWidth?: boolean;
  className?: string;
  'data-testid'?: string;
};

/**
 * Segmented control, Part 2.5: switch between 2–3 views. Grey track, white selected segment with a shadow.
 * Track height 40 px comfortable / 32 compact = `calc((2 × --ods-control-h + 32px) / 3)` (44 → 40, 32 → 32), so it
 * follows the density token without a density prop.
 *
 * ARIA choice: a radiogroup (role radiogroup / radio, aria-checked), because exactly one view is always chosen and
 * it does not own a tabpanel. Roving tabindex: Tab enters on the chosen segment; ArrowLeft / ArrowRight (and Up /
 * Down), Home / End move AND choose; disabled options are skipped and their reason is shown under the control.
 * Phones: `fullWidth` stretches the segments; 2–3 short labels never need to scroll.
 */
export function Segmented({ options, value, defaultValue, onChange, label, fullWidth, className, 'data-testid': testId }: SegmentedProps) {
  const uid = useId();
  const items = options.map((o) => ({ id: o.value, disabled: o.disabled }));
  const [raw, setRaw] = useControllable<string>(value, resolveSelectableId(items, defaultValue) ?? '', onChange);
  const current = resolveSelectableId(items, raw) ?? '';
  const reasons = options.filter((o) => o.disabled && o.disabledReason);
  return (
    <div className={cx('min-w-0', fullWidth ? 'block' : 'inline-block', className)}>
      <div
        role="radiogroup"
        aria-label={label}
        data-testid={testId}
        onKeyDown={(e) => rovingKeyDown(e, { orientation: 'both', onMove: (el) => el.dataset.value && setRaw(el.dataset.value) })}
        className={cx('h-[calc((var(--ods-control-h)*2+32px)/3)] gap-1 rounded-ods-control bg-ods-line p-1', fullWidth ? 'flex w-full' : 'inline-flex')}
      >
        {options.map((o) => {
          const on = o.value === current;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={o.disabled || undefined}
              aria-describedby={o.disabled && o.disabledReason ? `${uid}-why-${o.value}` : undefined}
              data-roving=""
              data-value={o.value}
              data-testid={o.testId}
              tabIndex={on ? 0 : -1}
              onClick={() => !o.disabled && setRaw(o.value)}
              className={cx(
                'inline-flex h-full min-w-0 items-center justify-center gap-1.5 rounded-[calc(var(--ods-radius-control)-2px)] px-3 whitespace-nowrap',
                'text-ods-label font-semibold transition-colors duration-(--ods-motion) ease-ods',
                fullWidth && 'flex-1',
                on ? 'bg-ods-surface text-ods-navy shadow-ods-pop' : 'text-ods-slate',
                o.disabled ? 'cursor-not-allowed' : !on && 'hover:bg-ods-surface/60 hover:text-ods-navy',
              )}
            >
              {o.icon ? <Icon icon={o.icon} size="auto" /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
      {reasons.map((o) => (
        <p key={o.value} id={`${uid}-why-${o.value}`} className="mt-1 text-ods-small text-ods-slate">
          <span className="font-semibold text-ods-navy">{o.label}</span> is unavailable: {o.disabledReason}
        </p>
      ))}
    </div>
  );
}
