import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { ActionNeededView, parseActionType } from '@/app/ods/account/_components/action-view';
import { AccountFixtureFrame, FixtureStates } from '../account-frame/_fixture-frame';
import { SAMPLE_FRAME, SAMPLE_WAITING } from '../account-frame/sample-data';

export const metadata: Metadata = { title: 'Action needed · ODS screens (staging)', robots: { index: false, follow: false } };

const STATES = [
  ['normal', 'Normal'],
  ['empty', 'Nothing waiting'],
  ['loading', 'Loading'],
  ['error', 'Could not load'],
] as const;
type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/account-action';

/**
 * Staging-only fixture: My account frame + /account/action (Part 6.3) with SAMPLE items. `?type=` pay | approve |
 * review | reply (the pills set it), `?state=` normal | empty | loading | error.
 */
export default function AccountActionFixture({ searchParams }: { searchParams: SP }) {
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
  const state = STATES.find(([s]) => s === raw)?.[0] ?? 'normal';
  const type = parseActionType(sp.type);
  const base = state === 'normal' ? BASE : `${BASE}?state=${state}`;
  return (
    <AccountFixtureFrame data={SAMPLE_FRAME} path="/account/action">
      <FixtureStates base={BASE} states={STATES} current={state} />
      <ActionNeededView
        rows={state === 'empty' ? [] : SAMPLE_WAITING}
        type={type}
        basePath={base}
        state={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'}
      />
    </AccountFixtureFrame>
  );
}
