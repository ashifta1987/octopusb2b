'use client';

import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, LoaderCircle, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { odsControlClass } from '../form-utils';
import { useFieldControl } from './field';

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  /** Decorative icon at the inline start (search, mail …). */
  iconStart?: LucideIcon;
  /** Text or element at the inline end inside the box (unit, "@octopus.ae" …). */
  suffix?: ReactNode;
  /** Shows a spinner at the end and sets aria-busy (e.g. "checking the store name"). */
  loading?: boolean;
};

/**
 * Text input (44 / 32 px). Inside a `Field` it takes its id, aria-describedby, aria-invalid and aria-required from it.
 * States: default, hover (navy border), focus (blue border + amber ring), filled, error (red border), disabled
 * (grey; the Field shows the reason), read-only (grey, still focusable and copyable), loading (spinner).
 * Phones: full width.
 */
export function Input({ iconStart, suffix, loading, className, type = 'text', ...rest }: InputProps) {
  const f = useFieldControl(rest);
  const input = (
    <input
      type={type}
      {...rest}
      id={f.id}
      aria-describedby={f.describedBy}
      aria-invalid={f.invalid || undefined}
      aria-required={f.required || undefined}
      aria-busy={loading || undefined}
      disabled={f.disabled}
      readOnly={f.readOnly}
      className={cx(odsControlClass('h-ods-control'), iconStart && 'ps-9', (!!suffix || !!loading) && 'pe-10', !(iconStart || suffix || loading) && className)}
    />
  );
  if (!(iconStart || suffix || loading)) return input;
  return (
    <div className={cx('relative min-w-0', className)}>
      {iconStart ? (
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ods-slate">
          <Icon icon={iconStart} />
        </span>
      ) : null}
      {input}
      {loading || suffix ? (
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center gap-1 text-ods-small text-ods-slate">
          {loading ? <Icon icon={LoaderCircle} className="animate-spin" /> : suffix}
        </span>
      ) : null}
    </div>
  );
}

export type TextareaProps = ComponentProps<'textarea'> & {
  /** Shows "12 / 500" under the box (needs maxLength). Screen readers hear the count only when 20 or fewer remain. */
  showCount?: boolean;
};

/** Multi-line text. Optional character count. Resizes vertically. Phones: full width. */
export function Textarea({ showCount, maxLength, className, rows = 4, onChange, value, defaultValue, ...rest }: TextareaProps) {
  const f = useFieldControl(rest);
  const countId = useId();
  const [inner, setInner] = useState(String(defaultValue ?? ''));
  const length = value !== undefined ? String(value).length : inner.length;
  const counting = showCount && maxLength;
  const left = counting ? maxLength - length : 0;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <textarea
        {...rest}
        rows={rows}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          if (value === undefined) setInner(e.target.value);
          onChange?.(e);
        }}
        id={f.id}
        aria-describedby={cx(f.describedBy, counting && countId) || undefined}
        aria-invalid={f.invalid || undefined}
        aria-required={f.required || undefined}
        disabled={f.disabled}
        readOnly={f.readOnly}
        className={odsControlClass('min-h-[calc(var(--ods-control-h)*2)] resize-y py-2')}
      />
      {counting ? (
        <>
          <span id={countId} className="sr-only">
            Up to {maxLength} characters.
          </span>
          <span aria-hidden="true" className={cx('self-end text-ods-small tabular-nums', left <= 20 ? 'font-semibold text-ods-warning' : 'text-ods-slate')}>
            {length} / {maxLength}
          </span>
          <span className="sr-only" aria-live="polite">
            {left <= 20 ? `${left} characters left` : ''}
          </span>
        </>
      ) : null}
    </div>
  );
}

export type SelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  /** Options are loading: disabled, spinner instead of the chevron, aria-busy. */
  loading?: boolean;
  /** Shown first and selected when value is '' (e.g. "Choose a bank account"). Not a label: Field still needs one. */
  placeholder?: string;
};

/**
 * Native select, styled (keyboard and phone pickers stay native). Chevron at the inline end.
 * Phones: the OS picker opens.
 */
export function Select({ loading, placeholder, className, children, ...rest }: SelectProps) {
  const f = useFieldControl(rest);
  return (
    <div className={cx('relative min-w-0', className)}>
      <select
        {...rest}
        id={f.id}
        aria-describedby={f.describedBy}
        aria-invalid={f.invalid || undefined}
        aria-required={f.required || undefined}
        aria-busy={loading || undefined}
        disabled={f.disabled || loading}
        className={odsControlClass('h-ods-control cursor-pointer appearance-none pe-9')}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={f.required}>
            {placeholder}
          </option>
        ) : null}
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ods-slate">
        <Icon icon={loading ? LoaderCircle : ChevronDown} className={loading ? 'animate-spin' : undefined} />
      </span>
    </div>
  );
}
