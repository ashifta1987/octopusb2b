import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { HoldsFixture } from './_fixtures';
import { ME, HOLDS, HOLD_APPROVALS, HOLD_APPROVALS_SELF } from './sample-data';
import { fixtureLinks, one, pickRole, type SP } from './_shared';

export const metadata: Metadata = { title: 'Held payments · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-holds';
const STATES = ['list', 'drawer', 'second-approver', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 3): Accounts › Held payments, SAMPLE data. ?state=list|drawer|second-approver|empty|error|loading|no-permission&role=finance|admin|sales */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = pickRole(sp.role, 'finance');
  const state = STATES.find((s) => s === one(sp.state)) ?? 'list';
  return (
    <HoldsFixture
      role={role}
      links={fixtureLinks(BASE, STATES, state, role)}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        rows: state === 'error' ? null : state === 'empty' ? [] : HOLDS,
        approvals: state === 'second-approver' ? [...HOLD_APPROVALS_SELF, ...HOLD_APPROVALS] : state === 'empty' || state === 'error' ? [] : HOLD_APPROVALS,
        meId: ME,
        thresholdCents: 100_000,
        initialOpen: state === 'drawer' ? HOLDS[0].id : null,
        initialMsg: state === 'second-approver' ? { ok: true, text: 'Above the US$ 1,000.00 threshold — queued for a second Finance approver.' } : null,
      }}
    />
  );
}
