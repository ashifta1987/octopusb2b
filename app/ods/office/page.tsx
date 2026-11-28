// ODS T9
import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { requireStaff, can, type Session } from '@/lib/auth';
import { loadWorkspace } from '@/lib/office/workspace';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { saveUiPrefsAction } from './_actions/workspace';
import { roleLabel } from './_lib/nav';
import { dashboardWidgets, firstNameOf, hiddenWidgetsFrom, kpiKindFor, type WidgetId } from './_lib/dashboard-core';
import { loadActivity, loadAgeing, loadFinanceKpis, loadMoneyWeeks, loadMyWork, loadPoolsClosing, loadSalesKpis, settle } from './_lib/dashboard-data';
import {
  ActivityPanel, AgeingPanel, DashboardShell, KpiPanel, MoneyChart, MyWorkPanel, PanelError, PanelSkeleton, PoolsPanel,
} from './_components/dashboard';

/**
 * ODS T9 · /office Dashboard (Part 7.3, board ERP_Dashboard). Same guard as today's /office "Queues" page:
 * requireStaff('dashboard', 'view') (people without it land on /admin, today's Work queue — nav.dashboardHref).
 * Panels are chosen by permission (dashboardWidgets) and each loads and fails on its own (<Suspense> + settle →
 * PanelError). Data sources: see app/ods/office/_lib/dashboard-data.ts. Customise = ui_prefs.extra.dashboardHidden
 * (T8-DATA saveUiPrefsAction; this browser only until migration 254 is applied).
 */
export const metadata: Metadata = { title: 'Dashboard' };

export default function OdsOfficeDashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <Dashboard />
    </Suspense>
  );
}

function DashboardLoading() {
  return (
    <div className="flex flex-col gap-ods-gap" aria-busy="true">
      <div className="h-12 w-72 rounded-ods-control bg-ods-line" />
      <KpiPanel items={[]} loading />
      <PanelSkeleton title="My work" testId="my-work-grid" />
    </div>
  );
}

async function saveHidden(hidden: WidgetId[]) {
  'use server';
  const r = await saveUiPrefsAction({ extra: { dashboardHidden: hidden } });
  return { ok: r.ok };
}

async function Dashboard() {
  const s = await requireStaff('dashboard', 'view', '/office');
  const perms = { isAdmin: s.isAdmin, permissions: [...s.permissions] };
  const widgets = dashboardWidgets(perms);
  const ws = await loadWorkspace().catch(() => null);
  const persisted = ws?.source === 'db';
  const nowMs = getNowMs(); // request time (after the session read), as today's Receivables page
  const panels: Partial<Record<WidgetId, ReactNode>> = {
    kpis: (
      <Suspense fallback={<KpiPanel items={[]} loading />}>
        <KpisLoader s={s} nowMs={nowMs} />
      </Suspense>
    ),
    'my-work': (
      <Suspense fallback={<PanelSkeleton title="My work" testId="my-work-grid" lines={6} />}>
        <MyWorkLoader s={s} />
      </Suspense>
    ),
    money: (
      <Suspense fallback={<PanelSkeleton title="Money in and out · last 8 weeks" testId="money-chart" lines={6} />}>
        <MoneyLoader nowMs={nowMs} />
      </Suspense>
    ),
    ageing: (
      <Suspense fallback={<PanelSkeleton title="Receivables ageing" testId="ageing" />}>
        <AgeingLoader nowMs={nowMs} />
      </Suspense>
    ),
    pools: (
      <Suspense fallback={<PanelSkeleton title="MOQ pools closing soon" testId="pools-closing" />}>
        <PoolsLoader s={s} nowMs={nowMs} />
      </Suspense>
    ),
    activity: (
      <Suspense fallback={<PanelSkeleton title="Recent activity" testId="recent-activity" />}>
        <ActivityLoader s={s} />
      </Suspense>
    ),
  };
  return (
    <DashboardShell
      firstName={firstNameOf(s.profile?.full_name || s.email)}
      roleLabel={roleLabel({ isAdmin: s.isAdmin, roles: s.roles })}
      widgets={widgets}
      initialHidden={persisted ? hiddenWidgetsFrom(ws?.prefs.extra) : []}
      storageKey={`ods.office.dashboard.hidden.v1:${s.userId}`}
      onSaveHidden={persisted ? saveHidden : undefined}
      panels={Object.fromEntries(widgets.map((w) => [w, panels[w]]))}
    />
  );
}

async function KpisLoader({ s, nowMs }: { s: Session; nowMs: number }) {
  const kind = kpiKindFor({ isAdmin: s.isAdmin, permissions: [...s.permissions] });
  if (kind === 'finance' && can(s, 'finance')) {
    const r = await settle(() => loadFinanceKpis(nowMs));
    return r.ok ? <KpiPanel items={r.data.items} fx={r.data.fx} /> : <PanelError title="Key figures" testId="kpi-strip" />;
  }
  const r = await settle(() => loadSalesKpis(s));
  return r.ok ? <KpiPanel items={r.data} /> : <PanelError title="Key figures" testId="kpi-strip" />;
}

async function MyWorkLoader({ s }: { s: Session }) {
  const r = await settle(() => loadMyWork(s));
  return r.ok ? <MyWorkPanel items={r.data.items} total={r.data.stats.open} /> : <PanelError title="My work" testId="my-work-grid" />;
}

async function MoneyLoader({ nowMs }: { nowMs: number }) {
  const r = await settle(() => loadMoneyWeeks(nowMs));
  return r.ok ? <MoneyChart weeks={r.data.weeks} fx={r.data.fx} /> : <PanelError title="Money in and out" testId="money-chart" />;
}

async function AgeingLoader({ nowMs }: { nowMs: number }) {
  const r = await settle(() => loadAgeing(nowMs));
  return r.ok ? <AgeingPanel ageing={r.data.ageing} fx={r.data.fx} /> : <PanelError title="Receivables ageing" testId="ageing" />;
}

async function PoolsLoader({ s, nowMs }: { s: Session; nowMs: number }) {
  const r = await settle(() => loadPoolsClosing(s, nowMs));
  return r.ok ? <PoolsPanel pools={r.data} /> : <PanelError title="MOQ pools closing soon" testId="pools-closing" />;
}

async function ActivityLoader({ s }: { s: Session }) {
  const r = await settle(() => loadActivity(s));
  return r.ok ? <ActivityPanel items={r.data.items} auditShown={r.data.auditShown} /> : <PanelError title="Recent activity" testId="recent-activity" />;
}
