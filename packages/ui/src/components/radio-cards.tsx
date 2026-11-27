'use client';

import { useId, type ReactNode } from 'react';
import { CircleAlert, Lock, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable } from '../hooks';

export type RadioCardOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** Right-aligned figure, e.g. "US$ 120.00" or "Free". */
  price?: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Shown on the card when disabled (2.6: always say why). */
  disabledReason?: ReactNode;
};

export type RadioCardsProps = {
  legend: ReactNode;
  /** Visually hide the legend (still read out) when a heading above already says it. */
  legendHidden?: boolean;
  options: RadioCardOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Form field name (default: generated). */
  name?: string;
  /** Cards per row from 768 px (phones always 1). */
  columns?: 1 | 2 | 3;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

/**
 * RadioCards (2.5): payment, shipping and address choices. Native radios inside a fieldset + legend, so a screen
 * reader hears a radio group and arrow keys move the choice natively (Tab enters / leaves the group).
 * Selected = 2 px blue border + blue tint + filled radio dot (not colour alone). Disabled cards are grey with the
 * reason on the card. Optional icon, description and price. Phones: one card per row.
 */
export function RadioCards({ legend, legendHidden, options, value, defaultValue, onValueChange, name, columns = 2, required, hint, error, className, 'data-testid': testId }: RadioCardsProps) {
  const auto = useId();
  const group = name ?? `rc${auto}`;
  const hintId = `${group}-hint`;
  const errId = `${group}-err`;
  const [selected, setSelected] = useControllable<string | undefined>(value, defaultValue, onValueChange as ((v: string | undefined) => void) | undefined);
  return (
    <fieldset
      data-testid={testId}
      aria-describedby={cx(!!hint && hintId, !!error && errId) || undefined}
      className={cx('min-w-0', className)}
    >
      <legend className={cx('mb-2 text-ods-label font-semibold text-ods-navy', legendHidden && 'sr-only')}>
        {legend}
        {required ? (
          <>
            <span aria-hidden="true" className="ms-0.5 text-ods-danger">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </legend>
      {hint ? (
        <p id={hintId} className="-mt-1 mb-2 text-ods-small text-ods-slate">
          {hint}
        </p>
      ) : null}
      <div className={cx('grid grid-cols-1 gap-ods-gap', columns === 2 && 'ods-tablet:grid-cols-2', columns === 3 && 'ods-tablet:grid-cols-3')}>
        {options.map((o) => {
          const id = `${group}-${o.value}`;
          const on = selected === o.value;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className={cx(
                'relative flex min-h-ods-control min-w-0 items-start gap-3 rounded-ods-card border p-ods-pad-card transition-colors duration-(--ods-motion-fast)',
                'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ods-focus has-[:focus-visible]:outline-solid',
                o.disabled
                  ? 'cursor-not-allowed border-ods-line bg-ods-canvas text-ods-slate'
                  : on
                    ? 'cursor-pointer border-ods-blue bg-ods-blue-tint ring-1 ring-ods-blue'
                    : cx('cursor-pointer bg-ods-surface hover:border-ods-navy', error ? 'border-ods-danger' : 'border-ods-slate/70'),
              )}
            >
              <input
                type="radio"
                id={id}
                name={group}
                value={o.value}
                checked={on}
                disabled={o.disabled}
                required={required}
                onChange={() => setSelected(o.value)}
                aria-describedby={cx(!!o.description && `${id}-d`, o.disabled && !!o.disabledReason && `${id}-r`) || undefined}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cx(
                  'mt-[calc((1.5em-var(--ods-icon)-2px)/2)] grid size-[calc(var(--ods-icon)+2px)] shrink-0 place-items-center rounded-full border-2 bg-ods-surface',
                  o.disabled ? 'border-ods-line-strong' : on ? 'border-ods-blue' : 'border-ods-slate',
                )}
              >
                <span className={cx('size-[calc(var(--ods-icon)/2)] rounded-full', on ? 'bg-ods-blue' : 'bg-transparent')} />
              </span>
              {o.icon ? <Icon icon={o.icon} className={cx('mt-[0.2em]', o.disabled ? 'text-ods-slate' : 'text-ods-navy')} /> : null}
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className={cx('text-ods-body font-semibold', o.disabled ? 'text-ods-slate' : 'text-ods-navy')}>{o.label}</span>
                  {o.price ? <span className={cx('shrink-0 text-ods-body font-semibold tabular-nums', o.disabled ? 'text-ods-slate' : 'text-ods-text')}>{o.price}</span> : null}
                </span>
                {o.description ? (
                  <span id={`${id}-d`} className="mt-0.5 block text-ods-small text-ods-slate">
                    {o.description}
                  </span>
                ) : null}
                {o.disabled && o.disabledReason ? (
                  <span id={`${id}-r`} className="mt-1 flex items-center gap-1 text-ods-small text-ods-slate">
                    <Icon icon={Lock} size="xs" />
                    {o.disabledReason}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <div aria-live="polite">
        {error ? (
          <p id={errId} className="mt-2 flex items-start gap-1 text-ods-small font-medium text-ods-danger">
            <Icon icon={CircleAlert} size="xs" className="mt-[0.15em]" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
