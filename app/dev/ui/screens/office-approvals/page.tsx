import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ApprovalsFixture } from './_fixture';
import { APPROVAL_FIXTURE_STATES, type ApprovalFixtureState } from '../office-dashboard/sample-data';

export const metadata: Metadata = { title: 'Back Office approvals · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Staging-only fixture (T9): /office/approvals (Part 7.7 / 7.8) with SAMPLE approvals and a sample decide.
 * `?state=waiting|decided|self|no-second-approver|step-up|deep-link|unavailable|no-finance|error`. Phone layout
 * (cards, 44 px Approve / Reject) at widths under 768 px.
 */
export default function OfficeApprovalsFixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = (APPROVAL_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'waiting') as ApprovalFixtureState;
  return <ApprovalsFixture state={state} />;
}
