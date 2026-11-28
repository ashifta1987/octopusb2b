import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getAccountFrameData, loadInProgress, loadManager, loadServices, loadVerification, loadWaiting, loadWallet, requireAccount, settle } from './_lib/loaders';
import { companyStatusName, firstName, kycState } from './_lib/status';
import { CustomerHomeLayout, GreetingSkeleton } from './_components/customer-home';
import { Greeting } from './_components/greeting';
import {
  BrowseCard, HomePanelError, HomePanelSkeleton, InProgressPanel, ManagerCard, NewCustomerStart, ServicesTiles, VerificationBanner, WaitingPanel, WalletCard,
} from './_components/home-panels';

/**
 * ODS T6 · /account Home (Part 6.2). Each panel loads and fails on its own (<Suspense> + settle() → HomePanelError).
 * Data (all today's sources, under RLS): greeting = session (profiles.full_name, organizations.name/kyc_status);
 * Waiting for you = listWaiting (lib/core/waiting); Wallet = my_wallet_summary + today's dueNow() over orders waiting for
 * payment; Your services = company_services + rfqs/tk_client_projects/orders head counts + dropship_v2_ui; In progress =
 * active orders + open rfqs (code, title, status); account manager = my_account_team() + site_reply_time.
 */
export const metadata: Metadata = { title: 'My account' };

export default function AccountHomePage() {
  return (
    <CustomerHomeLayout
      greeting={
        <Suspense fallback={<GreetingSkeleton />}>
          <HomeGreeting />
        </Suspense>
      }
      banner={
        <Suspense fallback={null}>
          <HomeVerification />
        </Suspense>
      }
      waiting={
        <Suspense fallback={<HomePanelSkeleton id="waiting" testId="waiting-table" title="Waiting for you" />}>
          <HomeWaiting />
        </Suspense>
      }
      wallet={
        <Suspense fallback={<HomePanelSkeleton id="wallet" testId="wallet-card" title="Wallet" />}>
          <HomeWallet />
        </Suspense>
      }
      browse={<BrowseCard />}
      services={
        <Suspense fallback={<HomePanelSkeleton id="services" testId="services-tiles" title="Your services" lines={4} />}>
          <HomeServices />
        </Suspense>
      }
      inProgress={
        <Suspense fallback={<HomePanelSkeleton id="in-progress" testId="in-progress" title="In progress" lines={4} />}>
          <HomeInProgress />
        </Suspense>
      }
      manager={
        <Suspense fallback={<HomePanelSkeleton id="manager" testId="account-manager" title="Your account manager" />}>
          <HomeManager />
        </Suspense>
      }
    />
  );
}

async function HomeGreeting() {
  const s = await requireAccount('/account');
  const f = await getAccountFrameData();
  return <Greeting firstName={firstName(s.profile?.full_name)} company={f.company.name} companyStatus={companyStatusName(kycState(s.org?.kyc_status))} />;
}

async function HomeVerification() {
  const r = await settle(loadVerification);
  return r.ok ? <VerificationBanner view={r.data} /> : null;
}

async function HomeWaiting() {
  const r = await settle(() => loadWaiting(50));
  return r.ok ? <WaitingPanel rows={r.data.rows} /> : <HomePanelError id="waiting" testId="waiting-table" title="Waiting for you" what="the things waiting for you" />;
}

async function HomeWallet() {
  const r = await settle(loadWallet);
  return r.ok ? <WalletCard wallet={r.data} /> : <HomePanelError id="wallet" testId="wallet-card" title="Wallet" what="your wallet" />;
}

async function HomeServices() {
  const r = await settle(loadServices);
  if (!r.ok) return <HomePanelError id="services" testId="services-tiles" title="Your services" what="your services" />;
  return r.data.newCustomer ? <NewCustomerStart view={r.data.newCustomer} /> : <ServicesTiles tiles={r.data.tiles} />;
}

async function HomeInProgress() {
  const r = await settle(() => loadInProgress(6));
  return r.ok ? <InProgressPanel rows={r.data} /> : <HomePanelError id="in-progress" testId="in-progress" title="In progress" what="your requests and orders" />;
}

async function HomeManager() {
  const r = await settle(loadManager);
  return r.ok ? <ManagerCard manager={r.data} /> : <HomePanelError id="manager" testId="account-manager" title="Your account manager" what="your account manager" />;
}
