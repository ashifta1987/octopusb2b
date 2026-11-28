import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { AccountFixtureFrame, FixtureStates } from '../account-frame/_fixture-frame';
import { SAMPLE_FRAME } from '../account-frame/sample-data';

/**
 * Staging-only frame for the My account commerce fixtures (requests, orders, wallet, invoices): the real frame pieces
 * with SAMPLE props + a state switcher (`?state=`). One H1 per page comes from the page view itself.
 */
export function CommerceFixture({ path, base, states, current, children }: { path: string; base: string; states: readonly (readonly [string, string])[]; current: string; children: ReactNode }) {
  if (!isStaging()) notFound();
  return (
    <AccountFixtureFrame data={SAMPLE_FRAME} path={path}>
      <FixtureStates base={base} states={states} current={current} />
      <div data-testid={`fixture-${current}`}>{children}</div>
    </AccountFixtureFrame>
  );
}

export const pick = <T extends string>(v: string | string[] | undefined, states: readonly (readonly [T, string])[]): T => {
  const s = (Array.isArray(v) ? v[0] : v) ?? '';
  return (states.find(([id]) => id === s)?.[0] ?? states[0][0]) as T;
};
