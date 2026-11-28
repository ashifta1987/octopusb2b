import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { AssistantFixture } from './_fixture';
import { ASSISTANT_FIXTURE_STATES, type AssistantFixtureState } from '../office-services/sample-data';

export const metadata: Metadata = { title: 'Assistant queue · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Staging-only fixture (T9 batch 2): /office/assistant. `?state=queue|mine|low|conversation|view-only|out-of-office|loading|empty|error`. */
export default function OfficeAssistantFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (ASSISTANT_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'queue') as AssistantFixtureState;
  return <AssistantFixture key={state} state={state} />;
}
