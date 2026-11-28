import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { CreditFixture } from '../office-holds/_fixtures';
import { ME, CREDIT, ORGS, DIVISIONS, STATEMENTS } from '../office-holds/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-holds/_shared';

export const metadata: Metadata = { title: 'Credit terms · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-credit';
const STATES = ['list', 'drawer', 'second-approver', 'propose', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 3): Accounts › Credit terms, SAMPLE data. ?state=list|drawer|second-approver|propose|empty|error|loading|no-permission&role= */
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
    <CreditFixture
      role={role}
      links={fixtureLinks(BASE, STATES, state, role)}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        rows: state === 'error' ? null : state === 'empty' ? [] : CREDIT,
        statements: state === 'empty' ? [] : STATEMENTS,
        orgs: ORGS,
        divisions: DIVISIONS,
        meId: ME,
        initialOpen: state === 'drawer' ? CREDIT[1].id : state === 'second-approver' ? CREDIT[2].id : null,
        initialPropose: state === 'propose',
      }}
    />
  );
}
