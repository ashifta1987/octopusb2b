import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageHead, PageWrap } from '@/app/ods/account/_services/ui';
import { TurnkeyListView } from '@/app/ods/account/turnkey/_components/turnkey-list-view';
import { TurnkeyDetailView } from '@/app/ods/account/turnkey/_components/turnkey-detail-view';
import { ServicesFixtureFrame, fixtureState } from './_frame';
import { SAMPLE_TURNKEY_KITCHEN, SAMPLE_TURNKEY_ON_HOLD, SAMPLE_TURNKEY_PET, SAMPLE_TURNKEY_ROWS } from './sample-data';

export const metadata: Metadata = { title: 'My account · Turnkey · ODS fixtures (staging)', robots: { index: false, follow: false } };

const STATES = [
  { id: 'list', label: 'List' }, { id: 'list-empty', label: 'List empty' }, { id: 'list-loading', label: 'List loading' }, { id: 'list-error', label: 'List error' },
  { id: 'detail', label: 'Detail: production + QC (fee to pay)' }, { id: 'detail-quotes', label: 'Detail: drawing + quote to answer' }, { id: 'detail-on-hold', label: 'Detail: on hold' },
];

/** /account/turnkey and /account/turnkey/TKP-n with SAMPLE props, one state per URL (?state=). */
export default function TurnkeyFixtures({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = fixtureState((await searchParams).state, STATES.map((s) => s.id));
  const list = (s: Parameters<typeof TurnkeyListView>[0]['state']) => (
    <PageWrap><PageHead title="Turnkey projects" description="From idea to delivered stock. Follow each step and payment. The enquiry is free; each paid phase starts after your payment is confirmed." /><TurnkeyListView state={s} /></PageWrap>
  );
  return (
    <ServicesFixtureFrame path={state.startsWith('detail') ? '/account/turnkey/TKP-00012' : '/account/turnkey'} states={STATES} current={state}>
      {state === 'list' ? list({ kind: 'ready', rows: SAMPLE_TURNKEY_ROWS })
        : state === 'list-empty' ? list({ kind: 'ready', rows: [] })
        : state === 'list-loading' ? list({ kind: 'loading' })
        : state === 'list-error' ? list({ kind: 'error' })
        : state === 'detail-quotes' ? <PageWrap><TurnkeyDetailView d={SAMPLE_TURNKEY_PET} tab="quotes" tabParam={null} /></PageWrap>
        : state === 'detail-on-hold' ? <PageWrap><TurnkeyDetailView d={SAMPLE_TURNKEY_ON_HOLD} tab="overview" tabParam={null} /></PageWrap>
        : <PageWrap><TurnkeyDetailView d={SAMPLE_TURNKEY_KITCHEN} tab="overview" tabParam={null} /></PageWrap>}
    </ServicesFixtureFrame>
  );
}
