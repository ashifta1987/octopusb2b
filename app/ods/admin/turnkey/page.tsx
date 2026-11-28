// ODS T9 · /admin/turnkey (Turnkey home). Replaces the T8 re-export of app/admin/turnkey/page.tsx. Same guard
// (requireStaff('turnkey','view')), same division scope, same queries per tab (tk_dashboard, catalogue, tk_services,
// tk_deposit_pct, old leads + moved-to codes). Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDivisionScope } from '@/lib/divisions/scope';
import { money } from '@/lib/format';
import type { TkService } from '@/lib/turnkey/format';
import type { TkDashboard } from '@/lib/turnkey/reports';
import { Skeleton } from '@octopus/ui';
import { overviewTab } from './_lib/turnkey-logic';
import { OverviewView, type CatalogueRow, type LeadRow } from './_components/overview-view';

export const metadata = { title: 'Turnkey' };

type SP = Promise<{ tab?: string }>;

export default function TurnkeyHomePage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<Skeleton lines={8} label="Loading Turnkey" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey');
  const scope = await getDivisionScope(s);
  const tab = overviewTab((await searchParams).tab);
  const edit = can(s, 'turnkey', 'edit');
  const sb = await createClient();
  const PROJECT_COLS = 'project_id, title, category, status, starting_budget_usd, hero_image_path, floor_area_m2, sort_rank';
  const LEAD_COLS = 'lead_id, reference, kind, status, company_name, country, created_at, turnkey_projects(title)';
  const none = Promise.resolve({ data: null, error: null });
  const [dash, projects, services, leads, moved, depositPct] = await Promise.all([
    tab === 'dashboard' ? sb.rpc('tk_dashboard') : none,
    tab === 'catalogue' ? (scope.all ? sb.from('turnkey_projects').select(PROJECT_COLS) : sb.from('turnkey_projects').select(PROJECT_COLS).eq('division_id', scope.division.id)).order('sort_rank').order('title') : none,
    tab === 'services' ? sb.from('tk_services').select('code, name, from_cents, unit, approx, rule_text, group_code, photo_path, sort').order('sort') : none,
    tab === 'leads' ? (scope.all ? sb.from('turnkey_leads').select(LEAD_COLS) : sb.from('turnkey_leads').select(LEAD_COLS).eq('division_id', scope.division.id)).order('created_at', { ascending: false }).limit(300) : none,
    tab === 'leads' ? sb.from('tk_client_project_staff').select('legacy_lead_id, tk_client_projects(code)').not('legacy_lead_id', 'is', null).limit(1000) : none,
    tab === 'services' ? sb.rpc('tk_deposit_pct') : none,
  ]);
  const movedTo = Object.fromEntries(((moved.data ?? []) as unknown as { legacy_lead_id: string; tk_client_projects: { code: string } | null }[]).map((m) => [m.legacy_lead_id, m.tk_client_projects?.code ?? null]));
  return (
    <OverviewView
      tab={tab}
      isAdmin={s.isAdmin}
      edit={edit}
      dashboard={dash.error ? null : ((dash.data ?? null) as TkDashboard | null)}
      catalogue={projects.error ? null : ((projects.data ?? []) as unknown as CatalogueRow[])}
      services={services.error ? null : ((services.data ?? []) as TkService[])}
      depositPct={(depositPct.data as number | null) ?? null}
      leads={leads.error ? null : ((leads.data ?? []) as unknown as LeadRow[])}
      movedTo={movedTo}
      money={(c) => money(c)}
    />
  );
}
