/**
 * ODS T9 · Turnkey project record — the panels (server-safe, props only). Content, conditions and gates are TODAY's
 * (app/admin/turnkey/projects/[code]/page.tsx), moved into ODS panels per tab; every control is today's client component
 * calling today's server action (components/turnkey/*, project-controls, manager-panel, fee-propose). Only layout changed.
 */
import type { ReactNode } from 'react';
import { ActivityFeed, EmptyState, StatusPill } from '@octopus/ui';
import { fmtDate, money } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import {
  TK_FREE_DRAWING_VERSIONS, areaLabel, budgetLabel, docKindLabel, docStatusLabel, drawingStatusLabel, extraVersionCents, feeStatusLabel, fileSize, inspectionLabel,
  inspectionStatusLabel, quoteMargin, quoteStatusLabel, resultLabel, shipmentModeLabel, shipmentStatusLabel, tkPhase, tripStatusLabel, tripSummary,
} from '@/lib/turnkey/format';
import { eventText } from '@/components/turnkey/project-phases';
import { BalanceIssueButton, DocumentActions, DocumentUpload, HandoverItemControls, HandoverItemForm, ShipmentCancel, ShipmentCreateForm, ShipmentEventForm } from '@/components/turnkey/shipping-staff';
import { PassportDeleteStaff, TripCancelStaff, TripCompleteForm, TripConfirmForm, TripFeeDecision, TripFeeForm } from '@/components/turnkey/trips-staff';
import { DrawingUpload, StaffDrawingComment, WaiveExtraFee } from '@/components/turnkey/drawing-staff';
import { ClientQuoteBuilder, CustomBrandedToggle, FactoryQuoteForm, QuoteDraftActions, QuoteWithdraw } from '@/components/turnkey/quote-staff';
import { InspectionCancel, InspectionCreateForm, InspectionFeeDecision, InspectionFeeForm, InspectionReview, InspectionSchedule, PsiOverride } from '@/components/turnkey/qc-staff';
import { TkFeeDecision } from '@/components/turnkey/fee-decision';
import { ProjectControls } from '@/app/admin/turnkey/projects/[code]/project-controls';
import { ManagerPanel } from '@/app/admin/turnkey/projects/[code]/manager-panel';
import { FeeProposeForm, FeeWithdrawButton } from '@/app/admin/turnkey/projects/[code]/fee-propose';
import { feeRatio, inspectionBlocked, inspectionStartingCents, recordGates, tripBlocked, type RecordGates } from '../../../_lib/turnkey-logic';
import { KeyValues, LoadError, Note, Panel, TkPill } from '../../../_components/tk-ui';
import type { RecordBase, RecordSources, Viewer } from './record-types';

export type RecordProps = { b: RecordBase; src: RecordSources; v: Viewer; g: RecordGates };

/** Gates for the record (today's computation, see turnkey-logic recordGates). */
export function gatesFor(b: RecordBase, src: RecordSources, v: Viewer): RecordGates {
  return recordGates(
    {
      project: b.p, isAdmin: v.isAdmin, edit: v.edit, stages: b.stages, fees: b.fees ?? [],
      drawings: src.drw ? src.drw.data : null,
      quotes: src.qts ? { quotes: src.qts.quotes.map((q) => ({ ...q, total_cents: Number(q.total_cents) })), factory_quotes: src.qts.factory_quotes, deposit_pct: src.qts.deposit_pct } : null,
      inspections: src.qc?.inspections ?? [],
      shipping: src.ship ? { balance_state: src.ship.balance_state, shipments: src.ship.shipments, documents: src.ship.documents } : null,
    },
    (c) => money(c),
  );
}

const box = 'rounded-ods-card border border-ods-line p-3 grid gap-2';
const list = 'm-0 grid list-none gap-0 divide-y divide-ods-line rounded-ods-card border border-ods-line p-0';
const muted = 'text-ods-slate';
const h3 = 'm-0 text-ods-body font-semibold text-ods-navy';
const Open = ({ href, label }: { href: string; label: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-ods-control items-center rounded-ods-control border border-ods-line-strong px-3 text-ods-small font-semibold text-ods-navy no-underline hover:bg-ods-canvas">Open<span className="sr-only"> {label}</span></a>
);
const Intro = ({ children }: { children: ReactNode }) => <p className={`m-0 text-ods-small ${muted}`}>{children}</p>;

/* ───────── header notices ───────── */

export function RecordNotices({ b }: { b: RecordBase }) {
  const p = b.p;
  const st = { on_hold: 'On hold', cancelled: 'Cancelled' } as Record<string, string>;
  return (
    <>
      {b.staff?.is_seed ? <Note tone="warning">Test data (moved from a seed lead).</Note> : null}
      {!p.org_id ? <Note tone="warning">Not linked to a client company yet: it joins the company of the account with the lead’s email when that person signs in and opens Turnkey projects.</Note> : null}
      {(p.status === 'on_hold' || p.status === 'cancelled') && p.status_reason ? <Note tone={p.status === 'on_hold' ? 'warning' : 'danger'}>{st[p.status]}: {p.status_reason}</Note> : null}
    </>
  );
}

/* ───────── overview ───────── */

export function OverviewTab({ b, v, g }: RecordProps) {
  const p = b.p;
  const staff = b.staff;
  const contact = b.contact;
  const coverOn = !!contact?.on_cover;
  const place = [p.city, countryName(p.country)].filter(Boolean).join(', ');
  return (
    <div className="grid items-start gap-4 ods-desktop:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-testid="tk-record-overview">
      <div className="grid gap-4">
        {v.edit ? (
          <Panel title="Manage" testId="tk-record-manage">
            <ProjectControls projectId={p.id} code={p.code} stage={p.stage} status={p.status} dues={g.dues} nextFee={g.nextFee} finish={g.finish} />
          </Panel>
        ) : null}
        <Panel title="History (the client sees this)">
          <ActivityFeed label="Project history" items={b.events.map((e) => { const t = eventText(e); return { id: String(e.id), title: t.body ? `${t.title}: ${t.body}` : t.title, date: e.created_at, tone: 'info' as const }; })} emptyTitle="No history yet" />
        </Panel>
      </div>
      <div className="grid gap-4">
        <Panel title="Client">
          <KeyValues rows={[
            ['Company', b.company ? b.company.name : 'Not linked yet'],
            ['Account manager', <span key="m" data-testid="tk-staff-manager">{contact?.usual_name ?? (staff?.owner_id ? 'Former team member' : b.managerName ?? 'Not set')}{staff?.owner_set_at ? ` · since ${fmtDate(staff.owner_set_at)}` : ''}</span>],
            staff?.cover_id ? ['Cover', <span key="c" data-testid="tk-staff-cover">{contact?.cover_name ?? 'Former team member'} · {fmtDate(staff.cover_from)} to {fmtDate(staff.cover_to)}{coverOn ? ' · covering now' : ''}</span>] : null,
            ['Client sees', b.managerName ?? 'Not set'],
            ['Came from', p.source === 'legacy_lead' ? 'The earlier Turnkey form' : p.source === 'web' ? 'Enquiry form' : 'Staff'],
          ]} />
        </Panel>
        {v.edit ? (
          <Panel title="Account manager and cover">
            <ManagerPanel projectId={p.id} code={p.code} managerId={staff?.owner_id ?? null} coverId={staff?.cover_id ?? null} coverFrom={staff?.cover_from ?? null} coverTo={staff?.cover_to ?? null} candidates={b.cands} />
          </Panel>
        ) : null}
        <Panel title="What the client sent">
          <KeyValues rows={[
            ['Catalogue', <span key="k" className="font-mono">{p.catalogue_project_id ?? 'New project (not in the catalogue)'}</span>],
            ['Where', place || 'Not given'],
            ['Opening', p.target_open_on ? fmtDate(p.target_open_on) : 'Not given'],
            ['Space', areaLabel(p.floor_area_m2)],
            ['Budget', budgetLabel(p.budget_cents)],
            ['Plan', <span key="p" className="whitespace-pre-line">{p.plan ?? 'Not given'}</span>],
          ]} />
        </Panel>
        {b.lead ? (
          <Panel title={`Old lead ${b.lead.reference}`}>
            <KeyValues testId="tk-staff-lead" rows={[
              ['Company', b.lead.company_name], ['Person', b.lead.contact_name], ['Email', b.lead.email], ['Phone', b.lead.phone ?? 'Not given'],
              ['Country', countryName(b.lead.country) ?? b.lead.country], ['Old status', `${b.lead.status} · ${b.lead.kind === 'interest' ? 'Interest' : 'Quote request'} · ${fmtDate(b.lead.created_at)}`],
            ]} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

/* ───────── fees ───────── */

export function FeesTab({ b, v, g }: RecordProps) {
  const p = b.p;
  if (b.fees === null) return <Panel title="Fees"><LoadError what="the fees" /></Panel>;
  const fees = b.fees;
  return (
    <Panel title="Fees" testId="tk-staff-fees">
      <div className="grid gap-3">
        <Intro>A fee up to 2× the starting fee is active at once; above 2× (or with no starting fee) an admin who did not set it approves it first. The client sees a fee once it is active and pays its proforma before the phase starts. Notes, names and reasons here are staff only.</Intro>
        {fees.length === 0 ? <p className="m-0 text-ods-body">No fees yet.</p> : (
          <ul className={list}>
            {fees.map((f) => {
              const ph = tkPhase(f.stage);
              const fs = feeStatusLabel(f.status);
              const own = f.proposed_by === v.userId;
              return (
                <li key={f.id} className="grid gap-2 p-3" data-testid={`tk-staff-fee-${f.stage}-v${f.version}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ods-navy">{f.service_name ?? `${ph?.name ?? f.stage} fee`} <span className={`text-ods-small font-normal ${muted}`}>· version {f.version}</span></div>
                      <div className={`text-ods-small ${muted}`}>{ph ? `Phase ${ph.n} · ${ph.name}` : f.stage}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">{money(f.amount_cents, f.currency)}</span>
                      <TkPill label={fs.label} tone={fs.tone} />
                    </div>
                  </div>
                  <KeyValues labelWidth="8rem" rows={[
                    ['Proposed', `${f.proposed_by_name ?? 'Former team member'} · ${fmtDate(f.proposed_at, true)}`],
                    f.note ? ['Note', f.note] : null,
                    ['Starting fee', f.starting_cents ? `${money(f.starting_cents, f.currency)} (${feeRatio(f.amount_cents, f.starting_cents)})` : 'None'],
                    ['Approval', <span key="a" data-testid={`tk-fee-approval-${f.id}`}>{!f.needs_approval ? 'Not needed (within 2× the starting fee)' : f.approved_by ? `${f.approved_by_name ?? 'Former team member'} · ${fmtDate(f.approved_at, true)}` : f.status === 'pending_approval' ? 'Waiting for an admin' : '—'}</span>],
                    f.status === 'rejected' ? ['Rejected', <span key="r" className="text-ods-danger">{f.rejected_by_name ?? 'Former team member'} · {fmtDate(f.rejected_at, true)}: {f.reject_reason}</span>] : null,
                    f.withdrawn_at ? ['Withdrawn', fmtDate(f.withdrawn_at, true)] : null,
                    f.document_number ? ['Proforma', <span key="d"><span className="font-mono">{f.document_number}</span> · {f.document_status === 'void' ? 'void (replaced)' : f.paid ? 'paid' : (f.paid_cents ?? 0) > 0 ? `part paid (${money(f.paid_cents, f.currency)})` : 'awaiting payment'}</span>] : null,
                  ]} />
                  {f.status === 'pending_approval' ? (
                    <div className="flex flex-wrap items-start gap-3" data-testid={`tk-fee-pending-${f.id}`}>
                      {v.isAdmin ? <TkFeeDecision feeId={f.id} code={p.code} canApprove={!own} blockedReason={own ? 'You proposed this fee; another admin approves it.' : null} /> : <span className={`text-ods-small ${muted}`}>Second approver needed: an admin who did not propose it.</span>}
                      {v.edit ? <FeeWithdrawButton feeId={f.id} code={p.code} /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {v.edit && p.org_id && p.status !== 'cancelled' && p.status !== 'completed' ? <FeeProposeForm projectId={p.id} code={p.code} defaultStage={g.defaultStage} services={b.services} /> : null}
      </div>
    </Panel>
  );
}

/* ───────── drawings ───────── */

export function DrawingsTab({ b, src, v, g }: RecordProps) {
  const p = b.p;
  if (!src.drw) return <Panel title="Layout drawings"><LoadError what="the drawings" /></Panel>;
  const { versions, extras, comments } = src.drw.data;
  return (
    <Panel title="Layout drawings" testId="tk-staff-drawings">
      <div className="grid gap-3">
        <Intro>{TK_FREE_DRAWING_VERSIONS} versions are free; each extra version costs 50% of the drawing fee{g.drawingFee ? ` (${money(extraVersionCents(g.drawingFee.amount_cents))} now)` : ''} and is uploaded after the client pays it. Files stay private (short signed links).</Intro>
        {versions.length === 0 ? <p className="m-0 text-ods-body">No drawings yet.</p> : (
          <ul className={list}>
            {versions.map((ver) => {
              const ds = drawingStatusLabel(ver.status, 'staff');
              const url = src.drw!.urls[ver.file_path] ?? null;
              const vc = comments.filter((c) => c.version_id === ver.id);
              return (
                <li key={ver.id} className="grid gap-2 p-3" data-testid={`tk-staff-drawing-v${ver.version}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ods-navy">Version {ver.version} {ver.version > TK_FREE_DRAWING_VERSIONS ? <span className={`text-ods-small font-normal ${muted}`}>· extra version</span> : null}</div>
                      <div className={`text-ods-small ${muted}`}>{ver.file_name} · {fileSize(ver.size_bytes)} · {ver.uploaded_by_name ?? 'Former team member'} · {fmtDate(ver.shared_at, true)}</div>
                    </div>
                    <div className="flex items-center gap-2">{url ? <Open href={url} label={`version ${ver.version}`} /> : null}<TkPill label={ds.label} tone={ds.tone} /></div>
                  </div>
                  {ver.message ? <p className="m-0 text-ods-body">{ver.message}</p> : null}
                  {vc.length > 0 ? (
                    <ul className="m-0 grid list-none gap-1 p-0 text-ods-small">
                      {vc.map((c) => <li key={c.id}><span className="font-semibold">{c.from_staff ? (c.author_name ?? 'Team') : 'Client'}{c.kind === 'changes' ? ' (changes asked)' : c.kind === 'approval' ? ' (approved)' : ''}:</span> {c.body} <span className={muted}>· {fmtDate(c.created_at, true)}</span></li>)}
                    </ul>
                  ) : null}
                  {v.edit && p.status === 'open' ? <StaffDrawingComment versionId={ver.id} code={p.code} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        {extras.length > 0 ? (
          <ul className="m-0 grid list-none gap-2 p-0" data-testid="tk-staff-extras">
            {extras.map((e) => (
              <li key={e.id} className={box} data-testid={`tk-staff-extra-v${e.for_version}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Extra version {e.for_version} · {money(e.amount_cents)} <span className={`text-ods-small font-normal ${muted}`}>(50% of {money(e.base_cents)})</span></span>
                  <StatusPill tone={e.status === 'waived' ? 'neutral' : e.paid ? 'success' : 'warning'}>{e.status === 'waived' ? 'Waived' : e.paid ? 'Paid' : 'Awaiting payment'}</StatusPill>
                </div>
                <div className={`text-ods-small ${muted}`}>Proforma <span className="font-mono">{e.document_number ?? '—'}</span>{e.status === 'waived' ? ` · waived by ${e.waived_by_name ?? 'an admin'} on ${fmtDate(e.waived_at)}: ${e.waive_reason}` : ''}</div>
                {v.isAdmin && e.status === 'open' && !e.paid && (e.paid_cents ?? 0) === 0 ? <WaiveExtraFee extraId={e.id} code={p.code} version={e.for_version} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {v.edit && p.org_id && p.stage === 'design' ? <DrawingUpload projectId={p.id} code={p.code} nextVersion={g.nextVersion} blocked={g.uploadBlocked} /> : null}
      </div>
    </Panel>
  );
}

/* ───────── quotes (staff only: supplier, cost, margin) ───────── */

export function QuotesTab({ b, src, v, g }: RecordProps) {
  const p = b.p;
  const qts = src.qts;
  if (!qts) return <Panel title="Quotes"><LoadError what="the quotes" /></Panel>;
  const depositPct = qts.deposit_pct ?? null;
  const draft = qts.quotes.find((q) => q.status === 'draft') ?? null;
  const accepted = g.accepted;
  return (
    <Panel title="Quotes (supplier, cost and margin: staff only)" testId="tk-staff-quotes">
      <div className="grid gap-4">
        <Intro>The client never sees factories, costs or margins: only the client quote lines, the total and the deposit ({depositPct ? `${depositPct}% from settings${qts.custom_branded ? ' for custom / branded orders' : ''}` : 'deposit % not set yet — an admin sets it in Turnkey › Settings'}).</Intro>
        <CustomBrandedToggle projectId={p.id} code={p.code} custom={!!qts.custom_branded} standardPct={qts.deposit_pct_standard ?? null} customPct={qts.deposit_pct_custom ?? null} canEdit={v.edit && p.status === 'open' && !accepted} />
        <section aria-labelledby="tk-fq-list-h" className="grid gap-2">
          <h3 id="tk-fq-list-h" className={h3}>Factory quotes</h3>
          {qts.factory_quotes.length === 0 ? <p className="m-0 text-ods-body">None yet.</p> : null}
          {qts.factory_quotes.map((fq) => (
            <div key={fq.id} className={`${box} text-ods-small`} data-testid="tk-staff-factory-quote">
              <div className="font-semibold">{fq.supplier_name}{fq.supplier_ref ? ` · ${fq.supplier_ref}` : ''} · <span className="tabular-nums">{money(fq.total_cost_cents)}</span></div>
              <div className={muted}>{fq.created_by_name ?? 'Former team member'} · {fmtDate(fq.created_at)}{fq.valid_until ? ` · valid until ${fmtDate(fq.valid_until)}` : ''}{fq.notes ? ` · ${fq.notes}` : ''}</div>
              <ul className="m-0 list-none p-0">{fq.lines.map((l) => <li key={l.id}>{l.line_no}. {l.description} · {l.qty} × {money(l.unit_cost_cents)} = {money(l.total_cost_cents)}</li>)}</ul>
            </div>
          ))}
          {v.edit && p.status !== 'cancelled' && p.status !== 'completed' ? <FactoryQuoteForm projectId={p.id} code={p.code} /> : null}
        </section>
        <section aria-labelledby="tk-cq-list-h" className="grid gap-2">
          <h3 id="tk-cq-list-h" className={h3}>Client quote versions</h3>
          {qts.quotes.length === 0 ? <p className="m-0 text-ods-body">None yet.</p> : null}
          {qts.quotes.map((q) => {
            const qs = quoteStatusLabel(q.status, 'staff');
            const m = quoteMargin(Number(q.total_cents), q.cost_cents == null ? null : Number(q.cost_cents), q.cost_complete);
            return (
              <div key={q.id} className={box} data-testid={`tk-staff-quote-v${q.version}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Version {q.version} · <span className="tabular-nums">{money(q.total_cents)}</span></span>
                  <TkPill label={qs.label} tone={qs.tone} />
                </div>
                <KeyValues labelWidth="9rem" rows={[
                  ['Margin', <span key="m" data-testid={`tk-staff-margin-v${q.version}`}>{m ? `${money(m.cents)}${m.pct != null ? ` (${m.pct}%)` : ''}` : 'Unknown (a line has no cost)'}</span>],
                  ['Deposit', q.deposit_pct ? `${q.deposit_pct}% · ${money(q.deposit_cents)}` : 'Fixed when sent'],
                  ['Made', `${q.created_by_name ?? 'Former team member'} · ${fmtDate(q.created_at, true)}${q.sent_at ? ` · sent by ${q.sent_by_name ?? 'a former team member'} ${fmtDate(q.sent_at, true)}` : ''}`],
                  q.client_comment ? ['Client', q.client_comment] : null,
                  q.document_number ? ['Deposit proforma', <span key="d"><span className="font-mono">{q.document_number}</span> · {q.deposit_paid ? 'paid' : (q.paid_cents ?? 0) > 0 ? `part paid (${money(q.paid_cents)})` : 'awaiting payment'}</span>] : null,
                ]} />
                <ul className="m-0 list-none p-0 text-ods-small">
                  {q.lines.map((l) => <li key={l.id}>{l.line_no}. {l.description} · {l.qty} × {money(l.unit_price_cents)} = {money(l.total_cents)} <span className={muted}>· cost {l.cost_cents != null ? money(l.cost_cents) : 'unknown'}{l.supplier_name ? ` (${l.supplier_name})` : ''}</span></li>)}
                </ul>
                {v.edit && q.status === 'draft' ? <QuoteDraftActions quoteId={q.id} code={p.code} canSend={!!depositPct && g.quoteStage && p.status === 'open'} /> : null}
                {v.edit && q.status === 'sent' ? <QuoteWithdraw quoteId={q.id} code={p.code} /> : null}
              </div>
            );
          })}
          {v.edit && p.status === 'open' && g.quoteStage && !accepted ? (
            <ClientQuoteBuilder projectId={p.id} code={p.code} factoryLines={g.factoryLines} depositPct={depositPct}
              initial={draft ? { message: draft.message ?? '', validUntil: draft.valid_until ?? '', lines: draft.lines.map((l) => ({ description: l.description, qty: String(l.qty), unitPriceUsd: (Number(l.unit_price_cents) / 100).toFixed(2), factoryLineId: l.factory_line_id ?? '', unitCostUsd: l.factory_line_id || l.unit_cost_cents == null ? '' : (Number(l.unit_cost_cents) / 100).toFixed(2) })) } : null} />
          ) : null}
          {accepted ? <Intro>Version {accepted.version} is accepted. The balance is invoiced on Balance and shipment.</Intro> : null}
        </section>
      </div>
    </Panel>
  );
}

/* ───────── production and QC ───────── */

export function QcTab({ b, src, v, g }: RecordProps) {
  const p = b.p;
  const qc = src.qc;
  if (!qc) return <Panel title="Production and QC: inspections"><LoadError what="the inspections" /></Panel>;
  const inspections = qc.inspections;
  return (
    <Panel title="Production and QC: inspections" testId="tk-staff-qc">
      <div className="grid gap-3">
        <Intro>Each inspection is paid before it starts: set its fee (above 2× the starting fee an admin approves it), the client pays, then schedule the inspector. The factory, brief, remarks and names are staff only; the client sees the published report. Production and QC is complete when the latest pre-shipment inspection passed and its report is published.</Intro>
        <Note tone={g.psi.done ? 'success' : 'warning'} testId="tk-qc-gate">{g.psi.text}</Note>
        {inspections.length === 0 ? <p className="m-0 text-ods-body">No inspections yet.</p> : null}
        {inspections.map((i) => {
          const tid = `${i.kind}-${i.round}`;
          const is = inspectionStatusLabel(i.status, 'staff');
          const active = i.fees.find((f) => f.status === 'active') ?? null;
          const pendingFee = i.fees.find((f) => f.status === 'pending_approval') ?? null;
          const res = i.report ? resultLabel(i.report.result) : null;
          const ownReport = i.inspector_id === v.userId;
          const blocked = inspectionBlocked(i, p.status, (c) => money(c));
          const canOverride = v.isAdmin && i.kind === 'pre_shipment' && i.status === 'published' && i.report?.result === 'fail' && !i.override_at && g.latestPsiId === i.id && !ownReport;
          return (
            <section key={i.id} aria-labelledby={`tk-qc-h-${i.id}`} className={box} data-testid={`tk-staff-inspection-${tid}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`tk-qc-h-${i.id}`} className={h3}>{inspectionLabel(i.kind, i.round)}</h3>
                <div className="flex items-center gap-2">
                  {res && i.status === 'published' ? <TkPill label={res.label} tone={res.tone} /> : null}
                  <TkPill label={is.label} tone={is.tone} />
                </div>
              </div>
              <KeyValues labelWidth="8rem" rows={[
                ['Factory', <span key="f" data-testid={`tk-qc-factory-${tid}`}>{i.factory_name}{i.factory_address ? ` · ${i.factory_address}` : ''}</span>],
                i.brief ? ['Brief', <span key="b" className="whitespace-pre-line">{i.brief}</span>] : null,
                ['Planned', `${i.created_by_name ?? 'Former team member'} · ${fmtDate(i.created_at, true)}`],
                ['Fee', <span key="fee" data-testid={`tk-qc-fee-${tid}`}>{i.phase_fee ? `Production and QC fee ${money(i.phase_fee.amount_cents)} · ${i.phase_fee.paid ? 'paid' : 'not paid yet'}` : active ? `${money(active.amount_cents)} · proforma ${active.document_number ?? '—'} · ${active.paid ? 'paid' : (active.paid_cents ?? 0) > 0 ? `part paid (${money(active.paid_cents)})` : 'awaiting payment'}` : pendingFee ? `${money(pendingFee.amount_cents)} · waiting for an admin` : 'Not set'}</span>],
                i.inspector_name ? ['Inspector', `${i.inspector_name}${i.scheduled_on ? ` · ${fmtDate(i.scheduled_on)}` : ''}`] : null,
                i.returned_reason && i.status === 'in_progress' ? ['Returned', i.returned_reason] : null,
                i.status === 'cancelled' ? ['Cancelled', `${fmtDate(i.cancelled_at, true)}: ${i.cancel_reason}`] : null,
                i.override_at ? ['Override', <span key="o" data-testid={`tk-qc-override-${tid}`}>{i.override_by_name ?? 'An admin'} · {fmtDate(i.override_at, true)}: {i.override_reason}</span>] : null,
              ]} />
              {i.fees.length > 0 ? (
                <ul className={`m-0 grid list-none gap-1 p-0 text-ods-small ${muted}`}>
                  {i.fees.map((f) => (
                    <li key={f.id}>Version {f.version}: {money(f.amount_cents)} · {feeStatusLabel(f.status).label} · {f.proposed_by_name ?? 'Former team member'} {fmtDate(f.proposed_at, true)}
                      {f.starting_cents ? ` · ${feeRatio(f.amount_cents, f.starting_cents)} the starting fee` : ''}
                      {f.approved_by_name ? ` · approved by ${f.approved_by_name}` : ''}{f.reject_reason ? ` · rejected: ${f.reject_reason}` : ''}{f.note ? ` · note: ${f.note}` : ''}</li>
                  ))}
                </ul>
              ) : null}
              {pendingFee && (v.edit || v.isAdmin) ? <InspectionFeeDecision feeId={pendingFee.id} code={p.code} isAdmin={v.isAdmin} canApprove={pendingFee.proposed_by !== v.userId} canWithdraw={v.edit} /> : null}
              {v.edit && i.status === 'planned' && !i.phase_fee && !(active && (active.paid || (active.paid_cents ?? 0) > 0)) ? <InspectionFeeForm inspectionId={i.id} code={p.code} startingCents={inspectionStartingCents(i.kind, b.services)} testId={tid} /> : null}
              {v.edit && (i.status === 'planned' || i.status === 'scheduled') ? <InspectionSchedule inspectionId={i.id} code={p.code} inspectors={qc.inspectors ?? []} currentInspector={i.inspector_id} currentDate={i.scheduled_on} blocked={blocked} testId={tid} /> : null}
              {i.report && (i.status === 'submitted' || i.status === 'published') ? (
                <div className="grid gap-2 border-t border-ods-line pt-2" data-testid={`tk-qc-report-${tid}`}>
                  <KeyValues labelWidth="9rem" rows={[
                    ['Result', <b key="r">{res?.label}</b>],
                    ['Lot / sample', <span key="l" className="font-mono">{i.report.lot_size} / {i.report.sample_size}</span>],
                    ['Defects', `Critical ${i.report.critical_defects} · major ${i.report.major_defects} · minor ${i.report.minor_defects}`],
                    i.report.remarks ? ['Remarks (staff)', <span key="rm" className="whitespace-pre-line">{i.report.remarks}</span>] : null,
                    ['Signed', `${i.report.signed_name} · ${fmtDate(i.report.submitted_at, true)}`],
                    i.report.client_summary ? ['Client summary', <span key="cs" className="whitespace-pre-line">{i.report.client_summary}</span>] : null,
                    i.published_at ? ['Published', `${i.published_by_name ?? 'Former team member'} · ${fmtDate(i.published_at, true)}`] : null,
                  ]} />
                  <ul className="m-0 grid list-none gap-0.5 p-0 text-ods-small">
                    {i.items.map((it) => <li key={it.id}>{it.position}. {it.label}: <span className="font-semibold">{it.answer === 'na' ? 'N/A' : it.answer === 'fail' ? 'Fail' : it.answer === 'pass' ? 'Pass' : '—'}</span>{it.remark ? <span className={muted}> · {it.remark}</span> : null}</li>)}
                  </ul>
                  {i.photos.length > 0 ? (
                    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={`Photos of ${inspectionLabel(i.kind, i.round)}`}>
                      {i.photos.map((ph, n) => (
                        <li key={ph.id} className={`flex flex-col items-center gap-1 text-ods-small ${muted}`}>
                          {ph.url ? (
                            <a href={ph.url} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={ph.url} alt={`Inspection photo ${n + 1}`} className="size-20 rounded-ods-control border border-ods-line object-cover" />
                            </a>
                          ) : <span>Photo {n + 1}</span>}
                          {i.status === 'published' ? <span>{ph.client_visible ? 'Client sees it' : 'Hidden'}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {v.edit && i.status === 'submitted' && p.status === 'open' ? <InspectionReview inspectionId={i.id} code={p.code} ownReport={ownReport} testId={tid} photos={i.photos.map((ph, n) => ({ id: ph.id, url: ph.url ?? null, n: n + 1 }))} /> : null}
                </div>
              ) : null}
              {canOverride ? <PsiOverride inspectionId={i.id} code={p.code} testId={tid} /> : null}
              {v.edit && (i.status === 'planned' || i.status === 'scheduled') ? <InspectionCancel inspectionId={i.id} code={p.code} testId={tid} /> : null}
            </section>
          );
        })}
        {v.edit && p.org_id && p.status === 'open' && p.stage === 'production_qc' ? <InspectionCreateForm projectId={p.id} code={p.code} phaseFeeAvailable={!!qc.phase_fee_available} /> : null}
        {p.stage !== 'production_qc' && inspections.length === 0 ? <Intro>Inspections are planned in the Production and QC phase.</Intro> : null}
      </div>
    </Panel>
  );
}

/* ───────── balance and shipment ───────── */

function DocItem({ d, editor, code }: { d: RecordSources['ship'] extends infer S ? (S extends { documents: (infer D)[] } ? D : never) : never; editor: boolean; code: string }) {
  const ds = docStatusLabel(d.status);
  const tid = `${d.kind}-${d.id.slice(0, 8)}`;
  return (
    <li className={box} data-testid={`tk-staff-doc-${d.kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-ods-small">
        <span><span className="font-semibold">{docKindLabel(d.kind)}</span>{d.title !== docKindLabel(d.kind) ? ` · ${d.title}` : ''} <span className={muted}>· {d.file_name} · {fileSize(d.size_bytes)} · {d.uploaded_by_name ?? 'Former team member'}</span></span>
        <span className="flex items-center gap-2">{d.url ? <Open href={d.url} label={d.title} /> : null}<TkPill label={ds.label} tone={ds.tone} /></span>
      </div>
      {d.withdraw_reason ? <p className={`m-0 text-ods-small ${muted}`}>Withdrawn {fmtDate(d.withdrawn_at, true)}: {d.withdraw_reason}</p> : null}
      {editor && d.status !== 'withdrawn' ? <DocumentActions documentId={d.id} code={code} status={d.status} testId={tid} /> : null}
    </li>
  );
}

export function ShipmentTab({ b, src, v, g }: RecordProps) {
  const p = b.p;
  const ship = src.ship;
  if (!ship) return <Panel title="Balance and shipment"><LoadError what="the balance and shipments" /></Panel>;
  const shipments = ship.shipments;
  const docsAll = ship.documents;
  return (
    <Panel title="Balance and shipment" testId="tk-staff-shipping">
      <div className="grid gap-4">
        <section aria-labelledby="tk-bal-h" className="grid gap-2" data-testid="tk-staff-balance">
          <h3 id="tk-bal-h" className={h3}>Balance</h3>
          <Note tone={g.bal.done ? 'success' : 'warning'} testId="tk-balance-gate">{g.bal.text}</Note>
          {ship.balance ? (
            <KeyValues labelWidth="8rem" rows={[
              ['Balance', <span key="b"><span className="font-semibold tabular-nums">{money(ship.balance.amount_cents)}</span> · quote version {ship.balance.quote_version} ({money(ship.balance.total_cents)} − deposit {money(ship.balance.deposit_cents)})</span>],
              ['Proforma', <span key="p" data-testid="tk-staff-balance-state"><span className="font-mono">{ship.balance.document_number ?? '—'}</span> · {ship.balance.paid ? 'paid' : (ship.balance.paid_cents ?? 0) > 0 ? `part paid (${money(ship.balance.paid_cents)})` : 'awaiting payment'}</span>],
              ['Issued', `${ship.balance.issued_by_name ?? 'Former team member'} · ${fmtDate(ship.balance.created_at, true)}`],
            ]} />
          ) : null}
          {g.canIssueBalance ? <BalanceIssueButton projectId={p.id} code={p.code} label={`Issue the balance invoice (${money(g.balanceCentsDue)})`} /> : null}
        </section>
        <section aria-labelledby="tk-sh-list-h" className="grid gap-2">
          <h3 id="tk-sh-list-h" className={h3}>Shipments</h3>
          <Intro>The client sees the carrier, references, dates, status and tracking events; staff notes, reasons and names stay here. {g.shipGate.text}</Intro>
          {shipments.length === 0 ? <p className="m-0 text-ods-body">{p.stage === 'shipment' ? 'No shipment booked yet.' : 'Shipments are booked in the Shipment phase, after the balance is paid.'}</p> : null}
          {shipments.map((sh) => {
            const ss = shipmentStatusLabel(sh.status);
            const shDocs = docsAll.filter((x) => x.shipment_id === sh.id);
            return (
              <section key={sh.id} aria-labelledby={`tk-sh-h-${sh.id}`} className={box} data-testid={`tk-staff-shipment-${sh.seq}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 id={`tk-sh-h-${sh.id}`} className={h3}>Shipment {sh.seq} · {shipmentModeLabel(sh.mode)} · {sh.carrier}</h4>
                  <TkPill label={ss.label} tone={ss.tone} />
                </div>
                <KeyValues labelWidth="8rem" rows={[
                  sh.booking_ref ? ['Booking', <span key="b" className="font-mono">{sh.booking_ref}</span>] : null,
                  sh.container_no ? ['Container', <span key="c" className="font-mono">{sh.container_no}</span>] : null,
                  sh.tracking_no ? ['Tracking', <span key="t" className="font-mono">{sh.tracking_no}</span>] : null,
                  sh.origin || sh.destination ? ['Route', `${sh.origin ?? '—'} → ${sh.destination ?? '—'}`] : null,
                  sh.etd || sh.eta ? ['ETD / ETA', `${sh.etd ? fmtDate(sh.etd) : '—'} / ${sh.eta ? fmtDate(sh.eta) : '—'}`] : null,
                  sh.staff_note ? ['Staff note', <span key="n" className="whitespace-pre-line">{sh.staff_note}</span>] : null,
                  ['Booked', `${sh.created_by_name ?? 'Former team member'} · ${fmtDate(sh.created_at, true)}`],
                  sh.cancelled_at ? ['Cancelled', `${fmtDate(sh.cancelled_at, true)}: ${sh.cancel_reason}`] : null,
                ]} />
                {sh.events.length > 0 ? (
                  <ol className="m-0 grid list-none gap-1 p-0 text-ods-small" aria-label={`Tracking of shipment ${sh.seq}`}>
                    {sh.events.map((ev) => <li key={ev.id}><span className={`font-mono ${muted}`}>{fmtDate(ev.happened_at, true)}</span> · {ev.status_to ? <span className="font-semibold">{shipmentStatusLabel(ev.status_to).label}: </span> : null}{ev.description}{ev.location ? ` (${ev.location})` : ''} <span className={muted}>· {ev.created_by_name ?? 'Former team member'}</span></li>)}
                  </ol>
                ) : null}
                {shDocs.length > 0 ? <ul className="m-0 grid list-none gap-2 p-0" aria-label={`Documents of shipment ${sh.seq}`}>{shDocs.map((d) => <DocItem key={d.id} d={d} editor={g.docEditor} code={p.code} />)}</ul> : null}
                {v.edit && p.status === 'open' && p.stage === 'shipment' && !['delivered', 'cancelled'].includes(sh.status) ? <ShipmentEventForm shipmentId={sh.id} code={p.code} status={sh.status} seq={sh.seq} /> : null}
                {v.edit && p.status === 'open' && sh.status === 'booked' ? <ShipmentCancel shipmentId={sh.id} code={p.code} seq={sh.seq} /> : null}
              </section>
            );
          })}
          {v.edit && p.org_id && p.status === 'open' && p.stage === 'shipment' ? <ShipmentCreateForm projectId={p.id} code={p.code} /> : null}
          {g.docEditor && g.openShipments.length > 0 && (p.stage === 'shipment' || p.stage === 'handover' || p.status === 'completed') ? <DocumentUpload projectId={p.id} code={p.code} section="shipment" shipments={g.openShipments.map((x) => ({ id: x.id, seq: x.seq }))} /> : null}
        </section>
      </div>
    </Panel>
  );
}

/* ───────── China visits ───────── */

export function VisitsTab({ b, src, v }: RecordProps) {
  const p = b.p;
  const trp = src.trp;
  if (!trp) return <Panel title="China visits"><LoadError what="the China visits" /></Panel>;
  return (
    <Panel title="China visits (TripManager)" testId="tk-staff-trips">
      <div className="grid gap-3">
        <Intro>The client asks for a visit on their project page; the list price comes from the services list. Set the exact fee (above 2× the list price an admin approves it); confirm the itinerary after the client pays. Guide and notes are staff only. Passport copies are shown only to Turnkey editors (2FA) and the project’s account manager{trp.passport_access ? '' : ' — you can see how many there are, not the copies'}.</Intro>
        {trp.trips.length === 0 ? <p className="m-0 text-ods-body">No visit requested.</p> : null}
        {trp.trips.map((t) => {
          const ts = tripStatusLabel(t.status, 'staff');
          const active = t.fees.find((f) => f.status === 'active') ?? null;
          const pendingFee = t.fees.find((f) => f.status === 'pending_approval') ?? null;
          const blocked = tripBlocked(t, (c) => money(c));
          return (
            <section key={t.id} aria-labelledby={`tk-trip-h-${t.id}`} className={box} data-testid={`tk-staff-trip-${t.seq}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`tk-trip-h-${t.id}`} className={h3}>Visit {t.seq} · {tripSummary(t, (x) => fmtDate(x))}</h3>
                <TkPill label={ts.label} tone={ts.tone} />
              </div>
              <KeyValues labelWidth="8rem" rows={[
                ['Extras', [t.visa_letters ? `${t.visa_letters} visa letter(s)` : null, t.car_days ? `car and driver ${t.car_days} day(s)` : null, t.airport_pickups ? `${t.airport_pickups} airport pick-up(s)` : null, t.hotel_help ? 'hotel help' : null].filter(Boolean).join(' · ') || 'None'],
                ['List price', <span key="l" className="tabular-nums" data-testid={`tk-staff-trip-list-${t.seq}`}>{money(t.list_cents)}</span>],
                t.client_message ? ['Client', t.client_message] : null,
                ['Asked by', `${t.requested_by_name ?? 'The client'} · ${fmtDate(t.created_at, true)}`],
                ['Fee', <span key="f" data-testid={`tk-staff-trip-fee-${t.seq}`}>{active ? `${money(active.amount_cents)} · proforma ${active.document_number ?? '—'} · ${active.paid ? 'paid' : (active.paid_cents ?? 0) > 0 ? `part paid (${money(active.paid_cents)})` : 'awaiting payment'}` : pendingFee ? `${money(pendingFee.amount_cents)} · waiting for an admin` : 'Not set'}</span>],
                t.guide_name ? ['Guide', t.guide_name] : null,
                t.staff_notes ? ['Staff notes', <span key="n" className="whitespace-pre-line">{t.staff_notes}</span>] : null,
                t.confirmed_at ? ['Confirmed', `${t.confirmed_by_name ?? 'Former team member'} · ${fmtDate(t.confirmed_at, true)}`] : null,
                t.cancelled_at ? ['Cancelled', `${fmtDate(t.cancelled_at, true)}: ${t.cancel_reason}`] : null,
                ['Passports', (
                  <span key="pp" data-testid={`tk-staff-passports-${t.seq}`}>
                    {t.passports === null ? `${t.passports_count} of ${t.travellers} uploaded (copies hidden: Turnkey editors and the account manager only)` : t.passports.length === 0 ? `None yet (0 of ${t.travellers})` : (
                      <ul className="m-0 grid list-none gap-1 p-0">
                        {t.passports.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2">Traveller {x.position}: {x.full_name} {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="underline" data-testid={`tk-staff-passport-${x.position}`}>View copy<span className="sr-only"> of traveller {x.position}</span></a> : null}{v.edit ? <PassportDeleteStaff travellerId={x.id} code={p.code} position={x.position} /> : null}</li>)}
                      </ul>
                    )}
                  </span>
                )],
              ]} />
              {t.itinerary ? <div className="text-ods-small"><span className="font-semibold">Itinerary (client sees it):</span><p className="m-0 whitespace-pre-line">{t.itinerary}</p></div> : null}
              {t.trip_report ? <div className="text-ods-small"><span className="font-semibold">Trip report:</span><p className="m-0 whitespace-pre-line">{t.trip_report}</p></div> : null}
              {t.fees.length > 0 ? (
                <ul className={`m-0 grid list-none gap-1 p-0 text-ods-small ${muted}`}>
                  {t.fees.map((f) => <li key={f.id}>Version {f.version}: {money(f.amount_cents)} · {feeStatusLabel(f.status).label} · {f.proposed_by_name ?? 'Former team member'} {fmtDate(f.proposed_at, true)} · {feeRatio(f.amount_cents, f.starting_cents)} the list price{f.approved_by_name ? ` · approved by ${f.approved_by_name}` : ''}{f.reject_reason ? ` · rejected: ${f.reject_reason}` : ''}{f.note ? ` · note: ${f.note}` : ''}</li>)}
                </ul>
              ) : null}
              {pendingFee && (v.edit || v.isAdmin) ? <TripFeeDecision feeId={pendingFee.id} code={p.code} isAdmin={v.isAdmin} canApprove={pendingFee.proposed_by !== v.userId} canWithdraw={v.edit} /> : null}
              {v.edit && p.status === 'open' && t.status === 'requested' && !(active && (active.paid || (active.paid_cents ?? 0) > 0)) ? <TripFeeForm tripId={t.id} code={p.code} listCents={t.list_cents} seq={t.seq} /> : null}
              {v.edit && p.status === 'open' && (t.status === 'requested' || t.status === 'confirmed') ? <TripConfirmForm tripId={t.id} code={p.code} seq={t.seq} blocked={blocked} initial={{ itinerary: t.itinerary ?? '', guide: t.guide_name ?? '', notes: t.staff_notes ?? '' }} /> : null}
              {v.edit && p.status === 'open' && t.status === 'confirmed' ? <TripCompleteForm tripId={t.id} code={p.code} seq={t.seq} /> : null}
              {v.edit && p.status === 'open' && (t.status === 'requested' || t.status === 'confirmed') && !(active && (active.paid_cents ?? 0) > 0) ? <TripCancelStaff tripId={t.id} code={p.code} seq={t.seq} /> : null}
            </section>
          );
        })}
      </div>
    </Panel>
  );
}

/* ───────── handover ───────── */

export function HandoverTab({ b, src, v, g }: RecordProps) {
  const p = b.p;
  const ship = src.ship;
  if (!ship) return <Panel title="Handover"><LoadError what="the handover" /></Panel>;
  const items = ship.items;
  const signoff = ship.signoff;
  const finals = ship.documents.filter((x) => x.section === 'handover');
  return (
    <Panel title="Handover" testId="tk-staff-handover">
      <div className="grid gap-3">
        <Intro>Prepare the final-documents checklist and share the final documents; the client signs the handover on their project page when every line is ready. Signing completes the project; afterwards only admins can add documents.</Intro>
        {signoff ? <Note tone="success" testId="tk-staff-signoff">Signed by {signoff.signed_name} on {fmtDate(signoff.signed_at, true)}{signoff.signed_by_email ? ` (account ${signoff.signed_by_email})` : ''}.{signoff.client_comment ? ` Comment: ${signoff.client_comment}` : ''}</Note> : null}
        {items.length === 0 ? <p className="m-0 text-ods-body">{p.stage === 'handover' ? 'No checklist lines yet.' : 'The checklist is prepared in the Handover phase.'}</p> : (
          <ul className={list}>
            {items.map((it) => {
              const doc = ship.documents.find((x) => x.id === it.document_id);
              return (
                <li key={it.id} className="grid gap-2 p-3" data-testid={`tk-staff-ho-item-${it.position}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{it.position}. {it.label}{doc ? <span className={`font-normal ${muted}`}> · {doc.title}</span> : null}</span>
                    <StatusPill tone={it.done_at ? 'success' : 'warning'}>{it.done_at ? 'Ready' : 'Not ready'}</StatusPill>
                  </div>
                  {it.done_at ? <p className={`m-0 text-ods-small ${muted}`}>{it.done_by_name ?? 'Former team member'} · {fmtDate(it.done_at, true)}</p> : null}
                  {v.edit && p.status === 'open' && p.stage === 'handover' && !signoff ? <HandoverItemControls itemId={it.id} code={p.code} done={!!it.done_at} position={it.position} documents={g.releasedFinal.map((x) => ({ id: x.id, title: x.title }))} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        {finals.length > 0 ? <ul className="m-0 grid list-none gap-2 p-0" aria-label="Final documents">{finals.map((d) => <DocItem key={d.id} d={d} editor={g.docEditor} code={p.code} />)}</ul> : null}
        {g.docEditor && (p.stage === 'handover' || p.status === 'completed') ? <DocumentUpload projectId={p.id} code={p.code} section="handover" shipments={[]} /> : null}
        {v.edit && p.status === 'open' && p.stage === 'handover' && !signoff ? <HandoverItemForm projectId={p.id} code={p.code} /> : null}
      </div>
    </Panel>
  );
}

export const EmptyPanel = ({ title }: { title: string }) => <Panel title={title}><EmptyState title="Nothing here yet" headingLevel={3} /></Panel>;
