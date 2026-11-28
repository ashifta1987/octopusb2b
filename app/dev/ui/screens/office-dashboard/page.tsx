import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { dashboardWidgets, firstNameOf, kpiKindFor, type WidgetId } from '@/app/ods/office/_lib/dashboard-core';
import {
  ActivityPanel, AgeingPanel, DashboardShell, KpiPanel, MoneyChart, MyWorkPanel, PanelError, PanelSkeleton, PoolsPanel,
} from '@/app/ods/office/_components/dashboard';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import {
  SAMPLE_ACTIVITY, SAMPLE_AGEING, SAMPLE_FINANCE_KPIS, SAMPLE_FX, SAMPLE_PERMS, SAMPLE_POOLS, SAMPLE_ROLES, SAMPLE_SALES_KPIS, SAMPLE_USER,
  SAMPLE_WEEKS, SAMPLE_WORK, SAMPLE_WORK_STATS, type SampleRole,
} from './sample-data';

export const metadata: Metadata = { title: 'Back Office dashboard · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-dashboard';
const STATES = [
  ['default', 'Loaded'],
  ['loading', 'Loading'],
  ['panel-error', 'Panels failed'],
  ['empty', 'Empty'],
] as const;
type State = (typeof STATES)[number][0];

/**
 * Staging-only fixture (T9): the ODS Dashboard (/office, Part 7.3) inside the real Back Office frame with SAMPLE data.
 * `?role=finance|sales|admin` (widgets + KPI strip by role) · `?state=default|loading|panel-error|empty`.
 */
export default function OfficeDashboardFixturePage({ searchParams }: { searchParams: SP }) {
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
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const role = (SAMPLE_ROLES.find(([r]) => r === one(sp.role))?.[0] ?? 'finance') as SampleRole;
  const state = (STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'default') as State;
  const perms = SAMPLE_PERMS[role];
  const widgets = dashboardWidgets(perms);
  const kind = kpiKindFor(perms);
  const loading = state === 'loading';
  const failed = (w: WidgetId) => state === 'panel-error' && (w === 'money' || w === 'activity' || w === 'pools');
  const empty = state === 'empty';

  const panels: Partial<Record<WidgetId, ReactNode>> = {
    kpis: loading ? <KpiPanel items={[]} loading /> : <KpiPanel items={kind === 'finance' ? SAMPLE_FINANCE_KPIS : SAMPLE_SALES_KPIS} fx={SAMPLE_FX} />,
    'my-work': loading ? <PanelSkeleton title="My work" testId="my-work-grid" lines={6} /> : <MyWorkPanel items={empty ? [] : SAMPLE_WORK} total={empty ? 0 : SAMPLE_WORK_STATS.open} seeAllHref="/dev/ui/screens/office-my-work" />,
    money: loading ? <PanelSkeleton title="Money in and out · last 8 weeks" testId="money-chart" lines={6} /> : failed('money') ? <PanelError title="Money in and out" testId="money-chart" /> : <MoneyChart weeks={empty ? SAMPLE_WEEKS.map((w) => ({ ...w, inMinor: 0, outMinor: 0 })) : SAMPLE_WEEKS} fx={SAMPLE_FX} />,
    ageing: loading ? <PanelSkeleton title="Receivables ageing" testId="ageing" /> : <AgeingPanel ageing={empty ? { ...SAMPLE_AGEING, totalMinor: 0 } : SAMPLE_AGEING} fx={SAMPLE_FX} />,
    pools: loading ? <PanelSkeleton title="MOQ pools closing soon" testId="pools-closing" /> : failed('pools') ? <PanelError title="MOQ pools closing soon" testId="pools-closing" /> : <PoolsPanel pools={empty ? [] : SAMPLE_POOLS} />,
    activity: loading ? <PanelSkeleton title="Recent activity" testId="recent-activity" /> : failed('activity') ? <PanelError title="Recent activity" testId="recent-activity" /> : <ActivityPanel items={empty ? [] : SAMPLE_ACTIVITY} auditShown={role !== 'sales'} />,
  };

  const links = [
    ...SAMPLE_ROLES.map(([r, label]) => ({ href: `${BASE}?role=${r}${state !== 'default' ? `&state=${state}` : ''}`, text: label, current: r === role })),
    ...STATES.map(([s, label]) => ({ href: `${BASE}?role=${role}&state=${s}`, text: label, current: s === state })),
  ];

  return (
    <OfficeScreenFrame role={role} pathname="/office">
      <FixtureStates label="Fixture roles and states (sample data)" links={links} />
      <DashboardShell
        firstName={firstNameOf(SAMPLE_USER[role].name)}
        roleLabel={SAMPLE_USER[role].role}
        widgets={widgets}
        initialHidden={[]}
        storageKey={`ods.office.fixture.dashboard.${role}`}
        panels={Object.fromEntries(widgets.map((w) => [w, panels[w]]))}
      />
    </OfficeScreenFrame>
  );
}
