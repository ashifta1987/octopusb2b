import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { OverviewView } from '@/app/ods/admin/turnkey/_components/overview-view';
import type { OverviewTab } from '@/app/ods/admin/turnkey/_lib/turnkey-logic';
import { TurnkeyFixtureFrame } from '../_office-turnkey-frame';
import { FixtureNav, pick } from '../_office-turnkey-fixture-nav';
import { CATALOGUE, DASHBOARD, DASHBOARD_EMPTY, LEADS, ROLES, SERVICES, roleSession, sampleMoney } from '../_office-turnkey-sample';

export const metadata: Metadata = { title: 'Turnkey home · ODS screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = [['dashboard', 'Dashboard'], ['catalogue', 'Catalogue'], ['services', 'Services'], ['leads', 'Old leads']] as const;
const STATES = [['default', 'Default'], ['manager-only', 'Account manager (own projects only)'], ['error', 'Error']] as const;

/** Staging-only fixture (T9): /admin/turnkey in the real Back Office frame. ?tab= ?role=admin|editor|viewer ?state=default|manager-only|error */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tab = pick(sp.tab, TABS, 'dashboard') as OverviewTab;
  const role = pick(sp.role, ROLES, 'admin');
  const state = pick(sp.state, STATES, 'default');
  const r = roleSession(role);
  const err = state === 'error';
  return (
    <TurnkeyFixtureFrame pathname="/admin/turnkey" activeId="tk-home" isAdmin={r.isAdmin} roles={r.roles} permissions={r.permissions}>
      <FixtureNav base="/dev/ui/screens/office-turnkey-overview" current={{ tab, role, state }} groups={[{ key: 'tab', label: 'Tab', options: TABS }, { key: 'role', label: 'Role', options: ROLES }, { key: 'state', label: 'State', options: STATES }]} />
      <OverviewView
        tab={tab}
        isAdmin={r.isAdmin}
        edit={r.edit}
        dashboard={err ? null : state === 'manager-only' ? { ...DASHBOARD_EMPTY, my_projects: DASHBOARD.my_projects } : DASHBOARD}
        catalogue={err ? null : CATALOGUE}
        services={err ? null : SERVICES}
        depositPct={30}
        leads={err ? null : LEADS}
        movedTo={{ l1: 'TKP-00012' }}
        money={(c) => sampleMoney(c)}
        sample
      />
    </TurnkeyFixtureFrame>
  );
}
