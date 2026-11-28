import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { TAB_STATUSES, parseRfqQuery, tabAscending } from '@/app/ods/office/rfqs/_lib/rfq-core';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { RfqsFixture } from './_fixture';
import { SAMPLE_KPIS, SAMPLE_ROWS } from './sample-data';

export const metadata: Metadata = { title: 'Back Office sourcing requests · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-rfqs';
const STATES = [
  ['list', 'Open requests'],
  ['to-quote', 'To quote (?f=to_quote)'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Failed'],
] as const;
type State = (typeof STATES)[number][0];

/** Staging-only fixture (T9): /office/rfqs with SAMPLE requests. `?state=list|to-quote|empty|error|loading` (+ `?f=` tabs). */
export default function OfficeRfqsFixturePage({ searchParams }: { searchParams: SP }) {
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
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = (STATES.find(([s]) => s === raw)?.[0] ?? 'list') as State;
  const rawF = Array.isArray(sp.f) ? sp.f[0] : sp.f;
  // ?state=to-quote = the sidebar "Quotes" link (?f=to_quote); tabs keep working from there
  const query = parseRfqQuery({ ...sp, f: rawF ?? (state === 'to-quote' ? 'to_quote' : undefined) });
  const plain = state === 'list' || state === 'to-quote';
  const rows = SAMPLE_ROWS.filter((r) => TAB_STATUSES[query.f].includes(r.statusRaw)).sort((a, b) => (tabAscending(query.f) ? 1 : -1) * a.createdAt.localeCompare(b.createdAt));
  const result =
    state === 'loading'
      ? ({ kind: 'loading' } as const)
      : state === 'error'
        ? ({ kind: 'error', error: 'We couldn’t load the requests. Try again.', kpis: { counts: null, late48: null } } as const)
        : ({ kind: 'ok', rows: state === 'empty' ? [] : rows, kpis: state === 'empty' ? { counts: { open: 0, to_quote: 0, sent: 0, quoting: 0, quote_ready: 0, accepted: 0, closed: 0, all: 0 }, late48: 0 } : SAMPLE_KPIS } as const);
  return (
    <OfficeScreenFrame role="sales" pathname="/office/rfqs">
      <FixtureStates
        label="Fixture states (sample data)"
        links={STATES.map(([s, text]) => ({
          href: s === 'list' ? BASE : s === 'to-quote' ? `${BASE}?f=to_quote` : `${BASE}?state=${s}`,
          text,
          current: plain ? (s === 'to-quote' ? query.f === 'to_quote' : s === 'list' && query.f !== 'to_quote') : s === state,
        }))}
      />
      <RfqsFixture key={`${state}:${query.f}`} basePath={BASE} extraParams={plain ? undefined : { state }} query={query} result={result} perms={{ canQuote: true, canOpenCustomer: true }} />
    </OfficeScreenFrame>
  );
}
