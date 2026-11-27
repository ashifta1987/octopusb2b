import { cx } from '../cx';
import { formatMoney } from '../format';

export type MoneyProps = {
  amount: number;
  /** Prefix, default "US$" (customers see US$ everywhere for now, Part 2.7). */
  currency?: string;
  /** 'always' adds "+" to positive amounts (deltas, credits). Negatives always get "−" (U+2212). */
  signDisplay?: 'auto' | 'always';
  /** Decimal places, default 2. */
  decimals?: number;
  /** Text after the amount, e.g. "/ set". */
  suffix?: string;
  className?: string;
};

/**
 * Money (Part 2.5/2.7): "US$ 1,234.56", tabular figures, never wraps. Negatives read "−US$ 420.00" in danger red —
 * the minus sign carries the meaning, the colour only repeats it. In number columns align the cell with `text-end`.
 */
export function Money({ amount, currency, signDisplay, decimals, suffix, className }: MoneyProps) {
  const negative = amount < 0;
  return (
    <span data-money="" className={cx('font-ods whitespace-nowrap tabular-nums', negative && 'text-ods-danger', className)}>
      {formatMoney(amount, { currency, signDisplay, decimals })}
      {suffix ? <span className="font-normal"> {suffix}</span> : null}
    </span>
  );
}
