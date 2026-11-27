'use client';

import { useEffect, useId, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { Info, Minus, Plus } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useControllable } from '../hooks';
import { clampQuantity, odsControlClass, parseDecimal, validateNumber } from '../form-utils';
import { formatNumber } from '../format';
import { useFieldControl } from './field';

export type NumberInputProps = Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'min' | 'max' | 'step' | 'prefix'> & {
  /** Raw text (controlled). */
  value?: string;
  defaultValue?: string;
  /** Raw text + parsed number (null when empty or not a number). */
  onValueChange?: (raw: string, value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown inside the box at the inline start, e.g. "US$". */
  prefix?: string;
  /** Fraction digits to format to on blur (2 for money). Thousands separators are added on blur. */
  decimals?: number;
  /** Called on blur with the validation message (or null). Inside a Field the message is shown by the Field. */
  onValidate?: (message: string | null) => void;
};

/**
 * Number / money input: right-aligned, tabular figures, inputMode="decimal" (numeric keypad on phones), optional
 * "US$" prefix. Validates on blur (number, min, max, step) in plain English; inside a Field the message shows as
 * the Field error (unless the Field has its own `error`). Formats to `decimals` with separators on blur.
 * Phones: full width, decimal keypad.
 */
export function NumberInput({ value, defaultValue = '', onValueChange, min, max, step, prefix, decimals, onValidate, className, onBlur, ...rest }: NumberInputProps) {
  const f = useFieldControl(rest);
  const prefixId = useId();
  const [raw, setRaw] = useControllable(value, defaultValue);
  const fmt = (n: number) => formatNumber(n, decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {});
  return (
    <div className={cx('relative min-w-0', className)}>
      {prefix ? (
        <span id={prefixId} className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ods-body text-ods-slate">
          {prefix}
        </span>
      ) : null}
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={raw}
        onChange={(e) => {
          const v = e.target.value;
          setRaw(v);
          onValueChange?.(v, parseDecimal(v));
          f.reportError?.(null);
        }}
        onBlur={(e) => {
          const msg = validateNumber(raw, { min, max, step, required: f.required, format: fmt });
          onValidate?.(msg);
          f.reportError?.(msg);
          const n = parseDecimal(raw);
          if (!msg && n !== null && decimals !== undefined) {
            const formatted = fmt(n);
            if (formatted !== raw) {
              setRaw(formatted);
              onValueChange?.(formatted, n);
            }
          }
          onBlur?.(e);
        }}
        id={f.id}
        aria-describedby={cx(prefix && prefixId, f.describedBy) || undefined}
        aria-invalid={f.invalid || undefined}
        aria-required={f.required || undefined}
        disabled={f.disabled}
        readOnly={f.readOnly}
        className={odsControlClass(cx('h-ods-control text-end tabular-nums', prefix && 'ps-12'))}
      />
    </div>
  );
}

export type QuantityStepperProps = {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Why "−" stops at min, e.g. "Minimum order is 50". Default "The minimum is {min}". */
  minReason?: string;
  /** Why "+" stops at max, e.g. "Only 400 in stock". Default "The maximum is {max}". */
  maxReason?: string;
  /** Read out with the unit, e.g. "pieces". */
  unit?: string;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
  'data-testid'?: string;
};

/**
 * Quantity stepper (− value +), 44 / 32 px. The input is a spinbutton (aria-valuenow/min/max): Arrow Up/Down change
 * by `step`, Page Up/Down by 10 steps; typed values are clamped and snapped on blur / Enter. At a limit the button
 * is aria-disabled (stays focusable) and the reason ("Minimum order is 50") is shown under it, linked with
 * aria-describedby and announced politely. Phones: same; numeric keypad.
 */
export function QuantityStepper({ value, defaultValue, onValueChange, min = 0, max, step = 1, minReason, maxReason, unit, disabled: disabledProp, className, 'data-testid': testId, ...aria }: QuantityStepperProps) {
  const f = useFieldControl({ ...aria, disabled: disabledProp });
  const reasonId = useId();
  const [qty, setQty] = useControllable(value, defaultValue ?? min, onValueChange);
  const [text, setText] = useState(String(qty));
  useEffect(() => {
    // keep the text in sync when the value changes from outside or via the buttons
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror of the numeric value
    setText(String(qty));
  }, [qty]);
  const opts = { min, max, step };
  const atMin = qty <= min;
  const atMax = max !== undefined && qty >= max;
  const reason = atMin ? (minReason ?? `The minimum is ${min}`) : atMax ? (maxReason ?? `The maximum is ${max}`) : null;
  const commit = (n: number) => {
    const v = clampQuantity(n, opts);
    setQty(v);
    setText(String(v));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const by = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : e.key === 'PageUp' ? step * 10 : e.key === 'PageDown' ? -step * 10 : 0;
    if (by) {
      e.preventDefault();
      commit(qty + by);
    } else if (e.key === 'Enter') {
      commit(Number(text));
    }
  };
  const btn =
    'relative inline-grid size-ods-control shrink-0 place-items-center border border-ods-slate/70 bg-ods-surface text-ods-navy transition-colors hover:bg-ods-blue-tint focus-visible:z-10 aria-disabled:cursor-not-allowed aria-disabled:bg-ods-canvas aria-disabled:text-ods-slate aria-disabled:hover:bg-ods-canvas disabled:cursor-not-allowed disabled:bg-ods-canvas disabled:text-ods-slate';
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <div className="inline-flex">
        <button
          type="button"
          aria-label="Decrease quantity"
          aria-disabled={atMin || undefined}
          aria-describedby={atMin && reason ? reasonId : undefined}
          aria-controls={f.id}
          disabled={f.disabled}
          onClick={() => !atMin && commit(qty - step)}
          className={cx(btn, 'rounded-s-ods-control')}
        >
          <Icon icon={Minus} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          role="spinbutton"
          autoComplete="off"
          aria-valuenow={qty}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={unit ? `${qty} ${unit}` : undefined}
          id={f.id}
          data-testid={testId}
          aria-describedby={cx(f.describedBy, reason && reasonId) || undefined}
          aria-invalid={f.invalid || undefined}
          aria-required={f.required || undefined}
          disabled={f.disabled}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => commit(text === '' ? min : Number(text))}
          onKeyDown={onKey}
          className={odsControlClass('-mx-px h-ods-control w-20! rounded-none text-center tabular-nums focus:relative focus:z-10')}
        />
        <button
          type="button"
          aria-label="Increase quantity"
          aria-disabled={atMax || undefined}
          aria-describedby={atMax && reason ? reasonId : undefined}
          aria-controls={f.id}
          disabled={f.disabled}
          onClick={() => !atMax && commit(qty + step)}
          className={cx(btn, 'rounded-e-ods-control')}
        >
          <Icon icon={Plus} />
        </button>
      </div>
      <div aria-live="polite">
        {reason && !f.disabled ? (
          <p id={reasonId} className="flex items-center gap-1 text-ods-small text-ods-slate">
            <Icon icon={Info} size="xs" />
            {reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}
