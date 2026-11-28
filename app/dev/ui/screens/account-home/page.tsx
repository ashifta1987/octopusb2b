import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { CustomerHomeLayout, GreetingSkeleton } from '@/app/ods/account/_components/customer-home';
import { Greeting } from '@/app/ods/account/_components/greeting';
import {
  BrowseCard, HomePanelError, HomePanelSkeleton, InProgressPanel, ManagerCard, NewCustomerStart, ServicesTiles, VerificationBanner, WaitingPanel, WalletCard,
} from '@/app/ods/account/_components/home-panels';
import type { VerificationView } from '@/app/ods/account/_lib/types';
import { AccountFixtureFrame, FixtureStates } from '../account-frame/_fixture-frame';
import { SAMPLE_FRAME, SAMPLE_FRAME_NEW, SAMPLE_IN_PROGRESS, SAMPLE_MANAGER, SAMPLE_MANAGER_UNSET, SAMPLE_TILES, SAMPLE_WAITING, SAMPLE_WALLET } from '../account-frame/sample-data';

export const metadata: Metadata = { title: 'My account home · ODS screens (staging)', robots: { index: false, follow: false } };

const STATES = [
  ['normal', 'Normal'],
  ['new', 'Brand-new customer'],
  ['unverified', 'Not verified'],
  ['pending', 'Verification in review'],
  ['more-info', 'More information needed'],
  ['nothing-waiting', 'Nothing waiting'],
  ['loading', 'Loading'],
  ['error', 'A panel failed'],
] as const;
type State = (typeof STATES)[number][0];
type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/account-home';

/**
 * Staging-only fixture: My account frame + /account Home (Part 6.2) with SAMPLE props (Part 6.7 example data), rendered
 * by the same presentational components as the real page. `?state=` normal | new | unverified | pending | more-info |
 * nothing-waiting | loading | error (error = Waiting for you and Your services failed; the rest still shows).
 */
export default function AccountHomeFixture({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = (STATES.find(([s]) => s === raw)?.[0] ?? 'normal') as State;
  const isNew = state === 'new';
  const loading = state === 'loading';
  const failed = state === 'error';
  const verification: VerificationView =
    state === 'unverified' || isNew
      ? { state: 'not_verified', message: null }
      : state === 'pending'
        ? { state: 'pending', message: null }
        : state === 'more-info'
          ? { state: 'more_info', message: 'Upload a clearer copy of your business licence.' }
          : { state: 'verified', message: null };
  const companyStatus = verification.state === 'verified' ? 'Verified' : verification.state === 'pending' ? 'Verification pending' : 'Not verified';
  const waiting = isNew || state === 'nothing-waiting' ? [] : SAMPLE_WAITING.slice(0, 3);

  return (
    <AccountFixtureFrame data={isNew ? SAMPLE_FRAME_NEW : SAMPLE_FRAME} path="/account">
      <FixtureStates base={BASE} states={STATES} current={state} />
      <CustomerHomeLayout
        greeting={
          loading ? (
            <>
              <h1 className="sr-only">My account home</h1>
              <GreetingSkeleton />
            </>
          ) : (
            <Greeting firstName="Anna" company="Anna Home Trading" companyStatus={companyStatus} />
          )
        }
        banner={loading ? null : <VerificationBanner view={verification} />}
        waiting={
          loading ? (
            <HomePanelSkeleton id="waiting" testId="waiting-table" title="Waiting for you" />
          ) : failed ? (
            <HomePanelError id="waiting" testId="waiting-table" title="Waiting for you" what="the things waiting for you" retryHref={`${BASE}?state=error`} />
          ) : (
            <WaitingPanel rows={waiting} />
          )
        }
        wallet={loading ? <HomePanelSkeleton id="wallet" testId="wallet-card" title="Wallet" /> : <WalletCard wallet={isNew ? { available: 0, held: 0, invoicesDue: 0, pendingTransfers: 0 } : SAMPLE_WALLET} />}
        browse={<BrowseCard />}
        services={
          loading ? (
            <HomePanelSkeleton id="services" testId="services-tiles" title="Your services" lines={4} />
          ) : failed ? (
            <HomePanelError id="services" testId="services-tiles" title="Your services" what="your services" retryHref={`${BASE}?state=error`} />
          ) : isNew ? (
            <NewCustomerStart view={{ companyDone: true, kyc: 'not_verified' }} />
          ) : (
            <ServicesTiles tiles={SAMPLE_TILES} />
          )
        }
        inProgress={loading ? <HomePanelSkeleton id="in-progress" testId="in-progress" title="In progress" lines={4} /> : <InProgressPanel rows={isNew ? [] : SAMPLE_IN_PROGRESS} />}
        manager={loading ? <HomePanelSkeleton id="manager" testId="account-manager" title="Your account manager" /> : <ManagerCard manager={isNew ? SAMPLE_MANAGER_UNSET : SAMPLE_MANAGER} />}
      />
    </AccountFixtureFrame>
  );
}
