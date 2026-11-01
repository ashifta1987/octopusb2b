import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { OfficeHours } from './settings-schema';
import type { StaffCandidate } from './reassign-form';

type Sb = Awaited<ReturnType<typeof createClient>>;

export type WorkloadRow = StaffCandidate & { email: string | null; title: string | null; openEscalations: number };

/** Account-manager candidates with their load (assistant_staff_workload; admin / assistant:reassign / configure). */
export async function loadWorkload(sb: Sb): Promise<WorkloadRow[]> {
  const { data, error } = await sb.rpc('assistant_staff_workload');
  if (error || !Array.isArray(data)) return [];
  return (data as { id: string; full_name: string | null; email: string | null; team: string | null; title: string | null; out_of_office: boolean; roles: string[] | null; customers: number | string; open_escalations: number | string }[])
    .map((r) => ({
      id: r.id, name: r.full_name || r.email || 'Staff', email: r.email, title: r.title, team: r.team, outOfOffice: !!r.out_of_office,
      roles: r.roles ?? [], customers: Number(r.customers ?? 0), openEscalations: Number(r.open_escalations ?? 0),
    }));
}

export type AssistantSettings = {
  enabled: boolean;
  threshold: number;
  topics: string[];
  vip: string[];
  countryMap: Record<string, string>;
  cap: number;
  slaMinutes: number;
  rateLimit: number;
  officeHours: OfficeHours;
  costPer1k: number;
  alerts: { min_bot_resolution_rate: number; max_sla_breach_rate: number };
};

export const SETTING_KEYS = [
  'assistant_enabled', 'assistant_confidence_threshold', 'assistant_sensitive_topics', 'assistant_vip_customer_ids', 'assistant_team_country_map',
  'assistant_max_customers_per_manager', 'assistant_escalation_sla_minutes', 'assistant_rate_limit_per_min', 'assistant_office_hours',
  'assistant_cost_per_1k_tokens_usd', 'assistant_alert_thresholds',
] as const;

/** Reads the §20.4 settings (staff can read non-public settings) with the migration defaults as fallback. */
export async function loadAssistantSettings(sb: Sb): Promise<AssistantSettings> {
  const { data } = await sb.from('site_settings').select('key, value').in('key', [...SETTING_KEYS]);
  const v = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
  const oh = (v.assistant_office_hours ?? {}) as Partial<OfficeHours>;
  const al = (v.assistant_alert_thresholds ?? {}) as Partial<AssistantSettings['alerts']>;
  return {
    enabled: v.assistant_enabled !== false && v.assistant_enabled !== 'false',
    threshold: n(v.assistant_confidence_threshold, 0.6),
    topics: Array.isArray(v.assistant_sensitive_topics) ? (v.assistant_sensitive_topics as string[]) : [],
    vip: Array.isArray(v.assistant_vip_customer_ids) ? (v.assistant_vip_customer_ids as string[]) : [],
    countryMap: (v.assistant_team_country_map && typeof v.assistant_team_country_map === 'object' ? v.assistant_team_country_map : { default: 'Sourcing' }) as Record<string, string>,
    cap: n(v.assistant_max_customers_per_manager, 50),
    slaMinutes: n(v.assistant_escalation_sla_minutes, 60),
    rateLimit: n(v.assistant_rate_limit_per_min, 20),
    officeHours: { timezone: oh.timezone ?? 'Asia/Shanghai', days: Array.isArray(oh.days) ? oh.days : [1, 2, 3, 4, 5], start: oh.start ?? '09:00', end: oh.end ?? '18:00' },
    costPer1k: n(v.assistant_cost_per_1k_tokens_usd, 0.0006),
    alerts: { min_bot_resolution_rate: n(al.min_bot_resolution_rate, 70), max_sla_breach_rate: n(al.max_sla_breach_rate, 5) },
  };
}
