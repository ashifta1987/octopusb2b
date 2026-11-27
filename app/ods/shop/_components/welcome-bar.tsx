import { ArrowUpRight, CircleCheck, CreditCard, FileText, Landmark, ShieldAlert, type LucideIcon } from 'lucide-react';
import { formatMoney, Icon, NamedTabLink, Skeleton } from '@octopus/ui';
import type { WaitingItem, WaitingKind } from '@/lib/core/waiting-items';
import { SHOP_PATHS } from '../_lib/sections';
import { Greeting } from './greeting';

const KIND_ICON: Record<WaitingKind, LucideIcon> = { quote: FileText, payment: CreditCard, transfer: Landmark, verification: ShieldAlert };

export type WelcomeBarProps = {
  firstName: string | null;
  orgName: string;
  /** US$ available; null = no wallet summary. */
  walletAvailable: number | null;
  /** Up to 3 items from the "Waiting for you" list (most urgent first); [] = all set; null = couldn't load; 'loading'. */
  tiles: WaitingItem[] | null | 'loading';
  /** Pins the greeting hour (fixtures). */
  fixedHour?: number;
};

/**
 * ODS T4 · Welcome bar on /shop (Part 5.2 §1, Shop_Main): navy gradient card with the greeting (the page H1, by local
 * time), "Company · Wallet US$ … available", Open My account ↗ (teal, account tab), and up to 3 waiting tiles from the same
 * list as My account › Action needed (each opens My account in its tab). Nothing waiting → "You're all set".
 * Phones: the button goes under the text and the tiles stack.
 */
export function WelcomeBar({ firstName, orgName, walletAvailable, tiles, fixedHour }: WelcomeBarProps) {
  return (
    <section aria-labelledby="welcome-heading" data-testid="welcome-bar" className="rounded-ods-card bg-linear-to-br from-ods-navy to-ods-navy-hover p-ods-pad-card text-white shadow-ods-card">
      <div className="flex flex-col gap-4 ods-tablet:flex-row ods-tablet:items-start ods-tablet:justify-between">
        <div className="min-w-0">
          <h1 id="welcome-heading" className="m-0 text-ods-h1 font-bold text-white">
            <Greeting name={firstName} fixedHour={fixedHour} />
          </h1>
          <p className="m-0 mt-1 text-ods-body text-white/85">
            {orgName}
            {' · '}
            {walletAvailable != null ? (
              <>
                Wallet <span className="font-semibold text-white tabular-nums">{formatMoney(walletAvailable)}</span> available
              </>
            ) : (
              'Wallet: see My account'
            )}
          </p>
        </div>
        <NamedTabLink
          href={SHOP_PATHS.account}
          tab="account"
          data-testid="welcome-account-link"
          className="inline-flex h-ods-control shrink-0 items-center gap-1.5 self-start rounded-ods-control bg-ods-teal px-4 font-semibold whitespace-nowrap text-ods-navy hover:brightness-95"
        >
          Open My account
          <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
          <span className="sr-only">(opens the My account tab)</span>
        </NamedTabLink>
      </div>
      <div className="mt-4">
        {tiles === 'loading' ? (
          <div className="grid gap-3 ods-tablet:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-ods-control bg-white/10 p-3">
                <Skeleton silent className="h-4 w-3/5 opacity-40" />
                <Skeleton silent className="mt-2 h-3 w-4/5 opacity-30" />
              </div>
            ))}
            <span role="status" className="sr-only">
              Loading what is waiting for you
            </span>
          </div>
        ) : tiles === null ? (
          <p className="m-0 text-ods-small text-white/85" data-testid="waiting-unavailable">
            We couldn’t load what is waiting for you right now. Open My account to see it.
          </p>
        ) : tiles.length === 0 ? (
          <p className="m-0 inline-flex items-center gap-2 text-ods-body font-semibold text-white" data-testid="all-set">
            <Icon icon={CircleCheck} className="text-ods-teal" />
            You’re all set. Nothing is waiting for you.
          </p>
        ) : (
          <>
            <h2 className="sr-only">Waiting for you</h2>
            <ul className="m-0 grid list-none gap-3 p-0 ods-tablet:grid-cols-3">
              {tiles.slice(0, 3).map((t) => (
                <li key={t.key} className="min-w-0">
                  <NamedTabLink
                    href={t.href}
                    tab="account"
                    data-testid="waiting-tile"
                    data-kind={t.kind}
                    className="flex h-full min-h-ods-control items-start gap-3 rounded-ods-control bg-white p-3 text-ods-text no-underline hover:bg-ods-blue-tint"
                  >
                    <span aria-hidden className="inline-grid size-9 shrink-0 place-items-center rounded-ods-control bg-ods-warning-tint text-ods-warning">
                      <Icon icon={KIND_ICON[t.kind]} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-ods-table font-semibold text-ods-navy">{t.title}</span>
                      <span className="block truncate text-ods-small text-ods-slate">{t.body}</span>
                      <span className="sr-only"> (opens the My account tab)</span>
                    </span>
                  </NamedTabLink>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
