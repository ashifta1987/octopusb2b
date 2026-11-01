import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import type { OfficeHours } from './escalation';

/**
 * Octo settings (SPEC §20.4). Several keys (sensitive topics, VIP list) are not public site_settings, so they are read
 * server-side with the service role and never sent to the browser in full.
 */
export type AssistantSettings = {
  enabled: boolean;
  threshold: number;
  topics: string[];
  vipIds: string[];
  officeHours: OfficeHours | null;
  slaMinutes: number;
};

const KEYS = ['assistant_enabled', 'assistant_confidence_threshold', 'assistant_sensitive_topics', 'assistant_vip_customer_ids', 'assistant_office_hours', 'assistant_escalation_sla_minutes'];

export const DEFAULT_TOPICS = ['refund', 'credit note', 'discount', 'dispute', 'qc failure', 'legal', 'tax', 'customs', 'complaint', 'cancel', 'data request'];

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const { data } = await createAdminClient().from('site_settings').select('key, value').in('key', KEYS);
  const raw: Record<string, unknown> = {};
  (data ?? []).forEach((r) => (raw[r.key as string] = r.value));
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    enabled: raw.assistant_enabled === undefined ? true : raw.assistant_enabled === true || raw.assistant_enabled === 'true',
    threshold: num(raw.assistant_confidence_threshold, 0.6),
    topics: Array.isArray(raw.assistant_sensitive_topics) ? (raw.assistant_sensitive_topics as unknown[]).map(String) : DEFAULT_TOPICS,
    vipIds: Array.isArray(raw.assistant_vip_customer_ids) ? (raw.assistant_vip_customer_ids as unknown[]).map(String) : [],
    officeHours: raw.assistant_office_hours && typeof raw.assistant_office_hours === 'object' ? (raw.assistant_office_hours as OfficeHours) : null,
    slaMinutes: num(raw.assistant_escalation_sla_minutes, 60),
  };
}
