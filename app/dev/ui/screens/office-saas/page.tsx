import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { SaasFixture } from '../office-holds/_fixtures';
import { sampleSaas } from '../office-holds/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-holds/_shared';

export const metadata: Metadata = { title: 'SaaS billing · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-saas';
const STATES = ['list', 'second-approver', 'merchants', 'drawer', 'plans', 'history', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 3): Accounts › SaaS billing, SAMPLE data. ?state=list|second-approver|merchants|drawer|plans|history|error|loading|no-permission&role= */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = pickRole(sp.role, 'finance');
  const state = STATES.find((s) => s === one(sp.state)) ?? 'list';
  const data = sampleSaas(state);
  return (
    <SaasFixture
      role={role}
      links={fixtureLinks(BASE, STATES, state, role)}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : state === 'error' ? 'error' : 'ok',
        data: state === 'error' || state === 'loading' ? null : { ...data, can_decide: role !== 'sales' },
        error: state === 'error' ? 'SAAS_PAGE_FAILED (sample)' : null,
        initialTab: state === 'merchants' || state === 'drawer' ? 'merchants' : state === 'plans' ? 'plans' : state === 'history' ? 'history' : 'overview',
        initialOverride: state === 'drawer' ? data.merchants[1].org_id : null,
      }}
    />
  );
}
