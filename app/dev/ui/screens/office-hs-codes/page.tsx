import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { HsFixture } from '../office-products/_fixtures';
import { HS_TYPES, HS_PROPOSALS } from '../office-products/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-products/_shared';

export const metadata: Metadata = { title: 'HS codes · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-hs-codes';
const STATES = ['list', 'change', 'no-preview', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 5, Catalogue): HS codes, SAMPLE data. ?state=list|change|no-preview|error|loading|no-permission&role=finance|admin|sales */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = pickRole(sp.role, 'admin');
  const state = STATES.find((s) => s === one(sp.state)) ?? 'list';
  const links = fixtureLinks(BASE, STATES, state, role);
  return (
    <HsFixture
      role={role}
      links={links}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        types: state === 'error' ? null : HS_TYPES,
        proposals: state === 'no-preview' || state === 'error' ? [] : HS_PROPOSALS,
        counts: { confirmed: 18, suggested: 6, missing: 4 },
        canEdit: role !== 'sales',
        isAdmin: role === 'admin',
        initialChange: state === 'change' ? HS_TYPES[1].id : null,
      }}
    />
  );
}
