import Link from 'next/link';
import { CalendarClock, Inbox } from 'lucide-react';
import { EmptyState, Icon, Skeleton, buttonClass, cx } from '@octopus/ui';
import type { WaitingActionType } from '@/lib/core/waiting-items';
import { ACCOUNT_PATHS } from '../_lib/nav';
import { WAITING_TYPE_ORDER } from '../_lib/status';
import type { WaitingRowView } from '../_lib/types';
import { ActionFilters } from './action-filters';
import { DueCell, WaitingAction } from './home-panels';

/**
 * ODS T6 · /account/action — Action needed (Part 6.3, board C_Action). Presentational, server-safe.
 * FilterPills All · Pay · Approve · Review · Reply (?type=) + one card per item with its due date and ONE action,
 * soonest / oldest first (the order of listWaiting). Empty text per filter; loading and error states.
 */

export const parseActionType = (v: string | string[] | undefined): WaitingActionType | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && (WAITING_TYPE_ORDER as readonly string[]).includes(s) ? (s as WaitingActionType) : null;
};

export function countByType(rows: WaitingRowView[]): Record<WaitingActionType, number> {
  const c: Record<WaitingActionType, number> = { pay: 0, approve: 0, review: 0, reply: 0 };
  rows.forEach((r) => (c[r.type] += 1));
  return c;
}

const EMPTY: Record<'all' | WaitingActionType, { title: string; description: string }> = {
  all: { title: 'Nothing needs you right now', description: 'New quotes, payments due and questions from our team appear here.' },
  pay: { title: 'Nothing to pay right now', description: 'Deposits, balances and bank transfers that need you appear here.' },
  approve: { title: 'Nothing to approve', description: 'Proofs and other approvals appear here when a service sends them.' },
  review: { title: 'No quotes to review', description: 'New quotes for your sourcing requests appear here.' },
  reply: { title: 'No questions waiting for you', description: 'When our team needs information from you, it appears here.' },
};

export function ActionHeader() {
  return (
    <div>
      <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Action needed</h1>
      <p className="m-0 mt-1 text-ods-body text-ods-slate">Everything that needs your decision, across all services. Soonest due first.</p>
    </div>
  );
}

export function ActionCard({ row }: { row: WaitingRowView }) {
  return (
    <li
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card"
      data-testid="action-card"
      data-type={row.type}
    >
      <div className="min-w-0 flex-1 basis-[280px]">
        <p className="m-0 text-ods-small font-semibold tracking-wide text-ods-slate uppercase">{row.service}</p>
        <p className="m-0 mt-0.5 text-ods-body font-semibold text-ods-navy">{row.what}</p>
        {row.detail && row.detail !== row.what ? <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{row.detail}</p> : null}
      </div>
      <div className="flex min-w-[140px] items-center gap-2 text-ods-body">
        <Icon icon={CalendarClock} className="text-ods-slate" />
        <span className="sr-only">Due: </span>
        <DueCell due={row.due} />
      </div>
      <WaitingAction row={row} />
    </li>
  );
}

export type ActionNeededViewProps = {
  rows: WaitingRowView[];
  type: WaitingActionType | null;
  /** Where the filter pills navigate (fixtures pass their own URL). */
  basePath?: string;
  state?: 'ready' | 'loading' | 'error';
};

export function ActionNeededView({ rows, type, basePath = ACCOUNT_PATHS.action, state = 'ready' }: ActionNeededViewProps) {
  const counts = countByType(rows);
  const shown = type ? rows.filter((r) => r.type === type) : rows;
  const empty = EMPTY[type ?? 'all'];
  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 p-ods-pad-page" data-testid="action-page">
      <ActionHeader />
      {state === 'error' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-ods-card border border-ods-danger/30 bg-ods-danger-tint p-4" data-testid="panel-error">
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold text-ods-navy">We couldn’t load the things waiting for you.</p>
            <p className="m-0 mt-0.5 text-ods-small text-ods-text">Nothing was changed. Try again in a moment.</p>
          </div>
          <a href={basePath} className={buttonClass('secondary', 'sm')}>
            Try again
          </a>
        </div>
      ) : state === 'loading' ? (
        <div aria-busy="true" className="grid gap-3">
          <Skeleton className="h-10 w-96 max-w-full" label="Loading the things waiting for you" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} silent className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <ActionFilters type={type} counts={counts} total={rows.length} basePath={basePath} />
          <section aria-labelledby="action-list-h">
            <h2 id="action-list-h" className="sr-only">
              Waiting for you
            </h2>
            {shown.length === 0 ? (
              <div className="rounded-ods-card border border-ods-line bg-ods-surface" data-testid="action-empty">
                <EmptyState icon={Inbox} headingLevel={3} title={empty.title} description={empty.description} action={type ? <Link href={basePath} className={buttonClass('secondary', 'sm')}>Show all</Link> : undefined} />
              </div>
            ) : (
              <ul className={cx('m-0 grid list-none gap-3 p-0')} data-testid="action-list">
                {shown.map((r) => (
                  <ActionCard key={r.id} row={r} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
