import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { officeHoursLabel, type OfficeHours } from './escalation';
import { initials, type AccountTeam } from './types';

/** "Your account team" card data: manager from my_account_team() + lightweight stats over the org's own sessions (RLS). */

export async function getAccountTeam(sb: SupabaseClient): Promise<AccountTeam | null> {
  const { data } = await sb.rpc('my_account_team');
  const t = data as Record<string, unknown> | null;
  if (!t || !t.staff_user_id) return null;
  const name = String(t.name ?? 'Your account manager');
  return {
    staff_user_id: String(t.staff_user_id),
    name,
    first_name: name.split(/\s+/)[0] || name,
    initials: initials(name, 'AM'),
    title: String(t.title ?? 'Dedicated account manager'),
    team: (t.team as string) ?? null,
    office: (t.office as string) ?? null,
    out_of_office: !!t.out_of_office,
    email: (t.email as string) ?? null,
    phone: (t.phone as string) ?? null,
    hours_label: officeHoursLabel((t.hours as OfficeHours) ?? null),
  };
}

export type TeamStats = {
  sessions: number;
  resolvedByBot: number;
  botResolutionPct: number | null;
  slaPct: number | null;
  slaMinutes: number;
  escalations: number;
  satisfactionPct: number | null;
  ratings: number;
};

export async function getTeamStats(sb: SupabaseClient, orgId: string, slaMinutes: number): Promise<TeamStats> {
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const [{ data: sess }, { data: esc }, { data: fb }] = await Promise.all([
    sb.from('assistant_sessions').select('id, escalation_id').eq('org_id', orgId).gte('started_at', since).limit(2000),
    sb.from('escalations').select('id, taken_at, sla_due_at, requested_at').eq('org_id', orgId).gte('requested_at', new Date(Date.now() - 31 * 86400000).toISOString()).limit(1000),
    sb.from('assistant_feedback').select('thumbs_up').eq('org_id', orgId).limit(2000),
  ]);
  const sessions = (sess ?? []).length;
  const resolvedByBot = (sess ?? []).filter((s) => !s.escalation_id).length;
  const escRows = (esc ?? []) as { taken_at: string | null; sla_due_at: string | null }[];
  const due = escRows.filter((e) => e.taken_at || (e.sla_due_at && new Date(e.sla_due_at).getTime() < Date.now()));
  const inSla = due.filter((e) => e.taken_at && (!e.sla_due_at || new Date(e.taken_at) <= new Date(e.sla_due_at))).length;
  const ratings = (fb ?? []).length;
  const ups = (fb ?? []).filter((f) => f.thumbs_up).length;
  return {
    sessions,
    resolvedByBot,
    botResolutionPct: sessions ? Math.round((100 * resolvedByBot) / sessions) : null,
    slaPct: due.length ? Math.round((100 * inSla) / due.length) : null,
    slaMinutes,
    escalations: escRows.length,
    satisfactionPct: ratings ? Math.round((100 * ups) / ratings) : null,
    ratings,
  };
}
