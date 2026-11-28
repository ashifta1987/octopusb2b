/**
 * ODS T9 · Turnkey (Back Office) — pure helpers shared by the ODS Turnkey screens, their staging fixtures and unit tests.
 * No I/O. The gates below are TODAY's rules from app/admin/turnkey/projects/[code]/page.tsx, moved here unchanged so the
 * real page and the fixtures compute them the same way (the database checks every one again: migration 231 rules).
 *
 * API:
 *  - `odsTone(tone)`                 legacy badge tone (blue/amber/green/red/gray) → ODS StatusPill tone
 *  - `turnkeySections(isAdmin)`      today's Turnkey section menu (TurnkeyStaffNav) with the same test ids
 *  - `overviewTab(raw)`              ?tab= on /admin/turnkey (dashboard | catalogue | services | leads)
 *  - `projectFilters(sp)`            ?stage / ?status / ?q / ?mine on /admin/turnkey/projects (today's parsing)
 *  - `phaseSteps(stage, status, rows)` 8-phase Stepper steps (+ current index)
 *  - `PROJECT_TABS`, `isProjectTab`  record tabs
 *  - `recordGates(input)`            every derived gate of the project page (next fee, finish, upload blocked, balance …)
 *  - `inspectionBlocked(…)`, `tripBlocked(…)` per-row gates (today's text)
 *  - `kpiItems(kpi)`                 dashboard KPI tiles (label, value, hint, tone, testid)
 */
import {
  TK_FREE_DRAWING_VERSIONS, TK_PHASES, TK_INSPECTION_KINDS, balanceGate, nextPhase, phaseStates, psiGate, shipmentGate, tkPhase, tkStatus,
  type TkStageCode, type TkStageRow,
} from '@/lib/turnkey/format';
import type { StatusTone } from '@octopus/ui/status';
import type { TkDashboard } from '@/lib/turnkey/reports';

export { TK_PHASES, tkStatus, tkPhase };

/* ───────── tones + sections ───────── */

export type LegacyTone = 'blue' | 'amber' | 'green' | 'red' | 'gray';
const TONE: Record<LegacyTone, StatusTone> = { blue: 'info', amber: 'warning', green: 'success', red: 'danger', gray: 'neutral' };
export const odsTone = (t: string): StatusTone => TONE[t as LegacyTone] ?? 'neutral';

export type TurnkeySection = { key: string; href: string; label: string; testid: string };
/** Today's TurnkeyStaffNav items, in order; Fee approvals + Settings for admins only (the pages check again). */
export function turnkeySections(isAdmin: boolean): TurnkeySection[] {
  return [
    { key: 'dashboard', href: '/admin/turnkey', label: 'Dashboard', testid: 'tk-nav-dashboard' },
    { key: 'projects', href: '/admin/turnkey/projects', label: 'Client projects', testid: 'tk-admin-client-projects' },
    { key: 'catalogue', href: '/admin/turnkey?tab=catalogue', label: 'Catalogue', testid: 'tk-nav-catalogue' },
    { key: 'services', href: '/admin/turnkey?tab=services', label: 'Services and fees', testid: 'tk-nav-services' },
    { key: 'reports', href: '/admin/turnkey/reports', label: 'Reports', testid: 'tk-nav-reports' },
    ...(isAdmin
      ? [
          { key: 'approvals', href: '/admin/turnkey/approvals', label: 'Fee approvals', testid: 'tk-admin-fee-approvals' },
          { key: 'settings', href: '/admin/turnkey/settings', label: 'Settings', testid: 'tk-nav-settings' },
        ]
      : []),
    { key: 'leads', href: '/admin/turnkey?tab=leads', label: 'Old leads', testid: 'tk-nav-leads' },
  ];
}

export type OverviewTab = 'dashboard' | 'catalogue' | 'services' | 'leads';
export const overviewTab = (raw: string | undefined): OverviewTab => (raw === 'catalogue' || raw === 'services' || raw === 'leads' ? raw : 'dashboard');

/* ───────── projects list filters (today's parsing) ───────── */

export type ProjectStatusFilter = 'active' | 'open' | 'on_hold' | 'completed' | 'cancelled' | 'all';
export function projectFilters(sp: { stage?: string; status?: string; q?: string; mine?: string }): { stage: string; status: ProjectStatusFilter; q: string; mine: boolean } {
  const stage = TK_PHASES.some((p) => p.code === sp.stage) ? sp.stage! : '';
  const status = (['open', 'on_hold', 'completed', 'cancelled', 'all'].includes(sp.status ?? '') ? sp.status : 'active') as ProjectStatusFilter;
  const q = (sp.q ?? '').replace(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 60);
  return { stage, status, q, mine: sp.mine === '1' };
}
export const STATUS_FILTERS: [ProjectStatusFilter, string][] = [['active', 'Open and on hold'], ['open', 'In progress'], ['on_hold', 'On hold'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']];

export function projectsHref(cur: { stage: string; status: ProjectStatusFilter; q: string; mine: boolean }, patch: Partial<{ stage: string; status: string; q: string; mine: string }>, base = '/admin/turnkey/projects'): string {
  const u = new URLSearchParams({ ...(cur.stage ? { stage: cur.stage } : {}), ...(cur.status !== 'active' ? { status: cur.status } : {}), ...(cur.q ? { q: cur.q } : {}), ...(cur.mine ? { mine: '1' } : {}), ...patch });
  for (const [k, v] of [...u.entries()]) if (!v || (k === 'status' && v === 'active')) u.delete(k);
  const s = u.toString();
  return `${base}${s ? `${base.includes('?') ? '&' : '?'}${s}` : ''}`;
}

/* ───────── 8-phase stepper ───────── */

export type PhaseStep = { id: string; label: string; detail?: string; status: 'done' | 'current' | 'upcoming' | 'error'; errorText?: string };
/** Steps for the ODS Stepper from today's phaseStates; a project on hold / cancelled shows its phase as "Needs attention". */
export function phaseSteps(stage: string, status: string, rows: TkStageRow[], fmt: (iso: string) => string): { steps: PhaseStep[]; current: number } {
  const phases = phaseStates(stage, rows);
  const stopped = status === 'on_hold' || status === 'cancelled';
  const steps = phases.map((p): PhaseStep => {
    const done = p.state === 'done' || (p.state === 'current' && status === 'completed');
    const current = p.state === 'current' && status !== 'completed';
    const detail = p.row?.completed_at ? `Done ${fmt(p.row.completed_at)}` : p.row?.started_at ? `Started ${fmt(p.row.started_at)}` : p.row?.due_on ? `Target ${fmt(p.row.due_on)}` : p.paid ? 'Paid first' : 'Free';
    return {
      id: p.code,
      label: p.name,
      detail,
      status: done ? 'done' : current ? (stopped ? 'error' : 'current') : 'upcoming',
      errorText: current && stopped ? tkStatus(status).label : undefined,
    };
  });
  const idx = steps.findIndex((s) => s.status === 'current' || s.status === 'error');
  return { steps, current: status === 'completed' ? steps.length : idx < 0 ? 0 : idx };
}

/* ───────── record tabs ───────── */

export const PROJECT_TABS = ['overview', 'fees', 'drawings', 'quotes', 'qc', 'shipment', 'visits', 'handover'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export const isProjectTab = (v: string | undefined | null): v is ProjectTab => (PROJECT_TABS as readonly string[]).includes(v ?? '');
export const PROJECT_TAB_LABEL: Record<ProjectTab, string> = {
  overview: 'Overview', fees: 'Fees', drawings: 'Drawings', quotes: 'Quotes', qc: 'Production and QC', shipment: 'Balance and shipment', visits: 'China visits', handover: 'Handover',
};
/** The tab that holds the work of the current phase (opened by default when no ?tab=). */
export function phaseTab(stage: string): ProjectTab {
  switch (stage) {
    case 'design': return 'drawings';
    case 'sourcing': case 'quote_deposit': return 'quotes';
    case 'production_qc': return 'qc';
    case 'shipment': return 'shipment';
    case 'handover': return 'handover';
    default: return 'overview';
  }
}

/* ───────── record gates (today's rules, unchanged) ───────── */

type Fee = { stage: string; status: string; paid: boolean; service_code: string | null; amount_cents: number };
type Version = { version: number; status: string };
type Extra = { for_version: number; status: string; paid: boolean; amount_cents: number };
type Quote = { status: string; version: number; deposit_paid: boolean; total_cents: number; deposit_cents: number | null };
type Insp = { id: string; kind: string; round: number; status: string; report: { result: string } | null; override_at: string | null };
type Ship = { id: string; seq: number; status: string };
type Doc = { id: string; title: string; section: string; status: string };

export type GateInput = {
  project: { stage: string; status: string };
  isAdmin: boolean;
  edit: boolean;
  stages: TkStageRow[];
  fees: Fee[];
  drawings: { versions: Version[]; extras: Extra[] } | null;
  quotes: { quotes: Quote[]; factory_quotes: { supplier_name: string; lines: { id: string; description: string; unit_cost_cents: number }[] }[]; deposit_pct: number | null } | null;
  inspections: Insp[];
  shipping: { balance_state: string | null; shipments: Ship[]; documents: Doc[] } | null;
};

export type RecordGates = ReturnType<typeof recordGates>;

/** Every gate today's project page derives (lines 83–140), same order, same text. `money` formats cents (today: lib/format money). */
export function recordGates(g: GateInput, money: (cents: number | null | undefined) => string) {
  const p = g.project;
  const fees = g.fees;
  const dues = Object.fromEntries(g.stages.map((r) => [r.stage, r.due_on])) as Record<string, string | null>;
  const next = nextPhase(p.stage);
  const nextActive = next ? fees.filter((f) => f.stage === next.code && f.status === 'active') : [];
  const nextFee: 'paid' | 'approved' | 'pending' | 'none' = nextActive.length && nextActive.every((f) => f.paid) ? 'paid'
    : nextActive.length ? 'approved' : next && fees.some((f) => f.stage === next.code && f.status === 'pending_approval') ? 'pending' : 'none';
  const at = tkPhase(p.stage)?.n ?? 1;
  const defaultStage = (TK_PHASES.find((x) => x.paid && x.n > at && !fees.some((f) => f.stage === x.code && f.status === 'active'))?.code
    ?? TK_PHASES.find((x) => x.paid && x.n >= at)?.code ?? 'consultation') as TkStageCode;
  const inspections = g.inspections;
  const psi = psiGate(inspections.map((i) => ({ kind: i.kind, round: i.round, status: i.status, result: i.report?.result ?? null, overridden: !!i.override_at })));
  const latestPsi = inspections.filter((i) => i.kind === 'pre_shipment' && i.status !== 'cancelled').sort((a, b) => b.round - a.round)[0] ?? null;
  const versions = g.drawings?.versions ?? [];
  const extras = g.drawings?.extras ?? [];
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
  const quotes = g.quotes?.quotes ?? [];
  const draft = quotes.find((q) => q.status === 'draft') ?? null;
  const accepted = quotes.find((q) => q.status === 'accepted') ?? null;
  const factoryLines = (g.quotes?.factory_quotes ?? []).flatMap((fq) => fq.lines.map((l) => ({ id: l.id, label: `${fq.supplier_name} · ${l.description} · ${money(l.unit_cost_cents)} each`, unit_cost_cents: Number(l.unit_cost_cents) })));
  const quoteStage = p.stage === 'sourcing' || p.stage === 'quote_deposit';
  const bal = balanceGate(g.shipping?.balance_state);
  const shipments = g.shipping?.shipments ?? [];
  const docsAll = g.shipping?.documents ?? [];
  const shipGate = shipmentGate(shipments);
  const openShipments = shipments.filter((x) => x.status !== 'cancelled');
  const releasedFinal = docsAll.filter((x) => x.section === 'handover' && x.status === 'released');
  const docEditor = g.edit && p.status !== 'cancelled' && (p.status !== 'completed' || g.isAdmin);
  const canIssueBalance = g.edit && p.status === 'open' && (p.stage === 'quote_deposit' || p.stage === 'production_qc') && g.shipping?.balance_state === 'not_invoiced' && !!accepted?.deposit_paid;
  const balanceCentsDue = accepted ? Number(accepted.total_cents) - Number(accepted.deposit_cents ?? 0) : 0;
  const finish = p.stage === 'design'
    ? { done: !!approved, text: approved ? `Design: the client approved version ${approved.version}.` : 'Design is complete when the client approves a drawing version.' }
    : p.stage === 'quote_deposit'
      ? { done: !!accepted?.deposit_paid, text: !accepted ? 'Quote and deposit is complete when the client accepts a quote and pays the deposit.' : accepted.deposit_paid ? `Quote version ${accepted.version} accepted; the deposit is paid.` : `Quote version ${accepted.version} accepted; waiting for the deposit.` }
      : p.stage === 'production_qc' ? { done: psi.done && bal.done, text: psi.done ? `${psi.text} ${bal.text}` : psi.text }
      : p.stage === 'shipment' ? shipGate
      : null;
  return {
    dues, next, nextFee, defaultStage, psi, latestPsiId: latestPsi?.id ?? null, nextVersion, approved, extraForNext, drawingFee, uploadBlocked, draft, accepted,
    factoryLines, quoteStage, bal, shipGate, openShipments, releasedFinal, docEditor, canIssueBalance, balanceCentsDue, finish,
  };
}

/** Starting fee of an inspection kind (today's startFor). */
export function inspectionStartingCents(kind: string, services: { code: string; from_cents: number }[]): number | null {
  const svc = TK_INSPECTION_KINDS.find((k) => k.code === kind)?.service;
  const x = services.find((v) => v.code === svc);
  return x && x.from_cents > 0 ? x.from_cents : null;
}

/** Why an inspection can't be scheduled yet (today's text), or null. */
export function inspectionBlocked(
  i: { paid: boolean; phase_fee: unknown | null; fees: { status: string; amount_cents: number; document_number: string | null }[] },
  projectStatus: string,
  money: (c: number) => string,
): string | null {
  const active = i.fees.find((f) => f.status === 'active') ?? null;
  const pendingFee = i.fees.find((f) => f.status === 'pending_approval') ?? null;
  return projectStatus !== 'open' ? 'Reopen the project to schedule.'
    : i.paid ? null
    : i.phase_fee ? 'The Production and QC fee is not paid yet.'
    : active ? `Scheduled after the client pays ${money(active.amount_cents)} (proforma ${active.document_number ?? '—'}).`
    : pendingFee ? 'The fee is waiting for an admin’s approval.'
    : 'Set the fee first; the inspection is scheduled after the client pays it.';
}

/** Why a China visit can't be confirmed yet (today's text), or null. */
export function tripBlocked(t: { paid: boolean; fees: { status: string; amount_cents: number; document_number: string | null }[] }, money: (c: number) => string): string | null {
  const active = t.fees.find((f) => f.status === 'active') ?? null;
  return !active ? 'Set the trip fee first; the itinerary is confirmed after the client pays it.' : !t.paid ? `Confirmed after the client pays ${money(active.amount_cents)} (proforma ${active.document_number ?? '—'}).` : null;
}

/** "2.5×" (today's toFixed(1)) or null without a starting fee. */
export const feeRatio = (amount: number, starting: number | null | undefined) => (starting ? `${(amount / starting).toFixed(1)}×` : null);

/* ───────── dashboard ───────── */

export type KpiTile = { id: string; label: string; value: string; hint: string | null; hintHref?: string; tone?: 'warn' | 'bad'; testid: string };
type Kpi = NonNullable<TkDashboard['kpi']>;
/** Today's 8 dashboard tiles (same labels, hints and test ids). Money hint formatted by `money`. */
export function kpiItems(k: Kpi, money: (c: number) => string): KpiTile[] {
  const n = (v: number) => v.toLocaleString('en-US');
  return [
    { id: 'open', label: 'Open projects', value: n(k.open_total), hint: k.on_hold ? `${k.on_hold} on hold` : 'None on hold', testid: 'tk-kpi-open' },
    { id: 'approvals', label: 'Fees waiting for approval', value: n(k.waiting_approvals), hint: k.waiting_approvals ? 'Above 2× the starting fee' : 'Nothing waiting', hintHref: k.waiting_approvals ? '/admin/turnkey/approvals' : undefined, tone: k.waiting_approvals ? 'warn' : undefined, testid: 'tk-kpi-approvals' },
    { id: 'unpaid', label: 'Unpaid proformas', value: n(k.unpaid_count), hint: k.unpaid_count ? `${money(k.unpaid_cents)} to collect` : 'Everything issued is paid', hintHref: k.unpaid_count ? '/admin/turnkey/reports#ageing' : undefined, testid: 'tk-kpi-unpaid' },
    { id: 'inspections', label: 'Inspections due in 7 days', value: n(k.inspections_due_7d), hint: k.inspections_overdue ? `${k.inspections_overdue} overdue` : k.inspections_to_schedule ? `${k.inspections_to_schedule} to schedule` : k.reports_to_review ? `${k.reports_to_review} reports to review` : 'Nothing overdue', tone: k.inspections_overdue ? 'bad' : undefined, testid: 'tk-kpi-inspections' },
    { id: 'trips', label: 'China visits in 30 days', value: n(k.trips_upcoming_30d), hint: k.trips_requested ? `${k.trips_requested} request${k.trips_requested === 1 ? '' : 's'} waiting for a fee` : 'No requests waiting', testid: 'tk-kpi-trips' },
    { id: 'enquiries', label: 'New enquiries (7 days)', value: n(k.new_enquiries_7d), hint: 'Reply with the consultation fee', hintHref: '/admin/turnkey/projects?stage=enquiry', testid: 'tk-kpi-enquiries' },
    { id: 'reviews', label: 'Inspection reports to review', value: n(k.reports_to_review), hint: null, testid: 'tk-kpi-reviews' },
    { id: 'schedule', label: 'Inspections to schedule', value: n(k.inspections_to_schedule), hint: null, testid: 'tk-kpi-to-schedule' },
  ];
}
