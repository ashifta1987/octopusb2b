import Link from 'next/link';
import { Children, useId, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Info, PackageSearch } from 'lucide-react';
import { cx } from '../cx';
import { Icon, ODS_SERVICE_ICONS } from '../icon';
import { odsServices, type OdsServiceKey } from '../tokens';
import { EmptyState, ErrorState, Skeleton } from './states';

export type ServiceSectionProps = {
  service: OdsServiceKey;
  /** Section name; default the service name ("MOQ pools", "Warehouse (3PL)" …). */
  title?: string;
  /** Number of items of this type (shown after the name). Hidden while loading or failed. */
  count?: number;
  /** Visible count text, default the formatted number, e.g. "5 services". */
  countLabel?: string;
  /** One line under the name: what this service is. */
  explainer: string;
  seeAllHref: string;
  /** Default "See all <title>". */
  seeAllLabel?: string;
  /** Info line above the cards (e.g. Dropship access, Warehouse rates note). */
  note?: ReactNode;
  /** Heading level of the section name (default 2 = the Shop main page). */
  headingLevel?: 2 | 3;
  /** Anchor id for the JumpBar; the heading gets `${id}-heading` and tabIndex -1 so focus can move to it. */
  id?: string;
  /** The (up to 4) cards. Each is wrapped in a list item. */
  children?: ReactNode;
  loading?: boolean;
  /** Failed to load: `true` = "We couldn’t load <title>.", or your own sentence. Isolated to this section. */
  error?: boolean | string;
  onRetry?: () => void;
  /** Nothing to show (e.g. the chosen category has none). */
  empty?: boolean;
  /** Default "No <title> in this category yet". */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

/** "Turnkey projects" → "turnkey projects" mid-sentence; names with other capitals ("MOQ pools", "Make My Brand") stay. */
function inSentence(title: string) {
  const plain = /^[A-Z][a-z]/.test(title) && title.split(' ').slice(1).every((w) => !/^[A-Z]/.test(w));
  return plain ? title[0].toLowerCase() + title.slice(1) : title;
}

/**
 * ServiceSection (Part 2.5 / 5.2): one service's band on the Shop main page — service tint, 6 px bar in the service
 * colour on the start edge, icon tile, name + count, one-line explainer, "See all …", then 4 cards.
 * Loading = skeleton cards; error = ErrorState with Try again inside this section only (others keep showing);
 * empty = "No … in this category yet". Wrap it in <ServiceSectionBoundary> to also catch render errors.
 * Phones: header stacks; the cards scroll sideways with snap (one and a bit visible). Tablet 2 per row, desktop 4.
 */
export function ServiceSection({
  service,
  title,
  count,
  countLabel,
  explainer,
  seeAllHref,
  seeAllLabel,
  note,
  headingLevel = 2,
  id,
  children,
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  className,
  'data-testid': testId,
}: ServiceSectionProps) {
  const auto = useId();
  const svc = odsServices.find((s) => s.key === service) ?? odsServices[0];
  const name = title ?? svc.name;
  const headingId = id ? `${id}-heading` : `${auto}-h`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const vars = { '--svc-c': `var(--svc-${service})`, '--svc-t': `var(--svc-${service}-tint)` } as CSSProperties;
  const items = Children.toArray(children);
  const ready = !loading && !error;

  let content: ReactNode;
  if (error) {
    content = (
      <div className="rounded-ods-card bg-ods-surface">
        <ErrorState
          headingLevel={headingLevel === 2 ? 3 : 4}
          title={typeof error === 'string' ? error : `We couldn\u2019t load ${inSentence(name)}.`}
          description="Everything else is fine. Try again in a moment."
          onRetry={onRetry}
        />
      </div>
    );
  } else if (loading) {
    content = (
      <div className="grid grid-cols-1 gap-ods-gap ods-tablet:grid-cols-2 ods-desktop:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cx('flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4', i > 1 && 'hidden ods-tablet:flex')}>
            <Skeleton silent className="h-[130px] w-full" />
            <Skeleton silent className="h-4 w-4/5" />
            <Skeleton silent lines={3} />
            <Skeleton silent className="h-ods-control w-1/2" />
          </div>
        ))}
        <span role="status" className="sr-only">
          Loading {name}
        </span>
      </div>
    );
  } else if (empty || items.length === 0) {
    content = (
      <div className="rounded-ods-card bg-ods-surface">
        <EmptyState
          icon={PackageSearch}
          headingLevel={headingLevel === 2 ? 3 : 4}
          title={emptyTitle ?? `No ${inSentence(name)} in this category yet`}
          description={emptyDescription}
          action={emptyAction}
        />
      </div>
    );
  } else {
    content = (
      <ul
        role="list"
        className={cx(
          '-mx-1 flex snap-x snap-mandatory gap-ods-gap overflow-x-auto px-1 pb-2',
          'ods-tablet:mx-0 ods-tablet:grid ods-tablet:snap-none ods-tablet:grid-cols-2 ods-tablet:overflow-visible ods-tablet:px-0 ods-tablet:pb-0 ods-desktop:grid-cols-4',
        )}
      >
        {items.map((child, i) => (
          <li key={i} className="flex w-[min(80%,300px)] shrink-0 snap-start ods-tablet:w-auto [&>*]:w-full">
            {child}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-service={service}
      data-testid={testId}
      style={vars}
      className={cx(
        'flex min-w-0 scroll-mt-24 flex-col gap-4 rounded-ods-card border border-ods-line border-s-[6px] border-s-(color:--svc-c) bg-(color:--svc-t) p-ods-pad-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span aria-hidden="true" className="inline-grid size-[calc(var(--ods-control-h)-4px)] shrink-0 place-items-center rounded-ods-control bg-(color:--svc-c) text-white">
          <Icon icon={ODS_SERVICE_ICONS[service]} size="lg" />
        </span>
        <div className="min-w-0 flex-[1_1_240px]">
          <Heading id={headingId} tabIndex={id ? -1 : undefined} className="m-0 text-ods-h2">
            {name}
            {ready && count !== undefined ? (
              <span className="ms-2 text-ods-label font-semibold text-(color:--svc-c)">{countLabel ?? count.toLocaleString('en-US')}</span>
            ) : null}
          </Heading>
          <p className="m-0 mt-1 text-ods-small text-ods-slate">{explainer}</p>
        </div>
        <Link
          href={seeAllHref}
          className="inline-flex min-h-ods-control items-center gap-1 self-center text-ods-label font-bold whitespace-nowrap text-(color:--svc-c) underline-offset-4 hover:underline"
        >
          {seeAllLabel ?? `See all ${inSentence(name)}`}
          <Icon icon={ArrowRight} size="sm" className="rtl:-scale-x-100" />
        </Link>
      </div>
      {note && !error ? (
        <p className="m-0 flex items-start gap-1.5 text-ods-small text-(color:--svc-c)">
          <Icon icon={Info} size="xs" className="mt-[3px]" />
          <span>{note}</span>
        </p>
      ) : null}
      {content}
    </section>
  );
}
