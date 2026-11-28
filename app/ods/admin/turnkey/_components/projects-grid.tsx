'use client';
/** ODS T9 · Turnkey client projects grid (OctopusDataGrid, compact). Rows open the project record. Phones: read-only list. */
import { useRouter } from 'next/navigation';
import { OctopusDataGrid, formatDate, type GridColumn } from '@octopus/ui';
import { phaseLabel, tkStatus } from '@/lib/turnkey/format';
import { TkPill } from './tk-ui';

export type ProjectRowVM = { id: string; code: string; title: string; stage: string; status: string; client: string | null; source: string; manager: string | null; cover: string | null; updated_at: string };

export function ProjectsGrid({ rows, loading, error, sample }: { rows: ProjectRowVM[]; loading?: boolean; error?: boolean; sample?: boolean }) {
  const router = useRouter();
  const href = (r: ProjectRowVM) => `/admin/turnkey/projects/${r.code}`;
  const cols: GridColumn<ProjectRowVM>[] = [
    {
      id: 'project', header: 'Project', accessor: (r) => r.title, width: 280, minWidth: 220,
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight" data-testid={`tk-staff-row-${r.code}`}>
          <a href={href(r)} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-6 items-center truncate font-semibold text-ods-blue hover:underline">{r.title}</a>
          <span className="font-mono text-ods-small text-ods-slate">{r.code}{r.source === 'legacy_lead' ? ' · from an old lead' : ''}</span>
        </span>
      ),
    },
    { id: 'client', header: 'Client', accessor: (r) => r.client ?? '', cell: (r) => r.client ?? <span className="text-ods-warning">Not linked yet</span>, width: 200 },
    { id: 'phase', header: 'Phase', accessor: (r) => r.stage, cell: (r) => phaseLabel(r.stage), width: 220 },
    { id: 'status', header: 'Status', accessor: (r) => r.status, cell: (r) => { const st = tkStatus(r.status); return <TkPill label={st.label} tone={st.tone} />; }, width: 130 },
    { id: 'manager', header: 'Account manager', accessor: (r) => r.manager ?? '', cell: (r) => <span className="flex flex-col leading-tight">{r.manager ?? <span className="text-ods-slate">Not set</span>}{r.cover ? <span className="text-ods-small text-ods-slate">{r.cover}</span> : null}</span>, width: 220 },
    { id: 'updated', header: 'Updated', accessor: (r) => r.updated_at, cell: (r) => <span className="text-ods-slate">{formatDate(r.updated_at)}</span>, width: 120 },
  ];
  return (
    <OctopusDataGrid
      label="Client projects"
      rows={rows}
      columns={cols}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={loading}
      error={error ? "We couldn't load the projects." : undefined}
      onRetry={sample ? undefined : () => router.refresh()}
      onOpenRow={(r, o) => (o.newTab ? window.open(href(r), '_blank') : sample ? undefined : router.push(href(r)))}
      defaultSort={{ id: 'updated', desc: true }}
      emptyTitle="No projects here"
      emptyDescription="Try another phase, status or search."
      searchPlaceholder="Filter these rows"
      pagination
      headingLevel={2}
      data-testid="tk-projects-grid"
    />
  );
}
