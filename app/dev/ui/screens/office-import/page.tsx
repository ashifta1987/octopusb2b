import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ImportFixture, ImportReviewFixture } from '../office-products/_fixtures';
import { RUNS, SUPPLIER_OPTS, REVIEW_ITEMS, REVIEW_PRODUCTS } from '../office-products/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-products/_shared';

export const metadata: Metadata = { title: 'Bulk import · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-import';
const STATES = ['list', 'upload', 'review', 'review-held', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 5, Catalogue): Bulk import, SAMPLE data. ?state=list|upload|review|review-held|empty|error|loading|no-permission&role=finance|admin|sales */
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
  if (state === 'review' || state === 'review-held') {
    return (
      <ImportReviewFixture
        role={role}
        links={links}
        screen={{ state: 'ok', items: REVIEW_ITEMS, products: REVIEW_PRODUCTS, tab: state === 'review-held' ? 'held' : 'open', run: null, canEdit: role !== 'sales', defaultMarkup: 25, basePath: BASE, extraParams: { state, role } }}
      />
    );
  }
  return (
    <ImportFixture
      role={role}
      links={links}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        runs: state === 'error' ? null : state === 'empty' ? [] : RUNS,
        openReview: state === 'empty' ? 0 : 2,
        suppliers: SUPPLIER_OPTS,
        defaultValidFrom: '2026-11-01',
        initialUpload: state === 'upload',
        runBase: '/dev/ui/screens/office-import-job?run=',
      }}
    />
  );
}
