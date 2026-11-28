import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ImportRunFixture } from '../office-products/_fixtures';
import { importRun } from '../office-products/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-products/_shared';

export const metadata: Metadata = { title: 'Import run · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-import-job';
const STATES = ['preview', 'errors', 'committed', 'loading'] as const;

/** Staging-only fixture (T9 batch 5, Catalogue): Import run, SAMPLE data. ?state=preview|errors|committed|loading&role=finance|admin|sales */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const role = pickRole(sp.role, 'admin');
  const state = STATES.find((s) => s === one(sp.state)) ?? 'preview';
  const links = fixtureLinks(BASE, STATES, state, role);
  return (
    <ImportRunFixture
      role={role}
      links={links}
      screen={{ state: state === 'loading' ? 'loading' : 'ok', data: state === 'loading' ? null : importRun(state === 'errors' ? 'errors' : state === 'committed' ? 'committed' : 'preview'), canEdit: role !== 'sales' }}
    />
  );
}
