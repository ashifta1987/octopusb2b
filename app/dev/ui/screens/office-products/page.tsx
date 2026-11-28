import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ProductsFixture } from './_fixtures';
import { QUEUE, productDetail } from './sample-data';
import { fixtureLinks, one, pickRole, type SP } from './_shared';

export const metadata: Metadata = { title: 'Product moderation · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
const BASE = '/dev/ui/screens/office-products';
const STATES = ['list', 'drawer', 'hold', 'empty', 'error', 'loading', 'no-permission'] as const;

/** Staging-only fixture (T9 batch 5, Catalogue): Product moderation, SAMPLE data. ?state=list|drawer|hold|empty|error|loading|no-permission&role=finance|admin|sales */
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
    <ProductsFixture
      role={role}
      links={links}
      screen={{
        state: state === 'loading' ? 'loading' : state === 'no-permission' ? 'forbidden' : 'ok',
        queue: state === 'error' ? null : state === 'empty' ? [] : QUEUE,
        queueError: state === 'error' ? 'permission denied for function portal_products (sample)' : null,
        selected: state === 'drawer' ? productDetail(1) : state === 'hold' ? productDetail(3) : null,
        basePath: BASE,
        extraParams: { state: 'list', role },
      }}
    />
  );
}
