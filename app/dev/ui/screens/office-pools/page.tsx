import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { parsePoolQuery } from '@/app/ods/admin/pools/_lib/pools-core';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { PoolsFixture } from './_fixture';
import { NOW, POOL_ROLES, SAMPLE_FX, SAMPLE_RULES, roleSeesSuppliers, sampleKpis, samplePoolPerms, samplePools, type PoolRole } from './sample-data';

export const metadata: Metadata = { title: 'Back Office MOQ pools · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-pools';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = [
  ['list', 'Open pools'],
  ['drawer', 'Pool drawer'],
  ['off', 'Group buying OFF'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Failed'],
] as const;
type State = (typeof STATES)[number][0];

/** Staging-only fixture (T9): /admin/pools with SAMPLE pools. `?state=list|drawer|off|loading|empty|error`, `?role=admin|ops|finance`, + today's ?status= / ?closing=1 / ?pool=. */
export default function OfficePoolsFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'list') as State;
  const role = (POOL_ROLES.find(([r]) => r === one(sp.role))?.[0] ?? 'admin') as PoolRole;
  const perms = samplePoolPerms(role);
  const all = samplePools(perms, roleSeesSuppliers(role));
  const query = parsePoolQuery(state === 'drawer' && !one(sp.pool) ? { ...sp, pool: all[0].id } : sp);
  const rows = query.tab === 'all' ? all : query.tab === 'closing' ? all.filter((r) => r.closingSoon) : all.filter((r) => r.statusRaw === query.tab);
  const rules = state === 'off' ? { ...SAMPLE_RULES, enabled: false } : SAMPLE_RULES;
  const result =
    state === 'loading'
      ? ({ kind: 'loading' } as const)
      : state === 'error'
        ? ({ kind: 'error', error: 'We couldn’t load the pools. Try again.', rules } as const)
        : ({ kind: 'ok', rows: state === 'empty' ? [] : rows, kpis: sampleKpis(state === 'empty' ? [] : all), rules } as const);
  const link = (p: Record<string, string>) => `${BASE}?${new URLSearchParams({ state, role, ...p }).toString()}`;
  return (
    <OfficeScreenFrame role={role === 'finance' ? 'finance' : role === 'admin' ? 'admin' : 'sales'} pathname="/admin/pools">
      <FixtureStates label="Fixture states (sample data)" links={[...STATES.map(([s, text]) => ({ href: link({ state: s }), text, current: s === state })), ...POOL_ROLES.map(([r, text]) => ({ href: link({ role: r }), text: `Role: ${text}`, current: r === role }))]} />
      <PoolsFixture key={`${state}:${role}:${query.tab}`} basePath={BASE} extraParams={{ state, role }} query={query} result={result} perms={perms} now={NOW} fx={SAMPLE_FX} />
    </OfficeScreenFrame>
  );
}
