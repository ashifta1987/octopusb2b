import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { TransfersFixture } from '../office-holds/_fixtures';
import { PENDING_TRANSFERS, DECIDED_TRANSFERS, SAMPLE_LIMIT } from '../office-holds/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-holds/_shared';

export const metadata: Metadata = { title: 'Bank transfers · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-transfers';
const STATES = ['list', 'drawer', 'second-approver', 'proforma', 'decided', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 3): Accounts › Bank transfers, SAMPLE data. ?state=list|drawer|second-approver|proforma|decided|empty|error|loading|no-permission&role= */
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
    <TransfersFixture
      role={role}
      links={fixtureLinks(BASE, STATES, state, role)}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        pending: state === 'error' ? null : state === 'empty' ? [] : PENDING_TRANSFERS,
        decided: state === 'error' ? null : state === 'empty' ? [] : DECIDED_TRANSFERS,
        canRecordProforma: role !== 'sales',
        approvalLimitMinor: SAMPLE_LIMIT,
        initialOpen: state === 'drawer' || state === 'second-approver' ? PENDING_TRANSFERS[0].id : null,
        initialTab: state === 'decided' ? 'decided' : 'pending',
        initialProforma: state === 'proforma',
        initialOutcome: state === 'second-approver' ? { kind: 'second-approver', code: 'APR-00041', message: 'Second approver needed (APR-00041).' } : null,
      }}
    />
  );
}
