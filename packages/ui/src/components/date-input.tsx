'use client';

import { useId, useState, type ComponentProps } from 'react';
import { cx } from '../cx';
import { formatDate } from '../format';
import { odsControlClass } from '../form-utils';
import { useFieldControl } from './field';

export type DateInputProps = Omit<ComponentProps<'input'>, 'type' | 'size'> & {
  /** Under the box: the chosen date as "27 Nov 2026" (or the format when empty). Default true. */
  showReadout?: boolean;
};

/**
 * Date input: native type="date" (keyboard entry + the OS calendar; value is ISO yyyy-mm-dd), styled 44 / 32 px.
 * The read-out under it shows the chosen date in the ODS format "27 Nov 2026" (2.7), linked with aria-describedby.
 * Phones: the OS date picker opens.
 */
export function DateInput({ showReadout = true, className, value, defaultValue, onChange, ...rest }: DateInputProps) {
  const f = useFieldControl(rest);
  const readoutId = useId();
  const [inner, setInner] = useState(String(defaultValue ?? ''));
  const current = value !== undefined ? String(value) : inner;
  const pretty = current ? formatDate(current) : '';
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <input
        {...rest}
        type="date"
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          if (value === undefined) setInner(e.target.value);
          onChange?.(e);
        }}
        id={f.id}
        aria-describedby={cx(f.describedBy, showReadout && readoutId) || undefined}
        aria-invalid={f.invalid || undefined}
        aria-required={f.required || undefined}
        disabled={f.disabled}
        readOnly={f.readOnly}
        className={odsControlClass('h-ods-control tabular-nums')}
      />
      {showReadout ? (
        <span id={readoutId} className="text-ods-small text-ods-slate">
          {pretty ? `Shows as ${pretty}` : 'Shows as 27 Nov 2026'}
        </span>
      ) : null}
    </div>
  );
}
