import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Notice, PageHeader, StatusBadge, Timeline } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import { TK_PHASES, areaLabel, budgetLabel, feeStatusLabel, nextPhase, phaseLabel, tkPhase, tkStatus, type TkStageCode } from '@/lib/turnkey/format';
import { getTkClientProject } from '@/lib/turnkey/projects';
import { ProjectPhases, eventText } from '@/components/turnkey/project-phases';
import { TkFeeDecision } from '@/components/turnkey/fee-decision';
import { ProjectControls } from './project-controls';
import { ManagerPanel } from './manager-panel';
import { FeeProposeForm, FeeWithdrawButton } from './fee-propose';

export const metadata = { title: 'Turnkey client project' };

type Lead = { reference: string; kind: string; company_name: string; contact_name: string; email: string; phone: string | null; country: string; status: string; created_at: string };
type StaffFee = {
  id: string; stage: string; service_code: string | null; service_name: string | null; version: number; amount_cents: number; currency: string;
  starting_cents: number | null; needs_approval: boolean; status: string; note: string | null; proposed_by: string; proposed_by_name: string | null;
  proposed_at: string; approved_by: string | null; approved_by_name: string | null; approved_at: string | null; rejected_by_name: string | null;
  rejected_at: string | null; reject_reason: string | null; withdrawn_at: string | null; effective_from: string | null; superseded_at: string | null;
  document_id: string | null; document_number: string | null; document_status: string | null; paid_cents: number | null; paid: boolean;
};

/**
 * Admin › Turnkey › Client project (T2 + T3; design staff "Project", SetFee, AccountManagers, matched to the text). What
 * the client sent, the 8 phases with dates, the fees per phase with every version and who proposed / approved / rejected
 * it (staff only), the account manager and cover, and the history the client sees. Turnkey editors set fees and move
 * phases; a fee above 2× the starting fee waits for an admin who is not the proposer. Account managers see the projects
 * they manage.
 */
export default async function TurnkeyClientProjectStaffPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const s = await requireStaff('turnkey', 'view', `/admin/turnkey/projects/${code}`);
  if (!/^TKP-\d{5,}$/.test(code)) notFound();
  const d = await getTkClientProject(code);
  if (!d) notFound();
  const { project: p, stages, events, managerName, contact } = d;
  const sb = await createClient();
  const [{ data: staffRow }, { data: org }, { data: cands }, { data: feeRows }, { data: svcRows }] = await Promise.all([
    sb.from('tk_client_project_staff').select('owner_id, owner_set_at, created_by, legacy_lead_id, is_seed, cover_id, cover_from, cover_to').eq('project_id', p.id).maybeSingle(),
    p.org_id ? sb.from('organizations').select('id, name, country').eq('id', p.org_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.rpc('tk_manager_candidates'),
    sb.rpc('tk_list_project_fees', { p_project: p.id }),
    sb.from('tk_services').select('code, name, from_cents, approx').eq('active', true).order('sort'),
  ]);
  const staff = staffRow as { owner_id: string | null; owner_set_at: string | null; created_by: string | null; legacy_lead_id: string | null; is_seed: boolean; cover_id: string | null; cover_from: string | null; cover_to: string | null } | null;
  const { data: leadRow } = staff?.legacy_lead_id
    ? await sb.from('turnkey_leads').select('reference, kind, company_name, contact_name, email, phone, country, status, created_at').eq('lead_id', staff.legacy_lead_id).maybeSingle()
    : { data: null };
  const lead = leadRow as Lead | null;
  const company = org as { id: string; name: string; country: string | null } | null;
  const edit = can(s, 'turnkey', 'edit');
  const st = tkStatus(p.status);
  const dues = Object.fromEntries(stages.map((r) => [r.stage, r.due_on]));
  const place = [p.city, countryName(p.country)].filter(Boolean).join(', ');
  const fees = ((feeRows ?? []) as StaffFee[]).map((f) => ({ ...f, amount_cents: Number(f.amount_cents), starting_cents: f.starting_cents == null ? null : Number(f.starting_cents), paid_cents: f.paid_cents == null ? null : Number(f.paid_cents) }));
  const services = ((svcRows ?? []) as { code: string; name: string; from_cents: number; approx: boolean }[]).map((x) => ({ ...x, from_cents: Number(x.from_cents) }));
  const next = nextPhase(p.stage);
  const nextActive = next ? fees.filter((f) => f.stage === next.code && f.status === 'active') : [];
  const nextFee: 'paid' | 'approved' | 'pending' | 'none' = nextActive.length && nextActive.every((f) => f.paid) ? 'paid'
    : nextActive.length ? 'approved' : next && fees.some((f) => f.stage === next.code && f.status === 'pending_approval') ? 'pending' : 'none';
  const at = tkPhase(p.stage)?.n ?? 1;
  const defaultStage = (TK_PHASES.find((x) => x.paid && x.n > at && !fees.some((f) => f.stage === x.code && f.status === 'active'))?.code
    ?? TK_PHASES.find((x) => x.paid && x.n >= at)?.code ?? 'consultation') as TkStageCode;
  const coverOn = !!contact?.on_cover;

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
                <ProjectControls projectId={p.id} code={p.code} stage={p.stage} status={p.status} dues={dues} nextFee={nextFee} />
              </div>
            </Card>
          )}
          <Card title="Fees">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-fees">
              <p className="m-0 text-[13.5px] text-muted">A fee up to 2× the starting fee is active at once; above 2× (or with no starting fee) an admin who did not set it approves it first. The client sees a fee once it is active and pays its proforma before the phase starts. Notes, names and reasons here are staff only.</p>
              {fees.length === 0 && <p className="m-0 text-[15px]">No fees yet.</p>}
              {fees.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]">
                  {fees.map((f) => {
                    const ph = tkPhase(f.stage);
                    const fs = feeStatusLabel(f.status);
                    const own = f.proposed_by === s.userId;
                    return (
                      <li key={f.id} className="p-4 flex flex-col gap-2" data-testid={`tk-staff-fee-${f.stage}-v${f.version}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold">{f.service_name ?? `${ph?.name ?? f.stage} fee`} <span className="text-muted font-normal text-[13px]">· version {f.version}</span></div>
                            <div className="text-[13px] text-muted">{ph ? `Phase ${ph.n} · ${ph.name}` : f.stage}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="mono font-semibold">{money(f.amount_cents, f.currency)}</span>
                            <StatusBadge status={f.status} label={fs.label} tone={fs.tone} />
                          </div>
                        </div>
                        <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
                          <dt className="text-muted">Proposed</dt><dd className="m-0">{f.proposed_by_name ?? 'Former team member'} · {fmtDate(f.proposed_at, true)}</dd>
                          {f.note && <><dt className="text-muted">Note</dt><dd className="m-0">{f.note}</dd></>}
                          <dt className="text-muted">Starting fee</dt><dd className="m-0">{f.starting_cents ? `${money(f.starting_cents, f.currency)} (${(f.amount_cents / f.starting_cents).toFixed(1)}×)` : 'None'}</dd>
                          <dt className="text-muted">Approval</dt><dd className="m-0" data-testid={`tk-fee-approval-${f.id}`}>
                            {!f.needs_approval ? 'Not needed (within 2× the starting fee)'
                              : f.approved_by ? `${f.approved_by_name ?? 'Former team member'} · ${fmtDate(f.approved_at, true)}`
                              : f.status === 'pending_approval' ? 'Waiting for an admin' : '—'}
                          </dd>
                          {f.status === 'rejected' && <><dt className="text-muted">Rejected</dt><dd className="m-0 text-bad">{f.rejected_by_name ?? 'Former team member'} · {fmtDate(f.rejected_at, true)}: {f.reject_reason}</dd></>}
                          {f.withdrawn_at && <><dt className="text-muted">Withdrawn</dt><dd className="m-0">{fmtDate(f.withdrawn_at, true)}</dd></>}
                          {f.document_number && <><dt className="text-muted">Proforma</dt><dd className="m-0"><span className="mono">{f.document_number}</span> · {f.document_status === 'void' ? 'void (replaced)' : f.paid ? 'paid' : (f.paid_cents ?? 0) > 0 ? `part paid (${money(f.paid_cents, f.currency)})` : 'awaiting payment'}</dd></>}
                        </dl>
                        {f.status === 'pending_approval' && (
                          <div className="flex flex-wrap items-start gap-3">
                            {s.isAdmin && <TkFeeDecision feeId={f.id} code={p.code} canApprove={!own}
                              blockedReason={own ? 'You proposed this fee; another admin approves it.' : null} />}
                            {edit && <FeeWithdrawButton feeId={f.id} code={p.code} />}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {edit && p.org_id && p.status !== 'cancelled' && p.status !== 'completed' && (
                <FeeProposeForm projectId={p.id} code={p.code} defaultStage={defaultStage} services={services} />
              )}
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Client">
            <dl className="px-6 pb-5 m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[14px]">
              <dt className="text-muted">Company</dt><dd className="m-0">{company ? company.name : 'Not linked yet'}</dd>
              <dt className="text-muted">Account manager</dt><dd className="m-0" data-testid="tk-staff-manager">{contact?.usual_name ?? (staff?.owner_id ? 'Former team member' : managerName ?? 'Not set')}{staff?.owner_set_at ? ` · since ${fmtDate(staff.owner_set_at)}` : ''}</dd>
              {staff?.cover_id && (
                <><dt className="text-muted">Cover</dt><dd className="m-0" data-testid="tk-staff-cover">{contact?.cover_name ?? 'Former team member'} · {fmtDate(staff.cover_from)} to {fmtDate(staff.cover_to)}{coverOn ? ' · covering now' : ''}</dd></>
              )}
              <dt className="text-muted">Client sees</dt><dd className="m-0">{managerName ?? 'Not set'}</dd>
              <dt className="text-muted">Came from</dt><dd className="m-0">{p.source === 'legacy_lead' ? 'The earlier Turnkey form' : p.source === 'web' ? 'Enquiry form' : 'Staff'}</dd>
            </dl>
          </Card>
          {edit && (
            <Card title="Account manager and cover">
              <div className="px-6 pb-6">
                <ManagerPanel projectId={p.id} code={p.code} managerId={staff?.owner_id ?? null} coverId={staff?.cover_id ?? null}
                  coverFrom={staff?.cover_from ?? null} coverTo={staff?.cover_to ?? null} candidates={(cands ?? []) as { user_id: string; full_name: string }[]} />
              </div>
            </Card>
          )}
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
