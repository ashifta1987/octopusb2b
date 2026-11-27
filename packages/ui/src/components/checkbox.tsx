'use client';

import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { CircleAlert, Check, Lock, Minus } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable } from '../hooks';

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'checked' | 'defaultChecked' | 'onChange' | 'size'> & {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** "Some selected" (select-all headers). Read as "mixed" by screen readers. */
  indeterminate?: boolean;
  disabledReason?: ReactNode;
  error?: ReactNode;
};

/**
 * Checkbox: a native checkbox (Space toggles) drawn 20 / 16 px, inside a label row at least 44 / 32 px tall (tap
 * target). Checked = blue box + white check; indeterminate = blue box + minus (aria-checked="mixed" natively).
 * Disabled shows the reason; error shows a red message linked with aria-describedby. Phones: same.
 */
export function Checkbox({ label, description, checked, defaultChecked = false, onCheckedChange, indeterminate, disabled, disabledReason, error, className, id: idProp, ...rest }: CheckboxProps) {
  const auto = useId();
  const id = idProp ?? `cb${auto}`;
  const ref = useRef<HTMLInputElement>(null);
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const descId = `${id}-desc`;
  const reasonId = `${id}-reason`;
  const errId = `${id}-err`;
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <label htmlFor={id} className={cx('inline-flex min-h-ods-control items-start gap-2 py-[calc((var(--ods-control-h)-1.5em)/2)]', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        <span className="relative mt-[calc((1.5em-var(--ods-icon)-2px)/2)] grid shrink-0 place-items-center">
          <input
            {...rest}
            ref={ref}
            id={id}
            type="checkbox"
            checked={on}
            disabled={disabled}
            onChange={(e) => setOn(e.target.checked)}
            aria-invalid={error ? true : undefined}
            aria-describedby={cx(rest['aria-describedby'], !!description && descId, disabled && !!disabledReason && reasonId, !!error && errId) || undefined}
            className={cx(
              'peer size-[calc(var(--ods-icon)+2px)] cursor-[inherit] appearance-none rounded-[4px] border-2 border-ods-slate bg-ods-surface transition-colors',
              'checked:border-ods-blue checked:bg-ods-blue indeterminate:border-ods-blue indeterminate:bg-ods-blue hover:border-ods-navy',
              'aria-invalid:border-ods-danger disabled:border-ods-line-strong disabled:bg-ods-canvas disabled:checked:bg-ods-line-strong',
            )}
          />
          <Icon icon={Check} className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0" />
          <Icon icon={Minus} className="pointer-events-none absolute text-white opacity-0 peer-indeterminate:opacity-100" />
        </span>
        <span className="min-w-0">
          <span className={cx('text-ods-body', disabled ? 'text-ods-slate' : 'text-ods-text')}>{label}</span>
          {description ? (
            <span id={descId} className="block text-ods-small text-ods-slate">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {disabled && disabledReason ? (
        <p id={reasonId} className="flex items-center gap-1 ps-[calc(var(--ods-icon)+10px)] text-ods-small text-ods-slate">
          <Icon icon={Lock} size="xs" />
          {disabledReason}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="flex items-start gap-1 ps-[calc(var(--ods-icon)+10px)] text-ods-small font-medium text-ods-danger">
          <Icon icon={CircleAlert} size="xs" className="mt-[0.15em]" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export type SwitchProps = {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** Shows "On" / "Off" text next to the switch (state never by colour or position alone). Default true. */
  showState?: boolean;
  /** Busy (saving the setting): aria-busy, clicks blocked. */
  loading?: boolean;
  id?: string;
  className?: string;
  'data-testid'?: string;
};

/**
 * Switch: a button with role="switch" and aria-checked, for settings that apply at once (no Save). Space / Enter
 * toggle; the label is a <label for> so clicking it toggles too. Disabled = aria-disabled (stays focusable) + reason.
 * Track 40×24 (32×20 compact), slate when off, blue when on, with "On" / "Off" text. RTL: the thumb mirrors.
 * Phones: same; the whole row is the tap target.
 */
export function Switch({ label, description, checked, defaultChecked = false, onCheckedChange, disabled, disabledReason, showState = true, loading, id: idProp, className, 'data-testid': testId }: SwitchProps) {
  const auto = useId();
  const id = idProp ?? `sw${auto}`;
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  const blocked = disabled || loading;
  const descId = `${id}-desc`;
  const reasonId = `${id}-reason`;
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <div className="flex min-h-ods-control items-center gap-3">
        <button
          type="button"
          role="switch"
          id={id}
          data-testid={testId}
          aria-checked={on}
          aria-disabled={blocked || undefined}
          aria-busy={loading || undefined}
          aria-describedby={cx(!!description && descId, disabled && !!disabledReason && reasonId) || undefined}
          onClick={() => !blocked && setOn(!on)}
          className={cx(
            'group relative inline-flex h-[calc(var(--ods-icon)+6px)] w-[calc(var(--ods-icon)*2+4px)] shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-(--ods-motion-fast)',
            on ? 'bg-ods-blue' : 'bg-ods-slate',
            blocked && 'cursor-not-allowed opacity-50',
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              'size-[calc(var(--ods-icon)+2px)] rounded-full bg-white shadow-ods-card transition-transform duration-(--ods-motion-fast) ease-ods',
              on && 'translate-x-[calc(var(--ods-icon)-2px)] rtl:-translate-x-[calc(var(--ods-icon)-2px)]',
            )}
          />
        </button>
        <span className="min-w-0">
          <label htmlFor={id} className={cx('text-ods-body', blocked ? 'cursor-not-allowed text-ods-slate' : 'cursor-pointer text-ods-text')}>
            {label}
          </label>
          {description ? (
            <span id={descId} className="block text-ods-small text-ods-slate">
              {description}
            </span>
          ) : null}
        </span>
        {showState ? (
          <span aria-hidden="true" className={cx('ms-auto text-ods-small font-semibold', on ? 'text-ods-blue' : 'text-ods-slate')}>
            {loading ? 'Saving…' : on ? 'On' : 'Off'}
          </span>
        ) : null}
      </div>
      {disabled && disabledReason ? (
        <p id={reasonId} className="flex items-center gap-1 text-ods-small text-ods-slate">
          <Icon icon={Lock} size="xs" />
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
