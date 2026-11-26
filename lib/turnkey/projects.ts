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

const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * One project by its TKP- code with its phases, client history and the account manager's name. Row-level security
 * decides who gets it: customers of the project's company, or Turnkey staff in the TK division. Null when not visible.
 */
export async function getTkClientProject(code: string) {
  const sb = await createClient();
  const { data } = await sb.from('tk_client_projects').select(TK_CLIENT_PROJECT_COLS).eq('code', code).maybeSingle();
  if (!data) return null;
  const p = data as unknown as TkClientProject;
  const project: TkClientProject = { ...p, floor_area_m2: num(p.floor_area_m2), budget_cents: num(p.budget_cents) };
  const [{ data: stages }, { data: events }, { data: manager }] = await Promise.all([
    sb.from('tk_client_project_stages').select('stage, started_at, completed_at, due_on').eq('project_id', project.id),
    sb.from('tk_client_project_events').select('id, kind, from_stage, to_stage, status, message, created_at').eq('project_id', project.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
    sb.rpc('tk_project_manager_name', { p_project: project.id }),
  ]);
  return {
    project,
    stages: (stages ?? []) as TkStageRow[],
    events: (events ?? []) as TkProjectEvent[],
    managerName: (manager as string | null) ?? null,
  };
}
