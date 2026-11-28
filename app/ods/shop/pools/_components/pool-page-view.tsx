import Image from 'next/image';
import { ImageIcon, Users } from 'lucide-react';
import { Breadcrumbs, Button, Icon, Money, NamedTabLink, StatusPill, Timeline, formatNumber, type TimelineItem } from '@octopus/ui';
import { isOptimizableImage } from '@octopus/ui/image-url';
import { closesIn } from '../../_lib/cards';
import { buyerCount, currencyPrefix, isFilledStatus, major, poolStatusName, unitWord, type PoolView } from '../_lib/pool-logic';
import { ClosingTime } from './closing-time';
import { PoolJoinForm } from './join-form';
import { NotifyMe } from './notify-me';
import type { JoinState, NotifyAction } from './pool-types';
import type { CartAddFn } from '../../cart/_lib/cart-ui';

export type PoolPageViewProps = {
  pool: PoolView;
  /** Request time (ms) for "closes in" and the status. */
  now: number;
  join: JoinState;
  /** The viewer's email for Notify me. */
  email: string | null;
  notifyAction?: NotifyAction;
  /** T5a: Join pool adds a cart pool line (see PoolJoinForm). */
  cartAdd?: CartAddFn;
  /** Fixtures: Join pool shows a sample message instead of navigating. */
  demo?: boolean;
  /** Fixtures: start value for the units (e.g. the minimum). */
  initialUnits?: number;
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
};

const pledgeLabel: Record<string, string> = { pending: 'Deposit pending', paid: 'Deposit paid', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered' };

function timelineFor(p: PoolView, now: number): TimelineItem[] {
  const u = (n: number) => unitWord(p.unit, n);
  const opened: TimelineItem = { id: 'opened', title: 'Pool opened', state: 'done', date: p.createdAt };
  if (isFilledStatus(p.status)) {
    return [
      opened,
      { id: 'filled', title: 'Pool filled', state: 'done', ...(p.filledAt ? { date: p.filledAt } : {}), description: `${formatNumber(p.filledQty)} ${u(p.filledQty)} · ${buyerCount(p.buyers)}` },
      { id: 'production', title: 'Production', state: p.status === 'locked' || p.status === 'confirmed' ? 'current' : 'done', description: 'After every balance is paid' },
      { id: 'shipping', title: 'QC and shipping', state: p.status === 'completed' ? 'done' : p.status === 'shipped' ? 'current' : 'next', description: 'Shipped to each buyer' },
    ];
  }
  if (p.status !== 'open' || new Date(p.deadlineAt).getTime() <= now) {
    return [opened, { id: 'closed', title: 'Pool closed without filling', state: 'done', date: p.deadlineAt, description: 'Deposits went back to the buyers’ wallets' }];
  }
  return [
    opened,
    { id: 'joined', title: `${formatNumber(p.filledQty)} ${u(p.filledQty)} joined`, state: 'current', description: buyerCount(p.buyers) },
    { id: 'closes', title: 'Pool closes', state: 'next', date: p.deadlineAt },
    { id: 'production', title: 'Production', state: 'next', description: 'After the pool fills and balances are paid' },
    { id: 'shipping', title: 'QC and shipping', state: 'next', description: 'Shipped to each buyer' },
  ];
}

/**
 * ODS T4 · /shop/pools/[code] (Part 5.5, Shop_Pools "pool details"): image, pool vs normal price, target, closing time in
 * the customer's time zone, progress bar (role=progressbar), buyer COUNT only, the join panel for the company's state,
 * and the timeline. Presentational: props only (the page and the fixtures pass them).
 */
export function PoolPageView({ pool: p, now, join, email, notifyAction, cartAdd, demo, initialUnits, titleLevel = 1 }: PoolPageViewProps) {
  const T = titleLevel === 2 ? 'h2' : 'h1';
  const S = titleLevel === 2 ? 'h3' : 'h2';
  const cur = currencyPrefix(p.currency);
  const u = (n: number) => unitWord(p.unit, n);
  const status = poolStatusName(p, now);
  const pct = p.targetQty > 0 ? Math.min(100, Math.round((p.filledQty / p.targetQty) * 100)) : 0;
  const progressText = `${formatNumber(p.filledQty)} of ${formatNumber(p.targetQty)} ${u(p.targetQty)}`;
  const showNormal = p.basePriceMinor != null && p.poolPriceMinor != null && p.basePriceMinor > p.poolPriceMinor;
  const left = closesIn(p.deadlineAt, now);

  return (
    <div className="flex flex-col gap-6" data-testid="pool-page">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'MOQ pools', href: '/shop/pools' }, { label: p.title }]} />
      <section aria-labelledby="pool-title" className="flex flex-col gap-5 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            {status !== 'Filled' && status !== 'Closed (not filled)' ? <span className="text-ods-small text-ods-slate">Closes in {left}</span> : null}
          </div>
          <T id="pool-title" className="m-0 text-ods-h1 text-ods-navy">
            {p.title}
          </T>
          <p className="m-0 text-ods-small text-ods-slate">Pool {p.code}</p>
        </header>
        <div className="grid gap-5 ods-tablet:grid-cols-2">
          {p.image ? (
            <Image
              src={p.image}
              alt={p.title}
              width={640}
              height={480}
              unoptimized={!isOptimizableImage(p.image)}
              sizes="(min-width: 768px) 50vw, 100vw"
              className="aspect-[4/3] w-full rounded-ods-control bg-ods-canvas object-cover"
            />
          ) : (
            <div aria-hidden="true" className="grid aspect-[4/3] w-full place-items-center rounded-ods-control bg-ods-canvas text-ods-slate">
              <Icon icon={ImageIcon} size="xl" />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-3">
            <dl className="m-0 flex flex-col gap-2 text-ods-body">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="text-ods-slate">Pool price</dt>
                <dd className="m-0 font-semibold text-ods-navy" data-testid="pool-price">
                  {p.poolPriceMinor != null ? <Money amount={major(p.poolPriceMinor)} currency={cur} suffix={`per ${u(1)}`} /> : 'Not set yet'}
                </dd>
              </div>
              {showNormal ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-ods-slate">Normal price</dt>
                  <dd className="m-0 text-ods-navy">
                    <Money amount={major(p.basePriceMinor!)} currency={cur} suffix={`per ${u(1)}`} />
                    {p.savingPct > 0 ? <span className="ms-2 text-ods-small font-semibold text-ods-success">Save up to {p.savingPct}% if it fills</span> : null}
                  </dd>
                </div>
              ) : null}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="text-ods-slate">Target</dt>
                <dd className="m-0 text-ods-navy">
                  {formatNumber(p.targetQty)} {u(p.targetQty)}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="text-ods-slate">{status === 'Filled' || status === 'Closed (not filled)' ? 'Closed' : 'Closes'}</dt>
                <dd className="m-0 text-ods-navy">
                  <ClosingTime iso={p.deadlineAt} now={now} />
                </dd>
              </div>
            </dl>
            <div
              role="progressbar"
              aria-label="Pool filled"
              aria-valuemin={0}
              aria-valuemax={p.targetQty}
              aria-valuenow={Math.min(p.filledQty, p.targetQty)}
              aria-valuetext={progressText}
              data-testid="pool-progress"
              className="h-2.5 w-full overflow-hidden rounded-full bg-ods-line"
            >
              <span className="block h-full rounded-full bg-ods-success" style={{ width: `${pct}%` }} />
            </div>
            <p className="m-0 flex items-center gap-1.5 text-ods-body text-ods-navy" data-testid="pool-buyers">
              <Icon icon={Users} size="sm" className="text-ods-slate" />
              {progressText} · {buyerCount(p.buyers)}
            </p>
            <p className="m-0 text-ods-small text-ods-slate">Buyers in a pool never see each other&apos;s names, only how many have joined.</p>
          </div>
        </div>

        <JoinPanel pool={p} join={join} email={email} notifyAction={notifyAction} cartAdd={cartAdd} demo={demo} initialUnits={initialUnits} titleLevel={titleLevel} />

        <section aria-labelledby="pool-timeline" className="flex flex-col gap-3">
          <S id="pool-timeline" className="m-0 text-ods-h2 text-ods-navy">
            Timeline
          </S>
          <Timeline items={timelineFor(p, now)} label={`Pool ${p.code} timeline`} />
        </section>
      </section>
    </div>
  );
}

function JoinPanel({ pool: p, join, email, notifyAction, cartAdd, demo, initialUnits, titleLevel = 1 }: Omit<PoolPageViewProps, 'now'>) {
  const S = titleLevel === 2 ? 'h3' : 'h2';
  const u = (n: number) => unitWord(p.unit, n);
  if (join.kind === 'open') {
    return <PoolJoinForm pool={p} continueHref={`/pool/${encodeURIComponent(p.code)}#join-h`} cartAdd={cartAdd} demo={demo} initialUnits={initialUnits} headingLevel={titleLevel === 2 ? 3 : 2} />;
  }
  if (join.kind === 'mine') {
    return (
      <section aria-labelledby="mine-title" data-testid="pool-mine" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-blue-tint p-ods-pad-card">
        <S id="mine-title" className="m-0 text-ods-h2 text-ods-navy">
          You&apos;re in this pool
        </S>
        <p className="m-0 text-ods-body">
          Your company joined with {formatNumber(join.qty)} {u(join.qty)} · {pledgeLabel[join.status] ?? join.status}.
        </p>
        <NamedTabLink href="/account/pools" tab="account" className="self-start text-ods-body font-semibold text-ods-navy underline">
          See it in My account › MOQ pools
        </NamedTabLink>
      </section>
    );
  }
  if (join.kind === 'blocked') {
    return (
      <section aria-labelledby="join-title" data-testid="join-form" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
        <S id="join-title" className="m-0 text-ods-h2 text-ods-navy">
          Join this pool
        </S>
        <Button variant="primary" disabled disabledReason={join.reason} className="self-start">
          Join pool
        </Button>
      </section>
    );
  }
  const full = join.kind === 'full';
  return (
    <section aria-labelledby="full-title" data-testid="pool-full" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-info-tint p-ods-pad-card ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between">
      <div className="flex flex-col gap-1">
        <S id="full-title" className="m-0 text-ods-h2 text-ods-navy">
          {full ? 'This pool is full.' : 'This pool has closed.'}
        </S>
        <p className="m-0 text-ods-body">
          {full && join.reason ? `${join.reason} ` : ''}
          Get an email when the next MOQ pool opens.
        </p>
      </div>
      <NotifyMe email={email} action={notifyAction} />
    </section>
  );
}
