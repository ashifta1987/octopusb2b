// ODS T9 · /admin/turnkey/projects (Client projects). Replaces the T8 re-export of app/admin/turnkey/projects/page.tsx.
// Same guard (requireStaff('turnkey','view')), division scope, filters (?stage ?status ?q ?mine), tk_my_managed_projects,
// funnel counts, 300-row cap, tk_client_project_staff + tk_manager_candidates for names. RLS: account managers without
// the TK division see only the projects they manage. Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDivisionScope } from '@/lib/divisions/scope';
import { fmtDate } from '@/lib/format';
import { projectFilters } from '../_lib/turnkey-logic';
import { ProjectsView } from '../_components/projects-view';
import type { ProjectRowVM } from '../_components/projects-grid';

export const metadata = { title: 'Turnkey client projects' };

type SP = Promise<{ stage?: string; status?: string; q?: string; mine?: string }>;
type Row = { id: string; code: string; title: string; stage: string; status: string; org_id: string | null; source: string; updated_at: string; organizations: { name: string } | null };

export default function TurnkeyProjectsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<ProjectsView isAdmin={false} filters={{ stage: '', status: 'active', q: '', mine: false }} perStage={{}} rows={[]} loading sample />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/projects');
  const scope = await getDivisionScope(s);
  const f = projectFilters(await searchParams);
  const sb = await createClient();
  const { data: mineRows } = f.mine ? await sb.rpc('tk_my_managed_projects') : { data: null };
  const mineIds = ((mineRows ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : Object.values(x as Record<string, string>)[0]));
  let list = sb.from('tk_client_projects').select('id, code, title, stage, status, org_id, source, updated_at, organizations(name)');
  let counts = sb.from('tk_client_projects').select('stage, status');
  if (!scope.all) { list = list.eq('division_id', scope.division.id); counts = counts.eq('division_id', scope.division.id); }
  if (f.stage) list = list.eq('stage', f.stage);
  if (f.status === 'active') list = list.in('status', ['open', 'on_hold']);
  else if (f.status !== 'all') list = list.eq('status', f.status);
  if (f.q) list = list.or(`code.ilike.%${f.q}%,title.ilike.%${f.q}%`);
  if (f.mine) list = list.in('id', mineIds.length ? mineIds : ['00000000-0000-0000-0000-000000000000']);
  const [{ data: rows, error }, { data: all }, { data: cands }] = await Promise.all([
    list.order('updated_at', { ascending: false }).limit(300),
    counts.in('status', ['open', 'on_hold']).limit(5000),
    sb.rpc('tk_manager_candidates'),
  ]);
  const R = (rows ?? []) as unknown as Row[];
  const ids = R.map((r) => r.id);
  const { data: staffRows } = ids.length ? await sb.from('tk_client_project_staff').select('project_id, owner_id, cover_id, cover_from, cover_to').in('project_id', ids) : { data: [] };
  const owner = new Map((staffRows ?? []).map((x) => [x.project_id as string, x as { owner_id: string | null; cover_id: string | null; cover_from: string | null; cover_to: string | null }]));
  const names = new Map(((cands ?? []) as { user_id: string; full_name: string }[]).map((c) => [c.user_id, c.full_name]));
  const perStage: Record<string, number> = {};
  for (const r of (all ?? []) as { stage: string }[]) perStage[r.stage] = (perStage[r.stage] ?? 0) + 1;
  const vm: ProjectRowVM[] = R.map((r) => {
    const o = owner.get(r.id);
    return {
      id: r.id, code: r.code, title: r.title, stage: r.stage, status: r.status, client: r.organizations?.name ?? null, source: r.source, updated_at: r.updated_at,
      manager: o?.owner_id ? names.get(o.owner_id) ?? 'Former team member' : null,
      cover: o?.cover_id ? `Cover: ${names.get(o.cover_id) ?? 'Former team member'} · ${fmtDate(o.cover_from)} to ${fmtDate(o.cover_to)}` : null,
    };
  });
  return <ProjectsView isAdmin={s.isAdmin} filters={f} perStage={perStage} rows={error ? null : vm} />;
}
