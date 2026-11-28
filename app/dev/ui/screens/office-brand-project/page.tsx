import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { brandMoves } from '@/lib/brand-projects';
import { BrandHeader, BrandHistory, BrandLogos, BrandOverview, BrandRecordView } from '@/app/ods/admin/brand-projects/_components/brand-record';
import { BrandStatusDrawer } from '@/app/ods/admin/brand-projects/_components/status-drawer';
import { isBrandRecordTab, type BrandRecordTab } from '@/app/ods/admin/brand-projects/_lib/brand-core';
import { OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_BRANDS, SAMPLE_HISTORY } from '../office-pools/sample-data';
import { SampleStatusControls } from './_controls';

export const metadata: Metadata = { title: 'Back Office brand project · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-brand-project';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = [
  ['default', 'Proof (2 logos)'],
  ['new', 'Submitted, unassigned, no logo'],
  ['paid', 'In production, paid'],
  ['closed', 'Closed'],
  ['status', 'Status drawer open'],
  ['history-error', 'History failed'],
  ['loading', 'Loading'],
] as const;
type State = (typeof STATES)[number][0];
const ROLES = [
  ['admin', 'Owner (admin)'],
  ['manager', 'Account manager'],
] as const;
const REF: Record<State, string> = { default: 'MB-1042', new: 'MB-1041', paid: 'MB-1030', closed: 'MB-1019', status: 'MB-1030', 'history-error': 'MB-1042', loading: 'MB-1042' };

/** Staging-only fixture (T9): the ODS brand project record, SAMPLE data. `?state=…`, `?role=admin|manager`, `?tab=overview|logos|history`, `?ref=MB-…`. */
export default function OfficeBrandProjectFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'default') as State;
  const role = (ROLES.find(([r]) => r === one(sp.role))?.[0] ?? 'admin') as (typeof ROLES)[number][0];
  const raw = one(sp.tab);
  const tab: BrandRecordTab = isBrandRecordTab(raw) ? raw : 'overview';
  const r = SAMPLE_BRANDS.find((b) => b.ref === (one(sp.ref) ?? REF[state])) ?? SAMPLE_BRANDS[0];
  const isAdmin = role === 'admin';
  const signed = Object.fromEntries(r.logo_paths.map((p) => [p, '#sample-signed-link']));
  const link = (p: Record<string, string>) => `${BASE}?${new URLSearchParams({ state, role, tab, ...p }).toString()}`;
  return (
    <OfficeScreenFrame role={isAdmin ? 'admin' : 'sales'} pathname="/admin/brand-projects">
      <nav aria-label="Fixture states (sample data)" className="mb-3 grid gap-1.5" data-testid="fixture-states">
        <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
        {(
          [
            ['Role', ROLES, 'role', role],
            ['State', STATES, 'state', state],
          ] as const
        ).map(([label, list, key, cur]) => (
          <ul key={key} aria-label={label} className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
            <li className="text-ods-small font-semibold text-ods-slate">{label}:</li>
            {(list as readonly (readonly [string, string])[]).map(([id, l]) => (
              <li key={id}>
                <a href={link({ [key]: id })} aria-current={cur === id ? 'page' : undefined} className={`inline-flex min-h-7 items-center rounded-ods-control border px-2.5 text-ods-small font-semibold no-underline ${cur === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}>
                  {l}
                </a>
              </li>
            ))}
          </ul>
        ))}
      </nav>
      {state === 'loading' ? (
        <div className="grid gap-3">
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Brand project</h1>
          <Card title="Loading the project…" headingLevel={2} loading />
        </div>
      ) : (
        <BrandRecordView
          key={`${state}:${role}`}
          tab={tab}
          counts={{ logos: r.logo_paths.length, history: state === 'history-error' ? null : SAMPLE_HISTORY.length }}
          header={
            <BrandHeader
              r={r}
              statusAction={
                <BrandStatusDrawer code={r.ref} paid={r.paid} initialOpen={state === 'status'}>
                  <SampleStatusControls moves={brandMoves(r, isAdmin)} paid={r.paid} isAdmin={isAdmin} />
                </BrandStatusDrawer>
              }
            />
          }
          panels={{ overview: <BrandOverview r={r} />, logos: <BrandLogos paths={r.logo_paths} signed={signed} />, history: <BrandHistory history={state === 'history-error' ? null : SAMPLE_HISTORY} /> }}
        />
      )}
    </OfficeScreenFrame>
  );
}
