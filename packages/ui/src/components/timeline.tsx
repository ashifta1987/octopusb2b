import type { ReactNode } from 'react';
import { CircleCheck, CircleDot, Circle } from 'lucide-react';
import { cx } from '../cx';
import { formatDate, formatTime } from '../format';
import { Icon } from '../icon';
import { EmptyState, Skeleton } from './states';

type DateLike = Date | string;

function When({ date, showTime, timeZone, timeZoneLabel }: { date: DateLike; showTime?: boolean; timeZone?: string; timeZoneLabel?: string }) {
  const d = typeof date === 'string' ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={d.toISOString()} className="whitespace-nowrap">
      {formatDate(d)}
      {showTime ? `, ${formatTime(d, timeZone, timeZoneLabel)}` : ''}
    </time>
  );
}

/* ───────── Timeline ───────── */

export type TimelineItem = {
  id: string;
  title: ReactNode;
  /** done = teal check, current = blue (aria-current="step"), next = grey outline. */
  state?: 'done' | 'current' | 'next';
  date?: DateLike;
  actor?: string;
  description?: ReactNode;
};

export type TimelineProps = {
  items: TimelineItem[];
  /** Names the list, e.g. "Order progress". */
  label: string;
  /** Adds the time ("18:00 (Dubai time)") after the date. */
  showTime?: boolean;
  timeZone?: string;
  timeZoneLabel?: string;
  className?: string;
};

const STEP = {
  done: { icon: CircleCheck, cls: 'text-ods-success', word: 'Done' },
  current: { icon: CircleDot, cls: 'text-ods-blue', word: 'Now' },
  next: { icon: Circle, cls: 'text-ods-line-strong', word: 'Next' },
} as const;

/**
 * Timeline: vertical list of steps/events (ol/li), dot + title + date/actor. The state is also given in words
 * (sr-only "Done/Now/Next"), never colour alone. Phones: same (it is already vertical).
 */
export function Timeline({ items, label, showTime, timeZone, timeZoneLabel, className }: TimelineProps) {
  return (
    <ol aria-label={label} className={cx('m-0 list-none p-0', className)}>
      {items.map((it, i) => {
        const s = STEP[it.state ?? 'done'];
        const last = i === items.length - 1;
        return (
          <li key={it.id} aria-current={it.state === 'current' ? 'step' : undefined} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span className={cx('mt-0.5', s.cls)}>
                <Icon icon={s.icon} />
              </span>
              {!last ? <span aria-hidden="true" className="mt-1 w-px flex-1 bg-ods-line" /> : null}
            </span>
            <div className={cx('min-w-0 flex-1', !last && 'pb-4')}>
              <p className={cx('m-0 text-ods-body', it.state === 'next' ? 'text-ods-slate' : 'font-semibold text-ods-navy')}>
                <span className="sr-only">{s.word}: </span>
                {it.title}
              </p>
              {it.date || it.actor ? (
                <p className="m-0 text-ods-small text-ods-slate">
                  {it.date ? <When date={it.date} showTime={showTime} timeZone={timeZone} timeZoneLabel={timeZoneLabel} /> : null}
                  {it.date && it.actor ? ' · ' : null}
                  {it.actor}
                </p>
              ) : null}
              {it.description ? <div className="mt-1 text-ods-small text-ods-slate">{it.description}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────── ActivityFeed ───────── */

export type ActivityItem = {
  id: string;
  /** What happened, e.g. "Quote sent for RFQ-1042". */
  title: ReactNode;
  actor?: string;
  date: DateLike;
  /** Dot colour; meaning is always in the title text. */
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
};

export type ActivityFeedProps = {
  items: ActivityItem[];
  label: string;
  loading?: boolean;
  /** Shown when there are no items. Default "No activity yet". */
  emptyTitle?: string;
  showTime?: boolean;
  timeZone?: string;
  timeZoneLabel?: string;
  className?: string;
};

const DOT = { info: 'bg-ods-info', success: 'bg-ods-success', warning: 'bg-ods-warning', danger: 'bg-ods-danger', neutral: 'bg-ods-slate' } as const;

/** ActivityFeed: newest first, dot + title + actor · date, divided rows; loading and empty states. Phones: same. */
export function ActivityFeed({ items, label, loading, emptyTitle = 'No activity yet', showTime, timeZone, timeZoneLabel, className }: ActivityFeedProps) {
  if (loading)
    return (
      <div className={cx('flex flex-col gap-4', className)} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton silent className="mt-1.5 size-2 rounded-full" />
            <Skeleton silent lines={2} />
          </div>
        ))}
        <span role="status" className="sr-only">
          Loading {label}
        </span>
      </div>
    );
  if (!items.length) return <EmptyState title={emptyTitle} className={className} />;
  return (
    <ol aria-label={label} className={cx('m-0 list-none divide-y divide-ods-line p-0', className)}>
      {items.map((it) => (
        <li key={it.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
          <span aria-hidden="true" className={cx('mt-2 size-2 shrink-0 rounded-full', DOT[it.tone ?? 'info'])} />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-ods-body text-ods-navy">{it.title}</p>
            <p className="m-0 text-ods-small text-ods-slate">
              {it.actor ? `${it.actor} · ` : null}
              <When date={it.date} showTime={showTime} timeZone={timeZone} timeZoneLabel={timeZoneLabel} />
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
