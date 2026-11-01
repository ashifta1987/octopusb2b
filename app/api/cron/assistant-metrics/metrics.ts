/**
 * Pure computation of the daily assistant metrics — mirrors the SQL of `assistant_metrics(p_from, p_to)`
 * (migration 20261101000110) so the cron can run with the service role (the RPC's permission check refuses it).
 */
export type MetricsInput = {
  sessions: { id: string; escalation_id: string | null }[];
  botSessionIds: Set<string>;
  feedback: { thumbs_up: boolean }[];
  escalations: { taken_at: string | null; sla_due_at: string | null }[];
  botMessages: { latency_ms: number | null; tokens: number | null }[];
  now: number;
};

export type AssistantMetrics = {
  sessions: number;
  resolved_by_bot: number;
  escalated: number;
  bot_resolution_rate: number | null;
  escalation_rate: number | null;
  satisfaction: number | null;
  sla_breaches: number;
  sla_breach_rate: number | null;
  avg_latency_ms: number | null;
  tokens: number;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const rate = (n: number, d: number) => (d > 0 ? round1((100 * n) / d) : null);

export function computeAssistantMetrics(i: MetricsInput): AssistantMetrics {
  const total = i.sessions.length;
  const escalated = i.sessions.filter((s) => s.escalation_id).length;
  const resolvedByBot = i.sessions.filter((s) => !s.escalation_id && i.botSessionIds.has(s.id)).length;
  const breached = i.escalations.filter((e) => e.sla_due_at && (e.taken_at ? new Date(e.taken_at).getTime() : i.now) > new Date(e.sla_due_at).getTime()).length;
  const lat = i.botMessages.map((m) => m.latency_ms).filter((x): x is number => typeof x === 'number');
  return {
    sessions: total,
    resolved_by_bot: resolvedByBot,
    escalated,
    bot_resolution_rate: rate(total - escalated, total),
    escalation_rate: rate(escalated, total),
    satisfaction: rate(i.feedback.filter((f) => f.thumbs_up).length, i.feedback.length),
    sla_breaches: breached,
    sla_breach_rate: rate(breached, i.escalations.length),
    avg_latency_ms: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    tokens: i.botMessages.reduce((a, m) => a + (Number(m.tokens) || 0), 0),
  };
}

export type AlertThresholds = { min_bot_resolution_rate: number; max_sla_breach_rate: number };

/** Alert reasons: bot resolution under the floor (default 70%) or SLA breaches over the ceiling (default 5%). */
export function metricAlerts(m: AssistantMetrics, t: AlertThresholds = { min_bot_resolution_rate: 70, max_sla_breach_rate: 5 }): string[] {
  const out: string[] = [];
  if (m.sessions > 0 && m.bot_resolution_rate != null && m.bot_resolution_rate < t.min_bot_resolution_rate) {
    out.push(`Bot resolution rate ${m.bot_resolution_rate}% is below ${t.min_bot_resolution_rate}%.`);
  }
  if (m.sla_breach_rate != null && m.sla_breach_rate > t.max_sla_breach_rate) {
    out.push(`Escalation SLA breach rate ${m.sla_breach_rate}% is above ${t.max_sla_breach_rate}% (${m.sla_breaches} breaches).`);
  }
  return out;
}

/** Yesterday in UTC as [from, to) ISO strings. */
export function yesterdayUtc(now: number): { from: string; to: string; day: string } {
  const d = new Date(now);
  const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const from = to - 86_400_000;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), day: new Date(from).toISOString().slice(0, 10) };
}
