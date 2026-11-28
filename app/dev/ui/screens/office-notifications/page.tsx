import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { NotificationsFixture, StateNav } from '../_website-fixture';
import { SAMPLE_NOTES } from '../_website-sample';

export const metadata: Metadata = { title: 'Notifications · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | undefined>>;
const BASE = '/dev/ui/screens/office-notifications';
const STATES = [['list', 'List'], ['all-read', 'All read'], ['empty', 'Empty'], ['division', 'One division chosen'], ['loading', 'Loading']] as const;

/** Staging-only fixture (T9): the staff inbox with SAMPLE notifications. ?state=list|all-read|empty|division|loading. */
export default function Page({ searchParams }: { searchParams: SP }) {
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
  await connection();
  const state = STATES.find(([s]) => s === sp.state)?.[0] ?? 'list';
  const rows = state === 'loading' ? null : state === 'empty' ? [] : state === 'all-read' ? SAMPLE_NOTES.map((n) => ({ ...n, read_at: n.read_at ?? '2026-11-27T10:00:00Z' })) : SAMPLE_NOTES;
  return <NotificationsFixture nav={<StateNav base={BASE} state={state} states={STATES} />} screen={{ rows, loading: state === 'loading', divisionName: state === 'division' ? 'Product Sourcing' : null }} />;
}
