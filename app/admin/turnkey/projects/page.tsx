import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { getDivisionScope } from '@/lib/divisions/scope';
import { TK_PHASES, phaseLabel, tkStatus } from '@/lib/turnkey/format';

export const metadata = { title: 'Turnkey client projects' };

type Row = { id: string; code: string; title: string; stage: string; status: string; org_id: string | null; source: string; updated_at: string; organizations: { name: string } | null };

/**
 * Admin › Turnkey › Client projects (Turnkey T2/T3; design staff Dashboard/Project/AccountManagers, matched to the text):
 * every client project with its phase, status and account manager (and cover when away); filter by phase / status /
 * search / "My projects" (primary manager, or cover during the cover period). Phase counts work as a funnel. Account
 * managers without the TK division see only the projects they manage (row-level security).
 */
export default async function TurnkeyClientProjectsPage({ searchParams }: { searchParams: Promise<{ stage?: string; status?: string; q?: string; mine?: string }> }) {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/projects');
  const scope = await getDivisionScope(s);
  const sp = await searchParams;
  const stage = TK_PHASES.some((p) => p.code === sp.stage) ? sp.stage! : '';
  const status = ['open', 'on_hold', 'completed', 'cancelled', 'all'].includes(sp.status ?? '') ? sp.status! : 'active';
  const q = (sp.q ?? '').replace(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 60);
  const mine = sp.mine === '1';
  const sb = await createClient();
  const { data: mineRows } = mine ? await sb.rpc('tk_my_managed_projects') : { data: null };
  const mineIds = ((mineRows ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : Object.values(x as Record<string, string>)[0]));

  let list = sb.from('tk_client_projects').select('id, code, title, stage, status, org_id, source, updated_at, organizations(name)');
  let counts = sb.from('tk_client_projects').select('stage, status');
  if (!scope.all) { list = list.eq('division_id', scope.division.id); counts = counts.eq('division_id', scope.division.id); }
  if (stage) list = list.eq('stage', stage);
  if (status === 'active') list = list.in('status', ['open', 'on_hold']);
  else if (status !== 'all') list = list.eq('status', status);
  if (q) list = list.or(`code.ilike.%${q}%,title.ilike.%${q}%`);
  if (mine) list = list.in('id', mineIds.length ? mineIds : ['00000000-0000-0000-0000-000000000000']);
  const [{ data: rows }, { data: all }, { data: cands }] = await Promise.all([
    list.order('updated_at', { ascending: false }).limit(300),
    counts.in('status', ['open', 'on_hold']).limit(5000),
    sb.rpc('tk_manager_candidates'),
  ]);
  const R = (rows ?? []) as unknown as Row[];
  const ids = R.map((r) => r.id);
  const { data: staffRows } = ids.length ? await sb.from('tk_client_project_staff').select('project_id, owner_id, legacy_lead_id, cover_id, cover_from, cover_to').in('project_id', ids) : { data: [] };
  const owner = new Map((staffRows ?? []).map((x) => [x.project_id as string, x as { owner_id: string | null; legacy_lead_id: string | null; cover_id: string | null; cover_from: string | null; cover_to: string | null }]));
  const names = new Map(((cands ?? []) as { user_id: string; full_name: string }[]).map((c) => [c.user_id, c.full_name]));
  const perStage = new Map<string, number>();
  for (const r of (all ?? []) as { stage: string }[]) perStage.set(r.stage, (perStage.get(r.stage) ?? 0) + 1);
  const href = (patch: Record<string, string>) => {
    const u = new URLSearchParams({ ...(stage ? { stage } : {}), ...(status !== 'active' ? { status } : {}), ...(q ? { q } : {}), ...(mine ? { mine: '1' } : {}), ...patch });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    const str = u.toString();
    return `/admin/turnkey/projects${str ? `?${str}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={<Link href="/admin/turnkey" className="text-sm text-muted hover:text-ink">← Turnkey</Link>} title="Client projects"
        subtitle="Every client project moves through 8 phases. Move a project on the project page; the client sees each change." />
      <nav aria-label="Whose projects" className="flex flex-wrap gap-2">
        <Link href={href({ mine: '' })} aria-current={!mine ? 'page' : undefined} data-testid="tk-filter-all"
          className={`min-h-11 px-3 inline-flex items-center rounded-[10px] border ${!mine ? 'bg-coral text-white border-coral' : 'bg-white border-line text-ink hover:border-ink'}`}>All projects</Link>
        <Link href={href({ mine: '1' })} aria-current={mine ? 'page' : undefined} data-testid="tk-filter-mine"
          className={`min-h-11 px-3 inline-flex items-center rounded-[10px] border ${mine ? 'bg-coral text-white border-coral' : 'bg-white border-line text-ink hover:border-ink'}`}>My projects</Link>
        {s.isAdmin && <Link href="/admin/turnkey/approvals" className="min-h-11 px-3 inline-flex items-center rounded-[10px] border bg-white border-line text-ink hover:border-ink font-semibold" data-testid="tk-link-approvals">Fee approvals →</Link>}
      </nav>
      <nav aria-label="Projects by phase" className="flex flex-wrap gap-2" data-testid="tk-staff-funnel">
        <Link href={href({ stage: '' })} aria-current={!stage ? 'page' : undefined}
          className={`min-h-11 px-3 inline-flex items-center gap-2 rounded-[10px] border ${!stage ? 'bg-coral text-white border-coral' : 'bg-white border-line text-ink hover:border-ink'}`}>All phases</Link>
        {TK_PHASES.map((p) => (
          <Link key={p.code} href={href({ stage: p.code })} aria-current={stage === p.code ? 'page' : undefined}
            className={`min-h-11 px-3 inline-flex items-center gap-2 rounded-[10px] border ${stage === p.code ? 'bg-coral text-white border-coral' : 'bg-white border-line text-ink hover:border-ink'}`}>
            {p.n}. {p.name}<span className="mono text-[12px]">{perStage.get(p.code) ?? 0}</span>
          </Link>
        ))}
      </nav>
      <form method="get" action="/admin/turnkey/projects" className="flex flex-wrap items-end gap-3" role="search">
        {stage && <input type="hidden" name="stage" value={stage} />}
        {mine && <input type="hidden" name="mine" value="1" />}
        <div>
          <label className="label" htmlFor="tk-f-status">Status</label>
          <select id="tk-f-status" name="status" defaultValue={status} className="input min-h-11">
            <option value="active">Open and on hold</option><option value="open">In progress</option><option value="on_hold">On hold</option>
            <option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tk-f-q">Search</label>
          <input id="tk-f-q" name="q" defaultValue={q} placeholder="TKP-00012 or project name" className="input min-h-11" />
        </div>
        <button type="submit" className="btn btn-ghost">Filter</button>
      </form>
      <Card>
        <Table head={['Project', 'Client', 'Phase', 'Status', 'Account manager', 'Updated']}>
          {R.map((r) => {
            const o = owner.get(r.id);
            const st = tkStatus(r.status);
            return (
              <tr key={r.id} data-testid={`tk-staff-row-${r.code}`}>
                <td className="td"><Link href={`/admin/turnkey/projects/${r.code}`} className="font-semibold hover:text-coral-text">{r.title}</Link><div className="mono text-xs text-muted">{r.code}{r.source === 'legacy_lead' ? ' · from an old lead' : ''}</div></td>
                <td className="td text-sm">{r.organizations?.name ?? <span className="text-warn">Not linked yet</span>}</td>
                <td className="td text-sm">{phaseLabel(r.stage)}</td>
                <td className="td"><StatusBadge status={r.status} label={st.label} tone={st.tone} /></td>
                <td className="td text-sm">
                  {o?.owner_id ? names.get(o.owner_id) ?? 'Former team member' : <span className="text-muted">Not set</span>}
                  {o?.cover_id && <div className="text-[12px] text-muted">Cover: {names.get(o.cover_id) ?? 'Former team member'} · {fmtDate(o.cover_from)} to {fmtDate(o.cover_to)}</div>}
                </td>
                <td className="td text-sm text-muted">{fmtDate(r.updated_at)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
