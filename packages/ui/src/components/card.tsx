import type { ReactNode } from 'react';
import { cx } from '../cx';
import { ErrorState, Skeleton } from './states';

type HeadingLevel = 2 | 3 | 4;
const H = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

type Slots = {
  /** Optional header title. */
  title?: ReactNode;
  /** Heading level of the title (default 3), so pages never skip levels. */
  headingLevel?: HeadingLevel;
  /** One line under the title. */
  description?: ReactNode;
  /** Right side of the header: buttons, links, a menu. */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Shows a skeleton instead of the body (header stays). */
  loading?: boolean;
  /** Rendered instead of the body, e.g. an <EmptyState>. Wins over children. */
  empty?: ReactNode;
  /** Rendered instead of the body, e.g. an <ErrorState onRetry>. `true` = the default ErrorState. Wins over everything. */
  error?: ReactNode;
  as?: 'section' | 'div' | 'article';
  className?: string;
  /** Classes for the body wrapper. */
  bodyClassName?: string;
  id?: string;
  'data-testid'?: string;
};

function body({ loading, empty, error, children }: Pick<Slots, 'loading' | 'empty' | 'error' | 'children'>) {
  if (error) return error === true ? <ErrorState /> : error;
  if (loading) return <Skeleton lines={3} />;
  if (empty) return empty;
  return children;
}

export type CardProps = Slots;

/**
 * Card (comfortable areas): white surface, 14 px radius / 20 px padding (12 + 6 px in compact, from tokens), card shadow.
 * Optional header (title + actions), footer, and loading / empty / error slots that replace only the body.
 * Phones: full width; header actions wrap under the title.
 */
export function Card({ title, headingLevel = 3, description, actions, footer, children, loading, empty, error, as = 'div', className, bodyClassName, id, 'data-testid': testId }: CardProps) {
  const Tag = as;
  const Heading = H[headingLevel];
  const hasHeader = title || actions;
  return (
    <Tag id={id} data-testid={testId} className={cx('min-w-0 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card', className)}>
      {hasHeader ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? <Heading className="m-0 text-ods-h2">{title}</Heading> : null}
            {description ? <p className="m-0 mt-1 text-ods-small text-ods-slate">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx('min-w-0', bodyClassName)} aria-busy={loading || undefined}>
        {body({ loading, empty, error, children })}
      </div>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ods-line pt-4">{footer}</div> : null}
    </Tag>
  );
}

export type PanelProps = Slots;

/**
 * Panel (staff / compact areas, also fine in comfortable): bordered box with a header bar (40 px compact,
 * 52 px comfortable = control height + 8), a divider, body padding 12 px compact / 20 px comfortable.
 * Phones: full width; header actions stay on the right and wrap under the title when there is no room.
 */
export function Panel({ title, headingLevel = 3, description, actions, footer, children, loading, empty, error, as = 'section', className, bodyClassName, id, 'data-testid': testId }: PanelProps) {
  const Tag = as;
  const Heading = H[headingLevel];
  const hasHeader = title || actions;
  return (
    <Tag id={id} data-testid={testId} className={cx('min-w-0 overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface', className)}>
      {hasHeader ? (
        <div className="flex min-h-[calc(var(--ods-control-h)+8px)] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ods-line px-ods-pad-card py-1">
          <div className="min-w-0">
            {title ? <Heading className="m-0 text-ods-body font-semibold">{title}</Heading> : null}
            {description ? <p className="m-0 text-ods-small text-ods-slate">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx('min-w-0 p-ods-pad-card', bodyClassName)} aria-busy={loading || undefined}>
        {body({ loading, empty, error, children })}
      </div>
      {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-ods-line px-ods-pad-card py-2">{footer}</div> : null}
    </Tag>
  );
}
