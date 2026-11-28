import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { CatalogFixture } from '../office-products/_fixtures';
import { CATS, TAGS } from '../office-products/sample-data';
import { fixtureLinks, one, pickRole, type SP } from '../office-products/_shared';

export const metadata: Metadata = { title: 'Categories & tags · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-catalog';
const STATES = ['list', 'read-only', 'empty', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 5, Catalogue): Categories & tags, SAMPLE data. ?state=list|read-only|empty|loading|no-permission&role=finance|admin|sales */
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
    <CatalogFixture
      role={role}
      links={links}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        categories: state === 'empty' ? [] : CATS,
        tags: state === 'empty' ? [] : TAGS,
        canEdit: state !== 'read-only' && role !== 'sales',
      }}
    />
  );
}
