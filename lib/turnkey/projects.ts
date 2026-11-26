import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { TkStageRow } from './format';

/** Turnkey T2 — a client's project (tk_client_projects). Every column here is customer-safe; staff facts are separate. */
export type TkClientProject = {
  id: string; code: string; org_id: string | null; catalogue_project_id: string | null; title: string; stage: string; status: string;
  status_reason: string | null; country: string | null; city: string | null; target_open_on: string | null; floor_area_m2: number | null;
  budget_cents: number | null; currency: string; plan: string | null; source: 'web' | 'legacy_lead' | 'staff'; stage_changed_at: string;
  created_at: string; updated_at: string;
};
export const TK_CLIENT_PROJECT_COLS = 'id, code, org_id, catalogue_project_id, title, stage, status, status_reason, country, city, target_open_on, floor_area_m2, budget_cents, currency, plan, source, stage_changed_at, created_at, updated_at';
export type TkProjectEvent = { id: number; kind: string; from_stage: string | null; to_stage: string | null; status: string | null; message: string | null; created_at: string };
/** T3 — who the client deals with (names only): the cover during the cover period, else the account manager. */
export type TkProjectContact = {
  name: string | null; on_cover: boolean; usual_name: string | null; cover_name: string | null; cover_from: string | null; cover_to: string | null;
};

const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * One project by its TKP- code with its phases, client history and the account manager's name. Row-level security
 * decides who gets it: customers of the project's company, Turnkey staff in the TK division, or the staff member who
 * manages it (primary account manager, or cover during the cover period). Null when not visible.
 */
export async function getTkClientProject(code: string) {
  const sb = await createClient();
  const { data } = await sb.from('tk_client_projects').select(TK_CLIENT_PROJECT_COLS).eq('code', code).maybeSingle();
  if (!data) return null;
  const p = data as unknown as TkClientProject;
  const project: TkClientProject = { ...p, floor_area_m2: num(p.floor_area_m2), budget_cents: num(p.budget_cents) };
  const [{ data: stages }, { data: events }, { data: manager }, { data: contact }] = await Promise.all([
    sb.from('tk_client_project_stages').select('stage, started_at, completed_at, due_on').eq('project_id', project.id),
    sb.from('tk_client_project_events').select('id, kind, from_stage, to_stage, status, message, created_at').eq('project_id', project.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
    sb.rpc('tk_project_manager_name', { p_project: project.id }),
    sb.rpc('tk_project_contact', { p_project: project.id }),
  ]);
  return {
    project,
    stages: (stages ?? []) as TkStageRow[],
    events: (events ?? []) as TkProjectEvent[],
    managerName: (manager as string | null) ?? null,
    contact: (contact as TkProjectContact | null) ?? null,
  };
}

/** T3 — an approved fee as the client sees it (no proposer, approver, note or reason: those columns are staff-only). */
export type TkClientFee = {
  id: string; stage: string; service_code: string | null; service_name: string | null; version: number; amount_cents: number; currency: string;
  effective_from: string | null; document_id: string | null;
  document: { id: string; number: string | null; status: string | null; paid_cents: number; amount_cents: number } | null;
};

/** Active fees of a project (RLS: customers see active fees of their companies' projects only) with their proformas. */
export async function getTkClientFees(projectId: string): Promise<TkClientFee[]> {
  const sb = await createClient();
  const { data } = await sb.from('tk_project_fees')
    .select('id, stage, service_code, version, amount_cents, currency, effective_from, document_id')
    .eq('project_id', projectId).eq('status', 'active');
  const rows = (data ?? []) as { id: string; stage: string; service_code: string | null; version: number; amount_cents: number; currency: string; effective_from: string | null; document_id: string | null }[];
  if (!rows.length) return [];
  const docIds = rows.map((r) => r.document_id).filter((x): x is string => !!x);
  const codes = rows.map((r) => r.service_code).filter((x): x is string => !!x);
  const [{ data: docs }, { data: services }] = await Promise.all([
    docIds.length ? sb.from('documents').select('id, number, status, paid_cents, amount_cents').in('id', docIds) : Promise.resolve({ data: [] }),
    codes.length ? sb.from('tk_services').select('code, name').in('code', codes) : Promise.resolve({ data: [] }),
  ]);
  const docMap = new Map(((docs ?? []) as { id: string; number: string | null; status: string | null; paid_cents: number | null; amount_cents: number | null }[])
    .map((d) => [d.id, { id: d.id, number: d.number, status: d.status, paid_cents: Number(d.paid_cents ?? 0), amount_cents: Number(d.amount_cents ?? 0) }]));
  const names = new Map(((services ?? []) as { code: string; name: string }[]).map((s) => [s.code, s.name]));
  return rows.map((r) => ({
    ...r,
    amount_cents: Number(r.amount_cents),
    service_name: r.service_code ? names.get(r.service_code) ?? null : null,
    document: r.document_id ? docMap.get(r.document_id) ?? null : null,
  }));
}
