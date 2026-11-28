import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight, ArrowUpRight, Box, Check, CircleCheck, Clock, Eye, Layers, Package, Plus, RotateCw, ShoppingBag, Sparkles, Store, Truck, Upload, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState, Icon, Money, NamedTabLink, Skeleton, StatusPill, buttonClass, cx } from '@octopus/ui';
import { ACCOUNT_PATHS, type AccountServiceId } from '../_lib/nav';
import type { InProgressRow, ManagerView, NewCustomerView, ServiceTileView, VerificationView, WaitingRowView, WalletView } from '../_lib/types';

/**
 * ODS T6 · My account Home panels (Part 6.2; boards CustomerHome, M_CustomerHome, States-CustomerHome). Presentational
 * and server-safe: props only (the page's loaders or the fixtures' sample data). Every panel has its own loading
 * (`HomePanelSkeleton`) and error (`HomePanelError`) state, so one failing panel never blanks the page.
 * Tables: a real <table> from 768 px; on phones each row becomes a stacked card (What, "Service · Due", the button).
 */

const SERVICE_ICONS: Record<AccountServiceId, LucideIcon> = { sourcing: Box, turnkey: Layers, warehouse: Package, shipping: Truck, brand: Sparkles, dropship: Store };

export function HomePanel({
  title, icon, actions, children, id, testId, className,
}: { title: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; id: string; testId?: string; className?: string }) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} data-testid={testId} className={cx('min-w-0 scroll-mt-24 rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-ods-pad-card pt-ods-pad-card pb-3">
        <h2 id={`${id}-h`} className="m-0 flex items-center gap-2 text-ods-h2 font-bold text-ods-navy">
          {icon ? <Icon icon={icon} className="text-ods-blue" /> : null}
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

const TH = 'h-ods-head px-3 text-start text-ods-label font-semibold whitespace-nowrap text-ods-slate first:ps-ods-pad-card last:pe-ods-pad-card';
const TD = 'align-middle max-ods-tablet:p-0 ods-tablet:px-3 ods-tablet:py-2 ods-tablet:first:ps-ods-pad-card ods-tablet:last:pe-ods-pad-card';
const TR = 'border-t border-ods-line max-ods-tablet:flex max-ods-tablet:flex-col max-ods-tablet:gap-2 max-ods-tablet:px-ods-pad-card max-ods-tablet:py-4 ods-tablet:h-ods-row';

/** "What" text with the reference in bold (Quote for **RFQ-1042** · title). */
function What({ text, code }: { text: string; code: string | null }) {
  if (!code || !text.includes(code)) return <>{text}</>;
  const [a, ...rest] = text.split(code);
  return (
    <>
      {a}
      <strong className="font-semibold text-ods-navy">{code}</strong>
      {rest.join(code)}
    </>
  );
}

export function DueCell({ due }: { due: WaitingRowView['due'] }) {
  return due.urgent ? <StatusPill tone="warning">{due.text}</StatusPill> : <span className="text-ods-text">{due.text}</span>;
}

export function WaitingAction({ row, fullWidthOnPhone }: { row: WaitingRowView; fullWidthOnPhone?: boolean }) {
  const primary = row.type === 'pay' || row.type === 'review';
  return (
    <Link href={row.href} className={cx(buttonClass(primary ? 'primary' : 'secondary', 'sm'), 'whitespace-nowrap', fullWidthOnPhone && 'max-ods-tablet:self-start')} data-testid="waiting-action">
      {row.type === 'review' ? <Icon icon={Eye} /> : row.type === 'pay' ? <Icon icon={Wallet} /> : row.type === 'approve' ? <Icon icon={Check} /> : <Icon icon={Upload} />}
      {row.action}
    </Link>
  );
}

/** Waiting for you (n): What / Service / Due / Action, soonest first; at most `max` rows, then "See all" → Action needed. */
export function WaitingPanel({ rows, max = 5 }: { rows: WaitingRowView[]; max?: number }) {
  const shown = rows.slice(0, max);
  return (
    <HomePanel
      id="waiting"
      testId="waiting-table"
      icon={Clock}
      title={<>Waiting for you ({rows.length})</>}
      actions={
        rows.length > max ? (
          <Link href={ACCOUNT_PATHS.action} className={buttonClass('secondary', 'sm')}>
            See all ({rows.length})
          </Link>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div className="flex items-start gap-3 border-t border-ods-line px-ods-pad-card py-5 text-ods-body text-ods-text" data-testid="nothing-waiting">
          <Icon icon={Check} className="mt-0.5 text-ods-success" />
          <p className="m-0">You’re all caught up. New quotes, payments due and questions from our team will appear here.</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-ods-table max-ods-tablet:block">
          <caption className="sr-only">Things waiting for you, soonest first</caption>
          <thead className="max-ods-tablet:sr-only">
            <tr className="border-t border-ods-line bg-ods-canvas">
              <th scope="col" className={TH}>What</th>
              <th scope="col" className={TH}>Service</th>
              <th scope="col" className={TH}>Due</th>
              <th scope="col" className={TH}>Action</th>
            </tr>
          </thead>
          <tbody className="max-ods-tablet:block">
            {shown.map((r) => (
              <tr key={r.id} className={TR} data-testid="waiting-row" data-type={r.type}>
                <td className={cx(TD, 'text-ods-text')}>
                  <span className="max-ods-tablet:font-semibold max-ods-tablet:text-ods-navy">
                    <What text={r.what} code={r.ref} />
                  </span>
                  <span className="mt-0.5 block text-ods-small text-ods-slate ods-tablet:hidden">
                    {r.service} · {r.due.text}
                  </span>
                </td>
                <td className={cx(TD, 'whitespace-nowrap text-ods-text max-ods-tablet:hidden')}>{r.service}</td>
                <td className={cx(TD, 'whitespace-nowrap max-ods-tablet:hidden')}>
                  <DueCell due={r.due} />
                </td>
                <td className={cx(TD, 'ods-tablet:w-0')}>
                  <WaitingAction row={r} fullWidthOnPhone />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </HomePanel>
  );
}

/** Wallet: available, held, invoices due (today's amounts payable now); Add funds, Invoices. */
export function WalletCard({ wallet }: { wallet: WalletView }) {
  const line = (label: string, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-ods-slate">{label}</dt>
      <dd className="m-0 font-semibold text-ods-navy">{value}</dd>
    </div>
  );
  return (
    <HomePanel id="wallet" testId="wallet-card" icon={Wallet} title="Wallet">
      <div className="px-ods-pad-card pb-ods-pad-card">
        <dl className="m-0 text-ods-body">
          {line('Available', <Money amount={wallet.available} />)}
          {line('Held', <Money amount={wallet.held} />)}
          {line('Invoices due', wallet.invoicesDue === null ? <span className="font-normal text-ods-slate">Not available right now</span> : <Money amount={wallet.invoicesDue} />)}
          {wallet.pendingTransfers > 0 ? line('Transfer being checked', <Money amount={wallet.pendingTransfers} />) : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`${ACCOUNT_PATHS.wallet}#add-funds`} className={buttonClass('primary')}>
            <Icon icon={Plus} />
            Add funds
          </Link>
          <Link href={ACCOUNT_PATHS.invoices} className={buttonClass('secondary')}>
            Invoices
          </Link>
        </div>
      </div>
    </HomePanel>
  );
}

/** Browse products: Open the shop ↗ (Shop tab; same tab on phones). */
export function BrowseCard() {
  return (
    <HomePanel id="browse" testId="browse-card" icon={ShoppingBag} title="Browse products">
      <div className="px-ods-pad-card pb-ods-pad-card">
        <p className="m-0 text-ods-body text-ods-text">
          All our products, MOQ pools, turnkey projects and dropshipping products are in the shop. It opens in its own tab, so this page stays open.
        </p>
        <NamedTabLink tab="shop" href={ACCOUNT_PATHS.shop} className={cx(buttonClass('primary'), 'mt-4')} data-testid="open-shop">
          Open the shop
          <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
          <span className="sr-only"> (opens the Shop tab)</span>
        </NamedTabLink>
      </div>
    </HomePanel>
  );
}

const TILE_STATUS: Record<ServiceTileView['status'], string> = { on: 'On', paused: 'Paused', 'not-started': 'Not started', soon: 'Opening soon' };

/** Your services: six tiles (Sourcing, Turnkey, Warehouse, Shipping, Make My Brand, Dropshipping); not started = "Start". */
export function ServicesTiles({ tiles }: { tiles: ServiceTileView[] }) {
  return (
    <HomePanel id="services" testId="services-tiles" title="Your services">
      <ul className="m-0 grid list-none gap-3 px-ods-pad-card pb-ods-pad-card ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
        {tiles.map((t) => {
          const idle = t.status === 'not-started' || t.status === 'soon';
          return (
            <li key={t.id} data-testid="service-tile" data-service={t.id} data-status={t.status}>
              <Link
                href={t.href}
                className="flex h-full min-h-[76px] items-center gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 no-underline transition-colors duration-(--ods-motion-fast) hover:border-ods-blue hover:bg-ods-canvas"
              >
                <span aria-hidden className="inline-grid size-10 shrink-0 place-items-center rounded-ods-control bg-ods-blue-tint text-ods-blue">
                  <Icon icon={SERVICE_ICONS[t.id]} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ods-body font-semibold text-ods-navy">{t.name}</span>
                  <span className="block text-ods-small text-ods-slate">
                    <span className="sr-only">{TILE_STATUS[t.status]}. </span>
                    {t.summary}
                  </span>
                </span>
                {idle ? (
                  <span className="shrink-0 rounded-ods-pill border border-ods-blue px-2.5 text-ods-small leading-6 font-semibold text-ods-blue">{t.status === 'soon' ? 'Get notified' : 'Start'}</span>
                ) : t.status === 'paused' ? (
                  <StatusPill status="Paused" />
                ) : (
                  <Icon icon={ArrowRight} size="sm" className="shrink-0 text-ods-slate rtl:-scale-x-100" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </HomePanel>
  );
}

/** In progress: Reference / Service / Status (Appendix C) / Next step; See all orders. */
export function InProgressPanel({ rows }: { rows: InProgressRow[] }) {
  return (
    <HomePanel
      id="in-progress"
      testId="in-progress"
      icon={Clock}
      title="In progress"
      actions={
        <Link href={ACCOUNT_PATHS.orders} className={buttonClass('secondary', 'sm')}>
          <Icon icon={Eye} />
          See all orders
        </Link>
      }
    >
      {rows.length === 0 ? (
        <div className="border-t border-ods-line">
          <EmptyState headingLevel={3} title="Nothing in progress" description="Your requests and orders appear here once they start." />
        </div>
      ) : (
        <table className="w-full border-collapse text-ods-table max-ods-tablet:block">
          <caption className="sr-only">Requests and orders in progress</caption>
          <thead className="max-ods-tablet:sr-only">
            <tr className="border-t border-ods-line bg-ods-canvas">
              <th scope="col" className={TH}>Reference</th>
              <th scope="col" className={TH}>Service</th>
              <th scope="col" className={TH}>Status</th>
              <th scope="col" className={TH}>Next step</th>
            </tr>
          </thead>
          <tbody className="max-ods-tablet:block">
            {rows.map((r) => (
              <tr key={r.id} className={TR} data-testid="in-progress-row">
                <td className={TD}>
                  <Link href={r.href} className="font-semibold text-ods-blue underline-offset-4 hover:underline">
                    {r.ref}
                  </Link>
                  {r.title ? <span className="block max-w-[28ch] truncate text-ods-small text-ods-slate">{r.title}</span> : null}
                </td>
                <td className={cx(TD, 'text-ods-text max-ods-tablet:hidden')}>{r.service}</td>
                <td className={TD}>
                  <StatusPill status={r.status} />
                </td>
                <td className={cx(TD, 'text-ods-text')}>
                  <span className="text-ods-slate ods-tablet:hidden">Next: </span>
                  {r.nextStep}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </HomePanel>
  );
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Your account manager: name from staff data ("[Account manager name]" until set); reply time only from settings. */
export function ManagerCard({ manager }: { manager: ManagerView }) {
  return (
    <HomePanel id="manager" testId="account-manager" title="Your account manager">
      <div className="px-ods-pad-card pb-ods-pad-card">
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-grid size-12 shrink-0 place-items-center rounded-ods-pill bg-ods-blue-tint text-ods-body font-bold text-ods-navy">
            {manager.name ? initialsOf(manager.name) : '[AM]'}
          </span>
          <div className="min-w-0">
            <p className="m-0 text-ods-body font-semibold text-ods-navy" data-testid="manager-name">
              {manager.name ?? '[Account manager name]'}
            </p>
            {manager.title ? <p className="m-0 text-ods-small text-ods-slate">{manager.title}</p> : null}
            {manager.replyTime ? <p className="m-0 text-ods-small text-ods-slate">Replies {manager.replyTime}</p> : null}
          </div>
        </div>
        {!manager.name ? <p className="m-0 mt-3 text-ods-small text-ods-slate">We are assigning your account manager. Until then, our support team answers your messages.</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={ACCOUNT_PATHS.newTicket} className={buttonClass('secondary')}>
            Message
          </Link>
          <Link href={ACCOUNT_PATHS.support} className={buttonClass('secondary')}>
            <Icon icon={ArrowRight} className="rtl:-scale-x-100" />
            Open a ticket
          </Link>
        </div>
      </div>
    </HomePanel>
  );
}

/** Brand-new customer (States-CustomerHome): a 3-step start instead of empty service cards. */
export function NewCustomerStart({ view }: { view: NewCustomerView }) {
  const kycDone = view.kyc === 'verified';
  const steps: { title: string; hint: string; state: 'done' | 'now' | 'next' }[] = [
    { title: 'Create your account', hint: 'Done', state: 'done' },
    { title: 'Add your company details', hint: view.companyDone ? 'Done' : 'About 2 minutes', state: view.companyDone ? 'done' : 'now' },
    {
      title: 'Verify your company (KYC)',
      hint: kycDone ? 'Done' : view.kyc === 'pending' ? 'We are checking your documents' : 'Needed before payments and orders',
      state: kycDone ? 'done' : view.companyDone ? 'now' : 'next',
    },
  ];
  const cta = !view.companyDone
    ? { href: ACCOUNT_PATHS.companyDetails, label: 'Add company details' }
    : !kycDone && view.kyc !== 'pending'
      ? { href: ACCOUNT_PATHS.verification, label: 'Verify your company' }
      : { href: ACCOUNT_PATHS.newRequest, label: 'Send your first request' };
  return (
    <HomePanel id="start" testId="new-customer-start" title="Welcome to Octopus B2B">
      <div className="px-ods-pad-card pb-ods-pad-card">
        <p className="m-0 text-ods-body text-ods-slate">Three steps and you can start any service.</p>
        <ol className="m-0 mt-4 grid list-none gap-3 p-0">
          {steps.map((s) => (
            <li key={s.title} className="flex items-start gap-3" aria-current={s.state === 'now' ? 'step' : undefined}>
              <span
                aria-hidden
                className={cx(
                  'mt-1 inline-block size-3 shrink-0 rounded-full',
                  s.state === 'done' ? 'bg-ods-teal' : s.state === 'now' ? 'bg-ods-blue ring-4 ring-ods-blue-tint' : 'border-2 border-ods-line-strong',
                )}
              />
              <span>
                <span className={cx('block font-semibold', s.state === 'next' ? 'text-ods-slate' : 'text-ods-navy')}>
                  {s.title}
                  {s.state === 'done' ? <span className="sr-only"> (done)</span> : s.state === 'now' ? <span className="sr-only"> (next step)</span> : null}
                </span>
                <span className="block text-ods-small text-ods-slate">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <Link href={cta.href} className={cx(buttonClass('primary'), 'mt-5')}>
          <Icon icon={Plus} />
          {cta.label}
        </Link>
      </div>
    </HomePanel>
  );
}

/** Verification banner: nothing when verified; info while in review; warning when not verified or more information is needed. */
export function VerificationBanner({ view }: { view: VerificationView }) {
  if (view.state === 'verified') return null;
  const pending = view.state === 'pending';
  const more = view.state === 'more_info';
  return (
    <div
      role="status"
      data-testid="verification-banner"
      data-state={view.state}
      className={cx(
        'flex flex-wrap items-center justify-between gap-4 rounded-ods-card border p-4',
        pending ? 'border-ods-info/30 bg-ods-info-tint' : 'border-ods-warning/40 bg-ods-warning-tint',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold text-ods-navy">
          {pending ? 'We’re checking your company documents.' : more ? 'We need more information to verify your company.' : 'Verify your company to pay and place orders.'}
        </p>
        <p className="m-0 mt-0.5 text-ods-small text-ods-text">
          {pending
            ? 'You can already send sourcing requests; payments open after verification.'
            : more
              ? (view.message ?? 'Please contact your account manager.')
              : 'You can already send sourcing requests. Verification is needed before payments and orders.'}
        </p>
      </div>
      {pending ? null : (
        <Link href={ACCOUNT_PATHS.verification} className={buttonClass('primary')}>
          {more ? <Icon icon={Upload} /> : <Icon icon={CircleCheck} />}
          {more ? 'Upload document' : 'Verify your company'}
        </Link>
      )}
    </div>
  );
}

/** Loading state of one panel (same heading; skeleton body). */
export function HomePanelSkeleton({ title, id, testId, lines = 3 }: { title: string; id: string; testId?: string; lines?: number }) {
  return (
    <HomePanel id={id} testId={testId} title={title}>
      <div className="px-ods-pad-card pb-ods-pad-card" aria-busy="true">
        <Skeleton lines={lines} label={`Loading ${title.toLowerCase()}`} />
      </div>
    </HomePanel>
  );
}

/** Error state of one panel: what happened + Try again (reloads the page). The rest of the page still shows. */
export function HomePanelError({ title, id, testId, what, retryHref = ACCOUNT_PATHS.home }: { title: string; id: string; testId?: string; what: string; retryHref?: string }) {
  return (
    <HomePanel id={id} testId={testId} title={title}>
      <div className="px-ods-pad-card pb-ods-pad-card">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-ods-card border border-ods-danger/30 bg-ods-danger-tint p-4" data-testid="panel-error">
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold text-ods-navy">We couldn’t load {what}.</p>
            <p className="m-0 mt-0.5 text-ods-small text-ods-text">Other sections are fine. Try again in a moment.</p>
          </div>
          <a href={retryHref} className={buttonClass('secondary', 'sm')}>
            <Icon icon={RotateCw} />
            Try again
          </a>
        </div>
      </div>
    </HomePanel>
  );
}
