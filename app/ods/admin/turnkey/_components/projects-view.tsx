/**
 * ODS T9 · /admin/turnkey/projects — presentational view: whose projects (All / My), the phase funnel (counts of open +
 * on-hold projects per phase, as today), status + search (GET form, today's parameters) and the grid.
 */
import { Button } from '@octopus/ui';
import { STATUS_FILTERS, TK_PHASES, projectsHref, type ProjectStatusFilter } from '../_lib/turnkey-logic';
import { ProjectsGrid, type ProjectRowVM } from './projects-grid';
import { TurnkeyHead } from './tk-ui';

export type ProjectsViewProps = {
  isAdmin: boolean;
  filters: { stage: string; status: ProjectStatusFilter; q: string; mine: boolean };
  perStage: Record<string, number>;
  rows: ProjectRowVM[] | null;
  loading?: boolean;
  /** fixtures: base for filter links */
  base?: string;
  sample?: boolean;
};

const chip = (on: boolean) =>
  `inline-flex min-h-ods-control items-center gap-2 rounded-ods-control border px-3 text-ods-body no-underline ${on ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy hover:border-ods-navy'}`;

export function ProjectsView({ isAdmin, filters: f, perStage, rows, loading, base = '/admin/turnkey/projects', sample }: ProjectsViewProps) {
  const href = (patch: Record<string, string>) => projectsHref(f, patch, base);
  return (
    <div className="grid gap-3" data-testid="tk-projects">
      <TurnkeyHead
        title="Client projects"
        subtitle="Every client project moves through 8 phases. Move a project on the project page; the client sees each change."
        crumbs={[{ label: 'Turnkey', href: '/admin/turnkey' }, { label: 'Client projects' }]}
        current="projects"
        isAdmin={isAdmin}
      />
      <nav aria-label="Whose projects" className="flex flex-wrap gap-2">
        <a href={href({ mine: '' })} aria-current={!f.mine ? 'page' : undefined} data-testid="tk-filter-all" className={chip(!f.mine)}>All projects</a>
        <a href={href({ mine: '1' })} aria-current={f.mine ? 'page' : undefined} data-testid="tk-filter-mine" className={chip(f.mine)}>My projects</a>
        {isAdmin ? <a href="/admin/turnkey/approvals" className={`${chip(false)} font-semibold`} data-testid="tk-link-approvals">Fee approvals →</a> : null}
      </nav>
      <nav aria-label="Projects by phase" className="-mx-1 overflow-x-auto px-1" data-testid="tk-staff-funnel">
        <ul className="m-0 flex min-w-max list-none gap-2 p-0 pb-1">
          <li><a href={href({ stage: '' })} aria-current={!f.stage ? 'page' : undefined} className={chip(!f.stage)}>All phases</a></li>
          {TK_PHASES.map((p) => (
            <li key={p.code}>
              <a href={href({ stage: p.code })} aria-current={f.stage === p.code ? 'page' : undefined} className={chip(f.stage === p.code)}>
                {p.n}. {p.name}<span className="font-mono text-ods-small">{perStage[p.code] ?? 0}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <form method="get" action={base.split('?')[0]} className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter projects">
        {base.includes('?') ? [...new URLSearchParams(base.split('?')[1]).entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
        {f.stage ? <input type="hidden" name="stage" value={f.stage} /> : null}
        {f.mine ? <input type="hidden" name="mine" value="1" /> : null}
        <div className="grid gap-1">
          <label className="text-ods-label font-semibold text-ods-text" htmlFor="tk-f-status">Status</label>
          <select id="tk-f-status" name="status" defaultValue={f.status} className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body">
            {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-ods-label font-semibold text-ods-text" htmlFor="tk-f-q">Search</label>
          <input id="tk-f-q" name="q" defaultValue={f.q} placeholder="TKP-00012 or project name" className="h-ods-control w-64 max-w-full rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body" />
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <ProjectsGrid rows={rows ?? []} loading={loading} error={rows === null && !loading} sample={sample} />
      {rows && rows.length >= 300 ? <p className="m-0 text-ods-small text-ods-slate">Showing the 300 most recently updated: refine the filters.</p> : null}
    </div>
  );
}
