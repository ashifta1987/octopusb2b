import type { ReactNode } from 'react';
import { CircleAlert, Inbox, RotateCw, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Button } from './button';

type HeadingLevel = 2 | 3 | 4;
const H = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Usually one Button (the next step), e.g. "Find products". */
  action?: ReactNode;
  /** Default 3. */
  headingLevel?: HeadingLevel;
  className?: string;
};

/**
 * Empty state (every list, panel and tab has one): icon, title, one line saying what to do, optional action.
 * Centred; spacing follows density. Phones: same, actions wrap.
 */
export function EmptyState({ icon = Inbox, title, description, action, headingLevel = 3, className }: EmptyStateProps) {
  const Tag = H[headingLevel];
  return (
    <div className={cx('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      <span aria-hidden="true" className="inline-grid size-ods-control place-items-center rounded-full bg-ods-blue-tint text-ods-blue">
        <Icon icon={icon} />
      </span>
      <Tag className="m-0 text-ods-body font-semibold text-ods-navy">{title}</Tag>
      {description ? <div className="max-w-[48ch] text-ods-small text-ods-slate">{description}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export type ErrorStateProps = {
  /** What happened, in plain words. Default "We couldn’t load this." Never a technical code. */
  title?: string;
  /** What to do next. Default "Everything else is fine. Try again in a moment." */
  description?: ReactNode;
  /** Shows a "Try again" button (from client components: it is a function). */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra action next to Try again, e.g. a Contact support link. */
  action?: ReactNode;
  headingLevel?: HeadingLevel;
  /** role="alert": only for errors that appear after the user did something (not on first render). */
  live?: boolean;
  className?: string;
};

/**
 * Error state for a list, panel, section or tab. Isolated: render it in place of the failing part only, so one failure
 * never blanks the page. Says what happened and what to do, with Try again. Phones: same.
 */
export function ErrorState({
  title = 'We couldn\u2019t load this.',
  description = 'Everything else is fine. Try again in a moment.',
  onRetry,
  retryLabel = 'Try again',
  action,
  headingLevel = 3,
  live,
  className,
}: ErrorStateProps) {
  const Tag = H[headingLevel];
  return (
    <div role={live ? 'alert' : undefined} className={cx('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      <span aria-hidden="true" className="inline-grid size-ods-control place-items-center rounded-full bg-ods-danger-tint text-ods-danger">
        <Icon icon={CircleAlert} />
      </span>
      <Tag className="m-0 text-ods-body font-semibold text-ods-navy">{title}</Tag>
      {description ? <div className="max-w-[48ch] text-ods-small text-ods-slate">{description}</div> : null}
      {onRetry || action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button variant="secondary" iconStart={RotateCw} onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

export type SkeletonProps = {
  /** Size/shape of a single block (default `h-4 w-full`), or extra classes on the wrapper when `lines` is set. */
  className?: string;
  /** Renders this many text lines (the last one shorter). */
  lines?: number;
  /** Read out once by screen readers. Default "Loading". */
  label?: string;
  /** No status at all: for blocks inside a bigger skeleton that already announces itself. */
  silent?: boolean;
};

const BAR = 'block animate-pulse rounded-ods-control bg-ods-line';

/**
 * Loading placeholder: grey blocks (aria-hidden) + one sr-only "Loading" status. Show after ~300 ms; never a
 * full-page spinner. The pulse stops under prefers-reduced-motion (tokens.css). Phones: same.
 */
export function Skeleton({ className, lines, label = 'Loading', silent }: SkeletonProps) {
  const status = silent ? null : (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
  if (!lines) {
    return (
      <>
        <span aria-hidden="true" className={cx(BAR, className ?? 'h-4 w-full')} />
        {status}
      </>
    );
  }
  return (
    <span className={cx('flex w-full flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} aria-hidden="true" className={cx(BAR, 'h-3.5', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
      {status}
    </span>
  );
}
