import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { contentTab, sectionNo } from '@/app/ods/admin/_website/website-core';
import { ContentFixture, StateNav } from '../_website-fixture';
import { sampleContent } from '../_website-sample';

export const metadata: Metadata = { title: 'Site content · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | undefined>>;
const BASE = '/dev/ui/screens/office-content';
const STATES = [['terms', 'Terms'], ['pages', 'Pages'], ['blocks', 'Content blocks'], ['company', 'Company & branches'], ['home', 'Home page'], ['media', 'Media'], ['read-only', 'Read-only (no edit)'], ['loading', 'Loading']] as const;

/** Staging-only fixture (T9): Website › Site content with SAMPLE data. ?state=terms|pages|blocks|company|home|media|read-only|loading (&tab= works too). */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const state = STATES.find(([s]) => s === sp.state)?.[0] ?? 'terms';
  const tab = contentTab(sp.tab ?? (['read-only', 'loading'].includes(state) ? 'terms' : state));
  const readOnly = state === 'read-only';
  return (
    <ContentFixture
      nav={<StateNav base={BASE} state={state} states={STATES} />}
      screen={{
        tab,
        data: state === 'loading' ? { tab, loading: true } : sampleContent(tab),
        perms: readOnly ? { editable: false, canCreate: false, isAdmin: false } : { editable: true, canCreate: true, isAdmin: true },
        basePath: BASE,
        extraParams: { state },
        sectionNo: sectionNo(sp.s ?? '4'),
        viewId: sp.v,
        suggestedPublish: '2026-12-11',
      }}
    />
  );
}
