import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { AccountFixtureFrame, FixtureStates } from './_fixture-frame';
import { SAMPLE_FRAME } from './sample-data';

export const metadata: Metadata = { title: 'My account frame · ODS screens (staging)', robots: { index: false, follow: false } };

const VIEWS = [
  ['expanded', 'Sidebar expanded'],
  ['collapsed', 'Sidebar collapsed'],
  ['more', 'Phone More sheet'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Staging-only fixture: the My account frame alone (Part 6.1) with SAMPLE props. `?view=expanded | collapsed | more`
 * (more = the phone BottomNav "More" sheet open; view it at 390 px). Current item: Home.
 */
export default function AccountFrameFixture({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view = (VIEWS.find(([v]) => v === raw)?.[0] ?? 'expanded') as (typeof VIEWS)[number][0];
  return (
    <AccountFixtureFrame data={SAMPLE_FRAME} path="/account" collapsed={view === 'collapsed' ? true : view === 'expanded' ? false : undefined} moreOpen={view === 'more'}>
      <FixtureStates base="/dev/ui/screens/account-frame" states={VIEWS} current={view} param="view" />
      <div className="mx-auto w-full max-w-ods-content p-ods-pad-page">
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">My account frame</h1>
        <p className="m-0 mt-2 max-w-[60ch] text-ods-body text-ods-slate">
          Sidebar (navy, 248 px; 72 px icons under 1200 px, remembered), topbar with search, New request, the shop icon, notifications, help and the user
          menu; on phones the navy header and the bottom bar with the More sheet. Page content goes here.
        </p>
      </div>
    </AccountFixtureFrame>
  );
}
