import type { CSSProperties, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Skeleton } from './states';

export type KpiDelta = {
  /** Always words, e.g. "+12% vs last month" (never colour or arrow alone). */
  text: string;
  direction?: 'up' | 'down' | 'flat';
  /** good = success, bad = danger, neutral = slate. Default from direction: up good, down bad. */
  tone?: 'good' | 'bad' | 'neutral';
};

export type KpiItem = {
  label: string;
  /** Usually <Money amount> or a formatted number. */
  value: ReactNode;
  delta?: KpiDelta;
  /** Small line under the value, e.g. "3 invoices". */
  hint?: ReactNode;
};

export type KpiStripProps = {
  items: KpiItem[];
  /** 'strip' = one bordered row of 4–5 figures (staff, compact); 'cards' = separate KPI cards (comfortable). */
  variant?: 'strip' | 'cards';
  /** Names the group for screen readers, e.g. "This month". */
  label?: string;
  loading?: boolean;
  className?: string;
  'data-testid'?: string;
};

const DELTA_TONE = { good: 'text-ods-success', bad: 'text-ods-danger', neutral: 'text-ods-slate' } as const;
const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;

/**
 * KpiStrip: label, big value (tabular), optional delta with words. `strip` = one bordered row with dividers;
 * `cards` = one card per figure. Markup is a <dl>. Phones: 2 per row (dividers follow the wrap).
 */
export function KpiStrip({ items, variant = 'cards', label, loading, className, 'data-testid': testId }: KpiStripProps) {
  const n = Math.max(1, Math.min(items.length || 4, 5));
  const cols = { '--kpi-cols': `repeat(${n}, minmax(0, 1fr))` } as CSSProperties;
  const strip = variant === 'strip';
  const cells = loading ? Array.from({ length: n }, () => null) : items;
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={cx('min-w-0', className)} data-testid={testId} aria-busy={loading || undefined}>
      <dl
        style={cols}
        className={cx(
          'm-0 grid grid-cols-2 ods-tablet:grid-cols-(--kpi-cols)',
          strip ? 'gap-px overflow-hidden rounded-ods-card border border-ods-line bg-ods-line' : 'gap-ods-gap',
        )}
      >
        {cells.map((item, i) => (
          <div
            key={item?.label ?? i}
            className={cx(
              'flex min-w-0 flex-col gap-1 bg-ods-surface',
              strip ? 'px-ods-pad-card py-3' : 'rounded-ods-card border border-ods-line p-3 shadow-ods-card ods-tablet:p-ods-pad-card',
              // odd count on phones: the last strip cell spans both columns so no empty grey cell shows
              strip && cells.length % 2 === 1 && i === cells.length - 1 && 'col-span-2 ods-tablet:col-span-1',
            )}
          >
            {item ? (
              <>
                <dt className="text-ods-label font-semibold text-ods-slate">{item.label}</dt>
                <dd className={cx('m-0 font-bold text-ods-navy tabular-nums [&_[data-money]]:whitespace-normal ods-tablet:[&_[data-money]]:whitespace-nowrap', strip ? 'text-ods-h2' : 'text-ods-h2 ods-tablet:text-ods-h1')}>{item.value}</dd>
                {item.delta ? <Delta {...item.delta} /> : null}
                {item.hint ? <dd className="m-0 text-ods-small text-ods-slate">{item.hint}</dd> : null}
              </>
            ) : (
              <>
                <Skeleton silent className="h-3 w-1/2" />
                <Skeleton silent className="h-6 w-3/4" />
              </>
            )}
          </div>
        ))}
      </dl>
      {loading ? (
        <span role="status" className="sr-only">
          Loading figures
        </span>
      ) : null}
    </div>
  );
}

function Delta({ text, direction = 'flat', tone }: KpiDelta) {
  const t = tone ?? (direction === 'up' ? 'good' : direction === 'down' ? 'bad' : 'neutral');
  return (
    <dd className={cx('m-0 inline-flex items-center gap-1 text-ods-small font-semibold', DELTA_TONE[t])}>
      <Icon icon={DELTA_ICON[direction]} size="xs" className={direction === 'flat' ? 'rtl:-scale-x-100' : undefined} />
      {text}
    </dd>
  );
}
