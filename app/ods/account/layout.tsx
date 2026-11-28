import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { AuthBroadcastListener } from '@octopus/ui';
import { getAccountFrameData } from './_lib/loaders';
import { AccountBottomBar, AccountSidebarNav, AccountTop } from './_components/account-frame';
import { AccountFrameShell, AccountSidebarSkeleton, AccountTopbarSkeleton } from './_components/frame-shell';

/**
 * ODS T6 · My account frame (Part 6.1) for every /account/* page that has an ODS version (proxy rewrites them here when
 * the ODS theme is on for area "account"; see lib/ods-routes.ts). Same guard as today's app/account/layout.tsx:
 * requireCustomer() — signed out → /login?next, staff → /admin?notice=staff-not-customer, no company → onboarding —
 * inside getAccountFrameData() (React-cached; every slot calls it). Session data streams inside <Suspense> with
 * same-size skeletons, so `children` (each page has its own Suspense) never wait for the frame.
 * AuthBroadcastListener mode="overlay" (Part 4.6): a sign-out in another tab shows "You signed out" here.
 * Hidden from search engines like today's account pages.
 */
export const metadata: Metadata = {
  title: { default: 'My account', template: '%s · Octopus B2B' },
  robots: { index: false, follow: false, nocache: true },
};

export default function OdsAccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AccountFrameShell
        sidebar={
          <Suspense fallback={<AccountSidebarSkeleton />}>
            <FrameSidebar />
          </Suspense>
        }
        topbar={
          <Suspense fallback={<AccountTopbarSkeleton />}>
            <FrameTop />
          </Suspense>
        }
        bottomNav={
          <Suspense fallback={null}>
            <FrameBottomNav />
          </Suspense>
        }
      >
        {children}
      </AccountFrameShell>
      <AuthBroadcastListener mode="overlay" />
    </>
  );
}

async function FrameSidebar() {
  return <AccountSidebarNav data={await getAccountFrameData()} />;
}

async function FrameTop() {
  return <AccountTop data={await getAccountFrameData()} />;
}

async function FrameBottomNav() {
  return <AccountBottomBar data={await getAccountFrameData()} />;
}
