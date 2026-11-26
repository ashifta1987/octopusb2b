import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Notice, PageHeader, StatusBadge, Timeline } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import {
  TK_FREE_DRAWING_VERSIONS, TK_PHASES, areaLabel, budgetLabel, drawingStatusLabel, extraVersionCents, feeStatusLabel, fileSize, nextPhase, phaseLabel,
  quoteMargin, quoteStatusLabel, tkPhase, tkStatus, type TkStageCode, TK_INSPECTION_KINDS, inspectionLabel, inspectionStatusLabel, psiGate, resultLabel,
  balanceGate, docKindLabel, docStatusLabel, shipmentGate, shipmentModeLabel, shipmentStatusLabel, tripStatusLabel, tripSummary,
} from '@/lib/turnkey/format';
import { getTkClientProject } from '@/lib/turnkey/projects';
import { getTkStaffDrawings, getTkStaffQuotes } from '@/lib/turnkey/work';
import { getTkStaffInspections } from '@/lib/turnkey/qc';
import { getTkStaffShipping, getTkStaffTrips } from '@/lib/turnkey/shipping';
import { BalanceIssueButton, DocumentActions, DocumentUpload, HandoverItemControls, HandoverItemForm, ShipmentCancel, ShipmentCreateForm, ShipmentEventForm } from '@/components/turnkey/shipping-staff';
import { PassportDeleteStaff, TripCancelStaff, TripCompleteForm, TripConfirmForm, TripFeeDecision, TripFeeForm } from '@/components/turnkey/trips-staff';
import { DrawingUpload, StaffDrawingComment, WaiveExtraFee } from '@/components/turnkey/drawing-staff';
import { ClientQuoteBuilder, CustomBrandedToggle, FactoryQuoteForm, QuoteDraftActions, QuoteWithdraw } from '@/components/turnkey/quote-staff';
import { InspectionCancel, InspectionCreateForm, InspectionFeeDecision, InspectionFeeForm, InspectionReview, InspectionSchedule, PsiOverride } from '@/components/turnkey/qc-staff';
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
 * Admin › Turnkey › Client project (T2 + T3 + T4; design staff "Project", SetFee, AccountManagers, Drawing, Quote). What
 * the client sent, the 8 phases with dates, the fees per phase with every version and who proposed / approved / rejected
 * it (staff only), the account manager and cover, and the history the client sees. Turnkey editors set fees and move
 * phases; a fee above 2× the starting fee waits for an admin who is not the proposer. Account managers see the projects
 * they manage. T4: layout drawing versions (upload to the private bucket, client review, extra versions after 3, admin
 * waiver) and quotes (factory quotes with supplier and cost, client quote versions with margin — both staff only here;
 * the client sees description, quantity, price, total and the deposit). T5: Production and QC — factory audits and
 * pre-shipment inspections (each with its own fee under the 2× rule, paid before it is scheduled; or a factory audit
 * paid with the phase fee), the inspector and date, the submitted report (staff see the factory, remarks and
 * signature), review and publish (never by the inspector), and the admin override of a failed pre-shipment inspection.
 * T6: the balance invoice (quote total − deposit; Shipment starts after it is paid), shipments with tracking events and
 * staff notes, shipping and final documents (drafts until shared), China visits (fee under the 2× rule against the list
 * price, itinerary after payment, guide and notes staff-only, passport copies only for staff with a need), and the
 * handover checklist. The client's sign-off completes the project.
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
  const [drw, qts, qc, ship, trp] = await Promise.all([getTkStaffDrawings(p.id), getTkStaffQuotes(p.id), getTkStaffInspections(p.id), getTkStaffShipping(p.id), getTkStaffTrips(p.id)]);
  const inspections = qc?.inspections ?? [];
  const psi = psiGate(inspections.map((i) => ({ kind: i.kind, round: i.round, status: i.status, result: i.report?.result ?? null, overridden: !!i.override_at })));
  const latestPsi = inspections.filter((i) => i.kind === 'pre_shipment' && i.status !== 'cancelled').sort((a, b) => b.round - a.round)[0] ?? null;
  const startFor = (kind: string) => { const svc = TK_INSPECTION_KINDS.find((k) => k.code === kind)?.service; const x = services.find((v) => v.code === svc); return x && x.from_cents > 0 ? x.from_cents : null; };
  const versions = drw?.data.versions ?? [];
  const extras = drw?.data.extras ?? [];
  const comments = drw?.data.comments ?? [];
  const latest = versions[0] ?? null;
  const nextVersion = (latest?.version ?? 0) + 1;
  const approved = versions.find((v) => v.status === 'approved') ?? null;
  const extraForNext = extras.find((e) => e.for_version === nextVersion) ?? null;
  const drawingFee = fees.find((f) => f.stage === 'design' && f.service_code === 'layout_drawing' && f.status === 'active') ?? null;
  const uploadBlocked = p.status !== 'open' ? 'Reopen the project to share drawings.'
    : p.stage !== 'design' ? 'Drawings are shared in the Design phase.'
    : approved ? `The client approved version ${approved.version}. No new version is needed.`
    : latest?.status === 'shared' ? `Waiting for the client to review version ${latest.version}.`
    : nextVersion > TK_FREE_DRAWING_VERSIONS && !extraForNext ? `Version ${nextVersion} is an extra version; it starts when the client asks for changes.`
    : extraForNext && extraForNext.status === 'open' && !extraForNext.paid ? `Version ${nextVersion} is an extra version: upload it after the client pays ${money(extraForNext.amount_cents)} (or an admin waives it).`
    : null;
  const quotes = qts?.quotes ?? [];
  const factoryQuotes = qts?.factory_quotes ?? [];
  const depositPct = qts?.deposit_pct ?? null;
  const draft = quotes.find((q) => q.status === 'draft') ?? null;
  const accepted = quotes.find((q) => q.status === 'accepted') ?? null;
  const factoryLines = factoryQuotes.flatMap((fq) => fq.lines.map((l) => ({ id: l.id, label: `${fq.supplier_name} · ${l.description} · ${money(l.unit_cost_cents)} each`, unit_cost_cents: Number(l.unit_cost_cents) })));
  const quoteStage = p.stage === 'sourcing' || p.stage === 'quote_deposit';
  const bal = balanceGate(ship?.balance_state);
  const shipments = ship?.shipments ?? [];
  const docsAll = ship?.documents ?? [];
  const items = ship?.items ?? [];
  const signoff = ship?.signoff ?? null;
  const shipGate = shipmentGate(shipments);
  const trips = trp?.trips ?? [];
  const openShipments = shipments.filter((x) => x.status !== 'cancelled');
  const releasedFinal = docsAll.filter((x) => x.section === 'handover' && x.status === 'released');
  const docEditor = edit && p.status !== 'cancelled' && (p.status !== 'completed' || s.isAdmin);
  const canIssueBalance = edit && p.status === 'open' && (p.stage === 'quote_deposit' || p.stage === 'production_qc') && ship?.balance_state === 'not_invoiced' && !!accepted?.deposit_paid;
  const balanceCentsDue = accepted ? Number(accepted.total_cents) - Number(accepted.deposit_cents ?? 0) : 0;
  const finish = p.stage === 'design'
    ? { done: !!approved, text: approved ? `Design: the client approved version ${approved.version}.` : 'Design is complete when the client approves a drawing version.' }
    : p.stage === 'quote_deposit'
      ? { done: !!accepted?.deposit_paid, text: !accepted ? 'Quote and deposit is complete when the client accepts a quote and pays the deposit.' : accepted.deposit_paid ? `Quote version ${accepted.version} accepted; the deposit is paid.` : `Quote version ${accepted.version} accepted; waiting for the deposit.` }
      : p.stage === 'production_qc' ? { done: psi.done && bal.done, text: psi.done ? `${psi.text} ${bal.text}` : psi.text }
      : p.stage === 'shipment' ? shipGate
      : null;

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
                <ProjectControls projectId={p.id} code={p.code} stage={p.stage} status={p.status} dues={dues} nextFee={nextFee} finish={finish} />
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
          <Card title="Layout drawings">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-drawings">
              <p className="m-0 text-[13.5px] text-muted">
                {TK_FREE_DRAWING_VERSIONS} versions are free; each extra version costs 50% of the drawing fee{drawingFee ? ` (${money(extraVersionCents(drawingFee.amount_cents))} now)` : ''} and is uploaded after the client pays it. Files stay private (short signed links).
              </p>
              {versions.length === 0 && <p className="m-0 text-[15px]">No drawings yet.</p>}
              {versions.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]">
                  {versions.map((v) => {
                    const ds = drawingStatusLabel(v.status, 'staff');
                    const url = drw?.urls.get(v.file_path) ?? null;
                    const vc = comments.filter((c) => c.version_id === v.id);
                    return (
                      <li key={v.id} className="p-4 flex flex-col gap-2" data-testid={`tk-staff-drawing-v${v.version}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold">Version {v.version} {v.version > TK_FREE_DRAWING_VERSIONS && <span className="text-[13px] text-muted font-normal">· extra version</span>}</div>
                            <div className="text-[13px] text-muted">{v.file_name} · {fileSize(v.size_bytes)} · {v.uploaded_by_name ?? 'Former team member'} · {fmtDate(v.shared_at, true)}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            {url && <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11">Open<span className="sr-only"> version {v.version}</span></a>}
                            <StatusBadge status={v.status} label={ds.label} tone={ds.tone} />
                          </div>
                        </div>
                        {v.message && <p className="m-0 text-[14px]">{v.message}</p>}
                        {vc.length > 0 && (
                          <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[13.5px]">
                            {vc.map((c) => <li key={c.id}><span className="font-semibold">{c.from_staff ? (c.author_name ?? 'Team') : 'Client'}{c.kind === 'changes' ? ' (changes asked)' : c.kind === 'approval' ? ' (approved)' : ''}:</span> {c.body} <span className="text-muted">· {fmtDate(c.created_at, true)}</span></li>)}
                          </ul>
                        )}
                        {edit && p.status === 'open' && <StaffDrawingComment versionId={v.id} code={p.code} />}
                      </li>
                    );
                  })}
                </ul>
              )}
              {extras.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col gap-3" data-testid="tk-staff-extras">
                  {extras.map((e) => (
                    <li key={e.id} className="border border-line rounded-[12px] p-4 flex flex-col gap-2" data-testid={`tk-staff-extra-v${e.for_version}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">Extra version {e.for_version} · {money(e.amount_cents)} <span className="text-muted font-normal text-[13px]">(50% of {money(e.base_cents)})</span></span>
                        <StatusBadge status={e.status === 'waived' ? 'waived' : e.paid ? 'paid' : 'awaiting_payment'} label={e.status === 'waived' ? 'Waived' : e.paid ? 'Paid' : 'Awaiting payment'} tone={e.status === 'waived' ? 'gray' : e.paid ? 'green' : 'amber'} />
                      </div>
                      <div className="text-[13px] text-muted">Proforma <span className="mono">{e.document_number ?? '—'}</span>{e.status === 'waived' ? ` · waived by ${e.waived_by_name ?? 'an admin'} on ${fmtDate(e.waived_at)}: ${e.waive_reason}` : ''}</div>
                      {s.isAdmin && e.status === 'open' && !e.paid && (e.paid_cents ?? 0) === 0 && <WaiveExtraFee extraId={e.id} code={p.code} version={e.for_version} />}
                    </li>
                  ))}
                </ul>
              )}
              {edit && p.org_id && p.stage === 'design' && <DrawingUpload projectId={p.id} code={p.code} nextVersion={nextVersion} blocked={uploadBlocked} />}
            </div>
          </Card>
          <Card title="Quotes (supplier, cost and margin: staff only)">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-quotes">
              <p className="m-0 text-[13.5px] text-muted">The client never sees factories, costs or margins: only the client quote lines, the total and the deposit ({depositPct ? `${depositPct}% from settings${qts?.custom_branded ? ' for custom / branded orders' : ''}` : 'deposit % not set yet — an admin sets it in Turnkey › Settings'}).</p>
              <CustomBrandedToggle projectId={p.id} code={p.code} custom={!!qts?.custom_branded} standardPct={qts?.deposit_pct_standard ?? null} customPct={qts?.deposit_pct_custom ?? null}
                canEdit={edit && p.status === 'open' && !accepted} />
              <section aria-labelledby="tk-fq-list-h" className="flex flex-col gap-3">
                <h3 id="tk-fq-list-h" className="m-0 text-[15px] font-semibold">Factory quotes</h3>
                {factoryQuotes.length === 0 && <p className="m-0 text-[14px]">None yet.</p>}
                {factoryQuotes.map((fq) => (
                  <div key={fq.id} className="border border-line rounded-[12px] p-4 flex flex-col gap-1 text-[13.5px]" data-testid="tk-staff-factory-quote">
                    <div className="font-semibold">{fq.supplier_name}{fq.supplier_ref ? ` · ${fq.supplier_ref}` : ''} · <span className="mono">{money(fq.total_cost_cents)}</span></div>
                    <div className="text-muted">{fq.created_by_name ?? 'Former team member'} · {fmtDate(fq.created_at)}{fq.valid_until ? ` · valid until ${fmtDate(fq.valid_until)}` : ''}{fq.notes ? ` · ${fq.notes}` : ''}</div>
                    <ul className="list-none m-0 p-0">{fq.lines.map((l) => <li key={l.id}>{l.line_no}. {l.description} · {l.qty} × {money(l.unit_cost_cents)} = {money(l.total_cost_cents)}</li>)}</ul>
                  </div>
                ))}
                {edit && p.status !== 'cancelled' && p.status !== 'completed' && <FactoryQuoteForm projectId={p.id} code={p.code} />}
              </section>
              <section aria-labelledby="tk-cq-list-h" className="flex flex-col gap-3">
                <h3 id="tk-cq-list-h" className="m-0 text-[15px] font-semibold">Client quote versions</h3>
                {quotes.length === 0 && <p className="m-0 text-[14px]">None yet.</p>}
                {quotes.map((q) => {
                  const qs = quoteStatusLabel(q.status, 'staff');
                  const m = quoteMargin(Number(q.total_cents), q.cost_cents == null ? null : Number(q.cost_cents), q.cost_complete);
                  return (
                    <div key={q.id} className="border border-line rounded-[12px] p-4 flex flex-col gap-2" data-testid={`tk-staff-quote-v${q.version}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">Version {q.version} · <span className="mono">{money(q.total_cents)}</span></span>
                        <StatusBadge status={q.status} label={qs.label} tone={qs.tone} />
                      </div>
                      <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[13px]">
                        <dt className="text-muted">Margin</dt><dd className="m-0" data-testid={`tk-staff-margin-v${q.version}`}>{m ? `${money(m.cents)}${m.pct != null ? ` (${m.pct}%)` : ''}` : 'Unknown (a line has no cost)'}</dd>
                        <dt className="text-muted">Deposit</dt><dd className="m-0">{q.deposit_pct ? `${q.deposit_pct}% · ${money(q.deposit_cents)}` : 'Fixed when sent'}</dd>
                        <dt className="text-muted">Made</dt><dd className="m-0">{q.created_by_name ?? 'Former team member'} · {fmtDate(q.created_at, true)}{q.sent_at ? ` · sent by ${q.sent_by_name ?? 'a former team member'} ${fmtDate(q.sent_at, true)}` : ''}</dd>
                        {q.client_comment && <><dt className="text-muted">Client</dt><dd className="m-0">{q.client_comment}</dd></>}
                        {q.document_number && <><dt className="text-muted">Deposit proforma</dt><dd className="m-0"><span className="mono">{q.document_number}</span> · {q.deposit_paid ? 'paid' : (q.paid_cents ?? 0) > 0 ? `part paid (${money(q.paid_cents)})` : 'awaiting payment'}</dd></>}
                      </dl>
                      <ul className="list-none m-0 p-0 text-[13px]">
                        {q.lines.map((l) => <li key={l.id}>{l.line_no}. {l.description} · {l.qty} × {money(l.unit_price_cents)} = {money(l.total_cents)} <span className="text-muted">· cost {l.cost_cents != null ? money(l.cost_cents) : 'unknown'}{l.supplier_name ? ` (${l.supplier_name})` : ''}</span></li>)}
                      </ul>
                      {edit && q.status === 'draft' && <QuoteDraftActions quoteId={q.id} code={p.code} canSend={!!depositPct && quoteStage && p.status === 'open'} />}
                      {edit && q.status === 'sent' && <QuoteWithdraw quoteId={q.id} code={p.code} />}
                    </div>
                  );
                })}
                {edit && p.status === 'open' && quoteStage && !accepted && (
                  <ClientQuoteBuilder projectId={p.id} code={p.code} factoryLines={factoryLines} depositPct={depositPct}
                    initial={draft ? { message: draft.message ?? '', validUntil: draft.valid_until ?? '', lines: draft.lines.map((l) => ({ description: l.description, qty: String(l.qty), unitPriceUsd: (Number(l.unit_price_cents) / 100).toFixed(2), factoryLineId: l.factory_line_id ?? '', unitCostUsd: l.factory_line_id || l.unit_cost_cents == null ? '' : (Number(l.unit_cost_cents) / 100).toFixed(2) })) } : null} />
                )}
                {accepted && <p className="m-0 text-[13.5px] text-muted">Version {accepted.version} is accepted. The balance is invoiced below (Balance and shipment).</p>}
              </section>
            </div>
          </Card>
          <Card title="Production and QC: inspections">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-qc">
              <p className="m-0 text-[13.5px] text-muted">Each inspection is paid before it starts: set its fee (above 2× the starting fee an admin approves it), the client pays, then schedule the inspector. The factory, brief, remarks and names are staff only; the client sees the published report. Production and QC is complete when the latest pre-shipment inspection passed and its report is published.</p>
              <p className={`m-0 text-[13.5px] ${psi.done ? 'text-ok' : 'text-warn'}`} data-testid="tk-qc-gate">{psi.text}</p>
              {inspections.length === 0 && <p className="m-0 text-[15px]">No inspections yet.</p>}
              {inspections.map((i) => {
                const tid = `${i.kind}-${i.round}`;
                const is = inspectionStatusLabel(i.status, 'staff');
                const active = i.fees.find((f) => f.status === 'active') ?? null;
                const pendingFee = i.fees.find((f) => f.status === 'pending_approval') ?? null;
                const res = i.report ? resultLabel(i.report.result) : null;
                const ownReport = i.inspector_id === s.userId;
                const blocked = p.status !== 'open' ? 'Reopen the project to schedule.'
                  : i.paid ? null
                  : i.phase_fee ? 'The Production and QC fee is not paid yet.'
                  : active ? `Scheduled after the client pays ${money(active.amount_cents)} (proforma ${active.document_number ?? '—'}).`
                  : pendingFee ? 'The fee is waiting for an admin’s approval.'
                  : 'Set the fee first; the inspection is scheduled after the client pays it.';
                const canOverride = s.isAdmin && i.kind === 'pre_shipment' && i.status === 'published' && i.report?.result === 'fail' && !i.override_at
                  && latestPsi?.id === i.id && !ownReport;
                return (
                  <section key={i.id} aria-labelledby={`tk-qc-h-${i.id}`} className="border border-line rounded-[12px] p-4 flex flex-col gap-3" data-testid={`tk-staff-inspection-${tid}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={`tk-qc-h-${i.id}`} className="m-0 text-[15px] font-semibold">{inspectionLabel(i.kind, i.round)}</h3>
                      <div className="flex items-center gap-2">
                        {res && i.status === 'published' && <StatusBadge status={i.report!.result} label={res.label} tone={res.tone} />}
                        <StatusBadge status={i.status} label={is.label} tone={is.tone} />
                      </div>
                    </div>
                    <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
                      <dt className="text-muted">Factory</dt><dd className="m-0" data-testid={`tk-qc-factory-${tid}`}>{i.factory_name}{i.factory_address ? ` · ${i.factory_address}` : ''}</dd>
                      {i.brief && <><dt className="text-muted">Brief</dt><dd className="m-0 whitespace-pre-line">{i.brief}</dd></>}
                      <dt className="text-muted">Planned</dt><dd className="m-0">{i.created_by_name ?? 'Former team member'} · {fmtDate(i.created_at, true)}</dd>
                      <dt className="text-muted">Fee</dt>
                      <dd className="m-0" data-testid={`tk-qc-fee-${tid}`}>
                        {i.phase_fee ? `Production and QC fee ${money(i.phase_fee.amount_cents)} · ${i.phase_fee.paid ? 'paid' : 'not paid yet'}`
                          : active ? `${money(active.amount_cents)} · proforma ${active.document_number ?? '—'} · ${active.paid ? 'paid' : (active.paid_cents ?? 0) > 0 ? `part paid (${money(active.paid_cents)})` : 'awaiting payment'}`
                          : pendingFee ? `${money(pendingFee.amount_cents)} · waiting for an admin` : 'Not set'}
                      </dd>
                      {i.inspector_name && <><dt className="text-muted">Inspector</dt><dd className="m-0">{i.inspector_name}{i.scheduled_on ? ` · ${fmtDate(i.scheduled_on)}` : ''}</dd></>}
                      {i.returned_reason && i.status === 'in_progress' && <><dt className="text-muted">Returned</dt><dd className="m-0">{i.returned_reason}</dd></>}
                      {i.status === 'cancelled' && <><dt className="text-muted">Cancelled</dt><dd className="m-0">{fmtDate(i.cancelled_at, true)}: {i.cancel_reason}</dd></>}
                      {i.override_at && <><dt className="text-muted">Override</dt><dd className="m-0" data-testid={`tk-qc-override-${tid}`}>{i.override_by_name ?? 'An admin'} · {fmtDate(i.override_at, true)}: {i.override_reason}</dd></>}
                    </dl>
                    {i.fees.length > 0 && (
                      <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[12.5px] text-muted">
                        {i.fees.map((f) => (
                          <li key={f.id}>Version {f.version}: {money(f.amount_cents)} · {feeStatusLabel(f.status).label} · {f.proposed_by_name ?? 'Former team member'} {fmtDate(f.proposed_at, true)}
                            {f.starting_cents ? ` · ${(f.amount_cents / f.starting_cents).toFixed(1)}× the starting fee` : ''}
                            {f.approved_by_name ? ` · approved by ${f.approved_by_name}` : ''}{f.reject_reason ? ` · rejected: ${f.reject_reason}` : ''}{f.note ? ` · note: ${f.note}` : ''}</li>
                        ))}
                      </ul>
                    )}
                    {pendingFee && (edit || s.isAdmin) && (
                      <InspectionFeeDecision feeId={pendingFee.id} code={p.code} isAdmin={s.isAdmin} canApprove={pendingFee.proposed_by !== s.userId} canWithdraw={edit} />
                    )}
                    {edit && i.status === 'planned' && !i.phase_fee && !(active && (active.paid || (active.paid_cents ?? 0) > 0)) && (
                      <InspectionFeeForm inspectionId={i.id} code={p.code} startingCents={startFor(i.kind)} testId={tid} />
                    )}
                    {edit && (i.status === 'planned' || i.status === 'scheduled') && (
                      <InspectionSchedule inspectionId={i.id} code={p.code} inspectors={qc?.inspectors ?? []} currentInspector={i.inspector_id} currentDate={i.scheduled_on}
                        blocked={blocked} testId={tid} />
                    )}
                    {i.report && (i.status === 'submitted' || i.status === 'published') && (
                      <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid={`tk-qc-report-${tid}`}>
                        <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[13px]">
                          <dt className="text-muted">Result</dt><dd className="m-0 font-semibold">{res?.label}</dd>
                          <dt className="text-muted">Lot / sample</dt><dd className="m-0 mono">{i.report.lot_size} / {i.report.sample_size}</dd>
                          <dt className="text-muted">Defects</dt><dd className="m-0">Critical {i.report.critical_defects} · major {i.report.major_defects} · minor {i.report.minor_defects}</dd>
                          {i.report.remarks && <><dt className="text-muted">Remarks (staff)</dt><dd className="m-0 whitespace-pre-line">{i.report.remarks}</dd></>}
                          <dt className="text-muted">Signed</dt><dd className="m-0">{i.report.signed_name} · {fmtDate(i.report.submitted_at, true)}</dd>
                          {i.report.client_summary && <><dt className="text-muted">Client summary</dt><dd className="m-0 whitespace-pre-line">{i.report.client_summary}</dd></>}
                          {i.published_at && <><dt className="text-muted">Published</dt><dd className="m-0">{i.published_by_name ?? 'Former team member'} · {fmtDate(i.published_at, true)}</dd></>}
                        </dl>
                        <ul className="list-none m-0 p-0 flex flex-col gap-0.5 text-[13px]">
                          {i.items.map((it) => <li key={it.id}>{it.position}. {it.label}: <span className="font-semibold">{it.answer === 'na' ? 'N/A' : it.answer === 'fail' ? 'Fail' : it.answer === 'pass' ? 'Pass' : '—'}</span>{it.remark ? <span className="text-muted"> · {it.remark}</span> : null}</li>)}
                        </ul>
                        {i.photos.length > 0 && (
                          <ul className="list-none m-0 p-0 flex flex-wrap gap-2" aria-label={`Photos of ${inspectionLabel(i.kind, i.round)}`}>
                            {i.photos.map((ph, n) => (
                              <li key={ph.id} className="flex flex-col items-center gap-1 text-[11.5px] text-muted">
                                {ph.url ? <a href={ph.url} target="_blank" rel="noopener noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={ph.url} alt={`Inspection photo ${n + 1}`} className="w-20 h-20 object-cover rounded-[8px] border border-line" />
                                </a> : <span>Photo {n + 1}</span>}
                                {i.status === 'published' && <span>{ph.client_visible ? 'Client sees it' : 'Hidden'}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {edit && i.status === 'submitted' && p.status === 'open' && (
                          <InspectionReview inspectionId={i.id} code={p.code} ownReport={ownReport} testId={tid}
                            photos={i.photos.map((ph, n) => ({ id: ph.id, url: ph.url ?? null, n: n + 1 }))} />
                        )}
                      </div>
                    )}
                    {canOverride && <PsiOverride inspectionId={i.id} code={p.code} testId={tid} />}
                    {edit && (i.status === 'planned' || i.status === 'scheduled') && <InspectionCancel inspectionId={i.id} code={p.code} testId={tid} />}
                  </section>
                );
              })}
              {edit && p.org_id && p.status === 'open' && p.stage === 'production_qc' && (
                <InspectionCreateForm projectId={p.id} code={p.code} phaseFeeAvailable={!!qc?.phase_fee_available} />
              )}
              {p.stage !== 'production_qc' && inspections.length === 0 && <p className="m-0 text-[13px] text-muted">Inspections are planned in the Production and QC phase.</p>}
            </div>
          </Card>

          <Card title="Balance and shipment">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-shipping">
              <section aria-labelledby="tk-bal-h" className="flex flex-col gap-2" data-testid="tk-staff-balance">
                <h3 id="tk-bal-h" className="m-0 text-[15px] font-semibold">Balance</h3>
                <p className={`m-0 text-[13.5px] ${bal.done ? 'text-ok' : 'text-warn'}`} data-testid="tk-balance-gate">{bal.text}</p>
                {ship?.balance && (
                  <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[13px]">
                    <dt className="text-muted">Balance</dt><dd className="m-0"><span className="mono font-semibold">{money(ship.balance.amount_cents)}</span> · quote version {ship.balance.quote_version} ({money(ship.balance.total_cents)} − deposit {money(ship.balance.deposit_cents)})</dd>
                    <dt className="text-muted">Proforma</dt><dd className="m-0" data-testid="tk-staff-balance-state"><span className="mono">{ship.balance.document_number ?? '—'}</span> · {ship.balance.paid ? 'paid' : (ship.balance.paid_cents ?? 0) > 0 ? `part paid (${money(ship.balance.paid_cents)})` : 'awaiting payment'}</dd>
                    <dt className="text-muted">Issued</dt><dd className="m-0">{ship.balance.issued_by_name ?? 'Former team member'} · {fmtDate(ship.balance.created_at, true)}</dd>
                  </dl>
                )}
                {canIssueBalance && <BalanceIssueButton projectId={p.id} code={p.code} label={`Issue the balance invoice (${money(balanceCentsDue)})`} />}
              </section>
              <section aria-labelledby="tk-sh-list-h" className="flex flex-col gap-3">
                <h3 id="tk-sh-list-h" className="m-0 text-[15px] font-semibold">Shipments</h3>
                <p className="m-0 text-[13px] text-muted">The client sees the carrier, references, dates, status and tracking events; staff notes, reasons and names stay here. {shipGate.text}</p>
                {shipments.length === 0 && <p className="m-0 text-[14px]">{p.stage === 'shipment' ? 'No shipment booked yet.' : 'Shipments are booked in the Shipment phase, after the balance is paid.'}</p>}
                {shipments.map((sh) => {
                  const ss = shipmentStatusLabel(sh.status);
                  const shDocs = docsAll.filter((x) => x.shipment_id === sh.id);
                  return (
                    <section key={sh.id} aria-labelledby={`tk-sh-h-${sh.id}`} className="border border-line rounded-[12px] p-4 flex flex-col gap-3" data-testid={`tk-staff-shipment-${sh.seq}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 id={`tk-sh-h-${sh.id}`} className="m-0 text-[15px] font-semibold">Shipment {sh.seq} · {shipmentModeLabel(sh.mode)} · {sh.carrier}</h4>
                        <StatusBadge status={sh.status} label={ss.label} tone={ss.tone} />
                      </div>
                      <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[13px]">
                        {sh.booking_ref && <><dt className="text-muted">Booking</dt><dd className="m-0 mono">{sh.booking_ref}</dd></>}
                        {sh.container_no && <><dt className="text-muted">Container</dt><dd className="m-0 mono">{sh.container_no}</dd></>}
                        {sh.tracking_no && <><dt className="text-muted">Tracking</dt><dd className="m-0 mono">{sh.tracking_no}</dd></>}
                        {(sh.origin || sh.destination) && <><dt className="text-muted">Route</dt><dd className="m-0">{sh.origin ?? '—'} → {sh.destination ?? '—'}</dd></>}
                        {(sh.etd || sh.eta) && <><dt className="text-muted">ETD / ETA</dt><dd className="m-0">{sh.etd ? fmtDate(sh.etd) : '—'} / {sh.eta ? fmtDate(sh.eta) : '—'}</dd></>}
                        {sh.staff_note && <><dt className="text-muted">Staff note</dt><dd className="m-0 whitespace-pre-line">{sh.staff_note}</dd></>}
                        <dt className="text-muted">Booked</dt><dd className="m-0">{sh.created_by_name ?? 'Former team member'} · {fmtDate(sh.created_at, true)}</dd>
                        {sh.cancelled_at && <><dt className="text-muted">Cancelled</dt><dd className="m-0">{fmtDate(sh.cancelled_at, true)}: {sh.cancel_reason}</dd></>}
                      </dl>
                      {sh.events.length > 0 && (
                        <ol className="list-none m-0 p-0 flex flex-col gap-1 text-[13px]" aria-label={`Tracking of shipment ${sh.seq}`}>
                          {sh.events.map((ev) => <li key={ev.id}><span className="mono text-muted">{fmtDate(ev.happened_at, true)}</span> · {ev.status_to ? <span className="font-semibold">{shipmentStatusLabel(ev.status_to).label}: </span> : null}{ev.description}{ev.location ? ` (${ev.location})` : ''} <span className="text-muted">· {ev.created_by_name ?? 'Former team member'}</span></li>)}
                        </ol>
                      )}
                      {shDocs.length > 0 && (
                        <ul className="list-none m-0 p-0 flex flex-col gap-2" aria-label={`Documents of shipment ${sh.seq}`}>
                          {shDocs.map((d) => { const ds = docStatusLabel(d.status); const tid = `${d.kind}-${d.id.slice(0, 8)}`; return (
                            <li key={d.id} className="border border-line rounded-[10px] p-3 flex flex-col gap-2" data-testid={`tk-staff-doc-${d.kind}`}>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                                <span><span className="font-semibold">{docKindLabel(d.kind)}</span>{d.title !== docKindLabel(d.kind) ? ` · ${d.title}` : ''} <span className="text-muted">· {d.file_name} · {fileSize(d.size_bytes)} · {d.uploaded_by_name ?? 'Former team member'}</span></span>
                                <span className="flex items-center gap-2">{d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11">Open<span className="sr-only"> {d.title}</span></a>}<StatusBadge status={d.status} label={ds.label} tone={ds.tone} /></span>
                              </div>
                              {d.withdraw_reason && <p className="m-0 text-[12.5px] text-muted">Withdrawn {fmtDate(d.withdrawn_at, true)}: {d.withdraw_reason}</p>}
                              {docEditor && d.status !== 'withdrawn' && <DocumentActions documentId={d.id} code={p.code} status={d.status} testId={tid} />}
                            </li>); })}
                        </ul>
                      )}
                      {edit && p.status === 'open' && p.stage === 'shipment' && !['delivered', 'cancelled'].includes(sh.status) && <ShipmentEventForm shipmentId={sh.id} code={p.code} status={sh.status} seq={sh.seq} />}
                      {edit && p.status === 'open' && sh.status === 'booked' && <ShipmentCancel shipmentId={sh.id} code={p.code} seq={sh.seq} />}
                    </section>
                  );
                })}
                {edit && p.org_id && p.status === 'open' && p.stage === 'shipment' && <ShipmentCreateForm projectId={p.id} code={p.code} />}
                {docEditor && openShipments.length > 0 && (p.stage === 'shipment' || p.stage === 'handover' || p.status === 'completed') && (
                  <DocumentUpload projectId={p.id} code={p.code} section="shipment" shipments={openShipments.map((x) => ({ id: x.id, seq: x.seq }))} />
                )}
              </section>
            </div>
          </Card>
          <Card title="China visits (TripManager)">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-trips">
              <p className="m-0 text-[13.5px] text-muted">The client asks for a visit on their project page; the list price comes from the services list. Set the exact fee (above 2× the list price an admin approves it); confirm the itinerary after the client pays. Guide and notes are staff only. Passport copies are shown only to Turnkey editors (2FA) and the project’s account manager{trp?.passport_access ? '' : ' — you can see how many there are, not the copies'}.</p>
              {trips.length === 0 && <p className="m-0 text-[14px]">No visit requested.</p>}
              {trips.map((t) => {
                const ts = tripStatusLabel(t.status, 'staff');
                const active = t.fees.find((f) => f.status === 'active') ?? null;
                const pendingFee = t.fees.find((f) => f.status === 'pending_approval') ?? null;
                const blocked = !active ? 'Set the trip fee first; the itinerary is confirmed after the client pays it.' : !t.paid ? `Confirmed after the client pays ${money(active.amount_cents)} (proforma ${active.document_number ?? '—'}).` : null;
                return (
                  <section key={t.id} aria-labelledby={`tk-trip-h-${t.id}`} className="border border-line rounded-[12px] p-4 flex flex-col gap-3" data-testid={`tk-staff-trip-${t.seq}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={`tk-trip-h-${t.id}`} className="m-0 text-[15px] font-semibold">Visit {t.seq} · {tripSummary(t, (x) => fmtDate(x))}</h3>
                      <StatusBadge status={t.status} label={ts.label} tone={ts.tone} />
                    </div>
                    <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[13px]">
                      <dt className="text-muted">Extras</dt><dd className="m-0">{[t.visa_letters ? `${t.visa_letters} visa letter(s)` : null, t.car_days ? `car and driver ${t.car_days} day(s)` : null, t.airport_pickups ? `${t.airport_pickups} airport pick-up(s)` : null, t.hotel_help ? 'hotel help' : null].filter(Boolean).join(' · ') || 'None'}</dd>
                      <dt className="text-muted">List price</dt><dd className="m-0" data-testid={`tk-staff-trip-list-${t.seq}`}><span className="mono">{money(t.list_cents)}</span></dd>
                      {t.client_message && <><dt className="text-muted">Client</dt><dd className="m-0">{t.client_message}</dd></>}
                      <dt className="text-muted">Asked by</dt><dd className="m-0">{t.requested_by_name ?? 'The client'} · {fmtDate(t.created_at, true)}</dd>
                      <dt className="text-muted">Fee</dt><dd className="m-0" data-testid={`tk-staff-trip-fee-${t.seq}`}>{active ? `${money(active.amount_cents)} · proforma ${active.document_number ?? '—'} · ${active.paid ? 'paid' : (active.paid_cents ?? 0) > 0 ? `part paid (${money(active.paid_cents)})` : 'awaiting payment'}` : pendingFee ? `${money(pendingFee.amount_cents)} · waiting for an admin` : 'Not set'}</dd>
                      {t.guide_name && <><dt className="text-muted">Guide</dt><dd className="m-0">{t.guide_name}</dd></>}
                      {t.staff_notes && <><dt className="text-muted">Staff notes</dt><dd className="m-0 whitespace-pre-line">{t.staff_notes}</dd></>}
                      {t.confirmed_at && <><dt className="text-muted">Confirmed</dt><dd className="m-0">{t.confirmed_by_name ?? 'Former team member'} · {fmtDate(t.confirmed_at, true)}</dd></>}
                      {t.cancelled_at && <><dt className="text-muted">Cancelled</dt><dd className="m-0">{fmtDate(t.cancelled_at, true)}: {t.cancel_reason}</dd></>}
                      <dt className="text-muted">Passports</dt>
                      <dd className="m-0" data-testid={`tk-staff-passports-${t.seq}`}>
                        {t.passports === null ? `${t.passports_count} of ${t.travellers} uploaded (copies hidden: Turnkey editors and the account manager only)` : t.passports.length === 0 ? `None yet (0 of ${t.travellers})` : (
                          <ul className="list-none m-0 p-0 flex flex-col gap-1">
                            {t.passports.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2">Traveller {x.position}: {x.full_name} {x.url && <a href={x.url} target="_blank" rel="noopener noreferrer" className="underline" data-testid={`tk-staff-passport-${x.position}`}>View copy<span className="sr-only"> of traveller {x.position}</span></a>}{edit && <PassportDeleteStaff travellerId={x.id} code={p.code} position={x.position} />}</li>)}
                          </ul>
                        )}
                      </dd>
                    </dl>
                    {t.itinerary && <div className="text-[13.5px]"><span className="font-semibold">Itinerary (client sees it):</span><p className="m-0 whitespace-pre-line">{t.itinerary}</p></div>}
                    {t.trip_report && <div className="text-[13.5px]"><span className="font-semibold">Trip report:</span><p className="m-0 whitespace-pre-line">{t.trip_report}</p></div>}
                    {t.fees.length > 0 && (
                      <ul className="list-none m-0 p-0 flex flex-col gap-1 text-[12.5px] text-muted">
                        {t.fees.map((f) => <li key={f.id}>Version {f.version}: {money(f.amount_cents)} · {feeStatusLabel(f.status).label} · {f.proposed_by_name ?? 'Former team member'} {fmtDate(f.proposed_at, true)} · {(f.amount_cents / f.starting_cents).toFixed(1)}× the list price{f.approved_by_name ? ` · approved by ${f.approved_by_name}` : ''}{f.reject_reason ? ` · rejected: ${f.reject_reason}` : ''}{f.note ? ` · note: ${f.note}` : ''}</li>)}
                      </ul>
                    )}
                    {pendingFee && (edit || s.isAdmin) && <TripFeeDecision feeId={pendingFee.id} code={p.code} isAdmin={s.isAdmin} canApprove={pendingFee.proposed_by !== s.userId} canWithdraw={edit} />}
                    {edit && p.status === 'open' && t.status === 'requested' && !(active && (active.paid || (active.paid_cents ?? 0) > 0)) && <TripFeeForm tripId={t.id} code={p.code} listCents={t.list_cents} seq={t.seq} />}
                    {edit && p.status === 'open' && (t.status === 'requested' || t.status === 'confirmed') && (
                      <TripConfirmForm tripId={t.id} code={p.code} seq={t.seq} blocked={blocked} initial={{ itinerary: t.itinerary ?? '', guide: t.guide_name ?? '', notes: t.staff_notes ?? '' }} />
                    )}
                    {edit && p.status === 'open' && t.status === 'confirmed' && <TripCompleteForm tripId={t.id} code={p.code} seq={t.seq} />}
                    {edit && p.status === 'open' && (t.status === 'requested' || t.status === 'confirmed') && !(active && (active.paid_cents ?? 0) > 0) && <TripCancelStaff tripId={t.id} code={p.code} seq={t.seq} />}
                  </section>
                );
              })}
            </div>
          </Card>
          <Card title="Handover">
            <div className="px-6 pb-6 flex flex-col gap-5" data-testid="tk-staff-handover">
              <p className="m-0 text-[13.5px] text-muted">Prepare the final-documents checklist and share the final documents; the client signs the handover on their project page when every line is ready. Signing completes the project; afterwards only admins can add documents.</p>
              {signoff && <p className="m-0 text-[14px] text-ok font-semibold" data-testid="tk-staff-signoff">Signed by {signoff.signed_name} on {fmtDate(signoff.signed_at, true)}{signoff.signed_by_email ? ` (account ${signoff.signed_by_email})` : ''}.{signoff.client_comment ? ` Comment: ${signoff.client_comment}` : ''}</p>}
              {items.length === 0 && <p className="m-0 text-[14px]">{p.stage === 'handover' ? 'No checklist lines yet.' : 'The checklist is prepared in the Handover phase.'}</p>}
              {items.length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]">
                  {items.map((it) => { const doc = docsAll.find((x) => x.id === it.document_id); return (
                    <li key={it.id} className="p-4 flex flex-col gap-2" data-testid={`tk-staff-ho-item-${it.position}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{it.position}. {it.label}{doc ? <span className="font-normal text-muted"> · {doc.title}</span> : null}</span>
                        <StatusBadge status={it.done_at ? 'done' : 'open'} label={it.done_at ? 'Ready' : 'Not ready'} tone={it.done_at ? 'green' : 'amber'} />
                      </div>
                      {it.done_at && <p className="m-0 text-[12.5px] text-muted">{it.done_by_name ?? 'Former team member'} · {fmtDate(it.done_at, true)}</p>}
                      {edit && p.status === 'open' && p.stage === 'handover' && !signoff && <HandoverItemControls itemId={it.id} code={p.code} done={!!it.done_at} position={it.position} documents={releasedFinal.map((x) => ({ id: x.id, title: x.title }))} />}
                    </li>); })}
                </ul>
              )}
              {docsAll.filter((x) => x.section === 'handover').length > 0 && (
                <ul className="list-none m-0 p-0 flex flex-col gap-2" aria-label="Final documents">
                  {docsAll.filter((x) => x.section === 'handover').map((d) => { const ds = docStatusLabel(d.status); const tid = `${d.kind}-${d.id.slice(0, 8)}`; return (
                    <li key={d.id} className="border border-line rounded-[10px] p-3 flex flex-col gap-2" data-testid={`tk-staff-doc-${d.kind}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                        <span><span className="font-semibold">{docKindLabel(d.kind)}</span>{d.title !== docKindLabel(d.kind) ? ` · ${d.title}` : ''} <span className="text-muted">· {d.file_name} · {fileSize(d.size_bytes)} · {d.uploaded_by_name ?? 'Former team member'}</span></span>
                        <span className="flex items-center gap-2">{d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11">Open<span className="sr-only"> {d.title}</span></a>}<StatusBadge status={d.status} label={ds.label} tone={ds.tone} /></span>
                      </div>
                      {d.withdraw_reason && <p className="m-0 text-[12.5px] text-muted">Withdrawn {fmtDate(d.withdrawn_at, true)}: {d.withdraw_reason}</p>}
                      {docEditor && d.status !== 'withdrawn' && <DocumentActions documentId={d.id} code={p.code} status={d.status} testId={tid} />}
                    </li>); })}
                </ul>
              )}
              {docEditor && (p.stage === 'handover' || p.status === 'completed') && <DocumentUpload projectId={p.id} code={p.code} section="handover" shipments={[]} />}
              {edit && p.status === 'open' && p.stage === 'handover' && !signoff && <HandoverItemForm projectId={p.id} code={p.code} />}
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
