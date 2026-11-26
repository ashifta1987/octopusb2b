import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Notice, PageHeader, StatusBadge, Timeline } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import { areaLabel, budgetLabel, phaseLabel, tkStatus } from '@/lib/turnkey/format';
import { getTkClientProject } from '@/lib/turnkey/projects';
import { ProjectPhases, eventText } from '@/components/turnkey/project-phases';
import { ProjectControls } from './project-controls';

export const metadata = { title: 'Turnkey client project' };

type Lead = { reference: string; kind: string; company_name: string; contact_name: string; email: string; phone: string | null; country: string; status: string; created_at: string };

/**
 * Admin › Turnkey › Client project (Turnkey T2; design staff "Project", matched to the text). What the client sent,
 * the 8 phases with dates and the history the client sees, plus (Turnkey editors) the controls. Staff-only facts
 * (account manager, the old lead's contact details) come from staff-only tables; row-level security checks access.
 */
export default async function TurnkeyClientProjectStaffPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const s = await requireStaff('turnkey', 'view', `/admin/turnkey/projects/${code}`);
  if (!/^TKP-\d{5,}$/.test(code)) notFound();
  const d = await getTkClientProject(code);
  if (!d) notFound();
  const { project: p, stages, events, managerName } = d;
  const sb = await createClient();
  const [{ data: staffRow }, { data: org }, { data: cands }] = await Promise.all([
    sb.from('tk_client_project_staff').select('owner_id, owner_set_at, created_by, legacy_lead_id, is_seed').eq('project_id', p.id).maybeSingle(),
    p.org_id ? sb.from('organizations').select('id, name, country').eq('id', p.org_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc('tk_manager_candidates'),
  ]);
  const staff = staffRow as { owner_id: string | null; owner_set_at: string | null; created_by: string | null; legacy_lead_id: string | null; is_seed: boolean } | null;
  const { data: leadRow } = staff?.legacy_lead_id
    ? await sb.from('turnkey_leads').select('reference, kind, company_name, contact_name, email, phone, country, status, created_at').eq('lead_id', staff.legacy_lead_id).maybeSingle()
    : { data: null };
  const lead = leadRow as Lead | null;
  const company = org as { id: string; name: string; country: string | null } | null;
  const edit = can(s, 'turnkey', 'edit');
  const st = tkStatus(p.status);
  const dues = Object.fromEntries(stages.map((r) => [r.stage, r.due_on]));
  const place = [p.city, countryName(p.country)].filter(Boolean).join(', ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={<Link href="/admin/turnkey/projects" className="text-sm text-muted hover:text-ink">← Client projects</Link>}
        title={p.title} subtitle={`${p.code} · ${phaseLabel(p.stage)} · started ${fmtDate(p.created_at)}`}
        actions={<StatusBadge status={p.status} label={st.label} tone={st.tone} />} />
      {staff?.is_seed && <Notice tone="amber">Test data (moved from a seed lead).</Notice>}
      {!p.org_id && <Notice tone="amber">Not linked to a client company yet: it joins the company of the account with the lead’s email when that person signs in and opens Turnkey projects.</Notice>}
      {(p.status === 'on_hold' || p.status === 'cancelled') && p.status_reason && <Notice tone={p.status === 'on_hold' ? 'amber' : 'red'}>{st.label}: {p.status_reason}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] items-start">
        <div className="flex flex-col gap-6">
          <Card title="Phases">
            <div className="px-6 pb-6"><ProjectPhases stage={p.stage} status={p.status} rows={stages} /></div>
          </Card>
          {edit && (
            <Card title="Manage">
              <div className="px-6 pb-6">
                <ProjectControls projectId={p.id} code={p.code} stage={p.stage} status={p.status} managerId={staff?.owner_id ?? null}
                  candidates={(cands ?? []) as { user_id: string; full_name: string }[]} dues={dues} />
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Client">
            <dl className="px-6 pb-5 m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[14px]">
              <dt className="text-muted">Company</dt><dd className="m-0">{company ? company.name : 'Not linked yet'}</dd>
              <dt className="text-muted">Account manager</dt><dd className="m-0" data-testid="tk-staff-manager">{managerName ?? (staff?.owner_id ? 'Former team member' : 'Not set')}{staff?.owner_set_at ? ` · since ${fmtDate(staff.owner_set_at)}` : ''}</dd>
              <dt className="text-muted">Came from</dt><dd className="m-0">{p.source === 'legacy_lead' ? 'The earlier Turnkey form' : p.source === 'web' ? 'Enquiry form' : 'Staff'}</dd>
            </dl>
          </Card>
          <Card title="What the client sent">
            <dl className="px-6 pb-5 m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[14px]">
              <dt className="text-muted">Catalogue</dt><dd className="m-0 mono text-[13px]">{p.catalogue_project_id ?? 'New project (not in the catalogue)'}</dd>
              <dt className="text-muted">Where</dt><dd className="m-0">{place || 'Not given'}</dd>
              <dt className="text-muted">Opening</dt><dd className="m-0">{p.target_open_on ? fmtDate(p.target_open_on) : 'Not given'}</dd>
              <dt className="text-muted">Space</dt><dd className="m-0">{areaLabel(p.floor_area_m2)}</dd>
              <dt className="text-muted">Budget</dt><dd className="m-0">{budgetLabel(p.budget_cents)}</dd>
              <dt className="text-muted">Plan</dt><dd className="m-0 whitespace-pre-line">{p.plan ?? 'Not given'}</dd>
            </dl>
          </Card>
          {lead && (
            <Card title={`Old lead ${lead.reference}`}>
              <dl className="px-6 pb-5 m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[14px]" data-testid="tk-staff-lead">
                <dt className="text-muted">Company</dt><dd className="m-0">{lead.company_name}</dd>
                <dt className="text-muted">Person</dt><dd className="m-0">{lead.contact_name}</dd>
                <dt className="text-muted">Email</dt><dd className="m-0">{lead.email}</dd>
                <dt className="text-muted">Phone</dt><dd className="m-0">{lead.phone ?? 'Not given'}</dd>
                <dt className="text-muted">Country</dt><dd className="m-0">{countryName(lead.country) ?? lead.country}</dd>
                <dt className="text-muted">Old status</dt><dd className="m-0">{lead.status} · {lead.kind === 'interest' ? 'Interest' : 'Quote request'} · {fmtDate(lead.created_at)}</dd>
              </dl>
            </Card>
          )}
          <Card title="History (the client sees this)">
            <div className="px-6 pb-6">
              <Timeline items={events.map((e) => ({ ...eventText(e), at: e.created_at, tone: 'done' as const }))} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
