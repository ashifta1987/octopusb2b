import { getEmail } from '@/lib/adapters';
import { checkCron } from '@/lib/api/cron';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';
import { computeAssistantMetrics, metricAlerts, yesterdayUtc, type AlertThresholds } from './metrics';

/**
 * GET /api/cron/assistant-metrics (Vercel Cron, daily; `Authorization: Bearer ${CRON_SECRET}`) — SPEC §20 prompt 20-A item 10.
 * Computes yesterday's (UTC) assistant metrics with service-role queries (assistant_metrics() refuses the service role),
 * stores them in integration_logs (integration_code 'assistant', summary = JSON) and alerts when the bot resolution rate
 * is under 70% or the escalation SLA breach rate is over 5% (thresholds: site_settings assistant_alert_thresholds):
 * email to backup_settings.alert_email (else company_profile.email) + in-app notifications to every Admin.
 * Idempotent per day (`?force=1` recomputes and re-alerts).
 */
export const maxDuration = 60;

type Sb = ReturnType<typeof createAdminClient>;
const PAGE = 1000;

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await build(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function GET(req: Request) {
  const denied = checkCron(req);
  if (denied) return denied;
  const force = new URL(req.url).searchParams.get('force') === '1';
  const sb = createAdminClient();
  const now = Date.now();
  const { from, to, day } = yesterdayUtc(now);
  try {
    if (!force) {
      const { data: done } = await sb.from('integration_logs').select('id').eq('integration_code', 'assistant').like('summary', `%"day":"${day}"%`).limit(1);
      if (done?.length) return json({ ok: true, skipped: 'already computed', day });
    }
    const metrics = await compute(sb, from, to, now);
    const { data: th } = await sb.from('site_settings').select('value').eq('key', 'assistant_alert_thresholds').maybeSingle();
    const t = { min_bot_resolution_rate: 70, max_sla_breach_rate: 5, ...((th?.value ?? {}) as Partial<AlertThresholds>) };
    const alerts = metricAlerts(metrics, { min_bot_resolution_rate: Number(t.min_bot_resolution_rate), max_sla_breach_rate: Number(t.max_sla_breach_rate) });
    const summary = { kind: 'assistant.daily_metrics', day, from, to, ...metrics, alerts };
    const { error: logErr } = await sb.from('integration_logs').insert({ integration_code: 'assistant', direction: 'out', status: alerts.length ? 422 : 200, summary: JSON.stringify(summary) });
    if (logErr) throw new Error(logErr.message);
    const alerted = alerts.length ? await alert(sb, day, metrics, alerts) : { emailed: false, notified: 0 };
    return json({ ok: true, day, metrics, alerts, ...alerted });
  } catch (e) {
    console.error('[cron/assistant-metrics]', e);
    return problem(500, 'ASSISTANT_METRICS_FAILED', e instanceof Error ? e.message : String(e));
  }
}

async function compute(sb: Sb, from: string, to: string, now: number) {
  const [sessions, feedback, escalations, botMessages] = await Promise.all([
    fetchAll<{ id: string; escalation_id: string | null }>((a, b) => sb.from('assistant_sessions').select('id, escalation_id').gte('started_at', from).lt('started_at', to).order('id').range(a, b)),
    fetchAll<{ thumbs_up: boolean }>((a, b) => sb.from('assistant_feedback').select('thumbs_up').gte('created_at', from).lt('created_at', to).order('id').range(a, b)),
    fetchAll<{ taken_at: string | null; sla_due_at: string | null }>((a, b) => sb.from('escalations').select('taken_at, sla_due_at').gte('requested_at', from).lt('requested_at', to).order('id').range(a, b)),
    fetchAll<{ latency_ms: number | null; tokens: number | null }>((a, b) => sb.from('assistant_messages').select('latency_ms, tokens').eq('author', 'bot').gte('created_at', from).lt('created_at', to).order('id').range(a, b)),
  ]);
  // sessions (started in the window) that got at least one bot answer — any time
  const botSessionIds = new Set<string>();
  const ids = sessions.map((s) => s.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await fetchAll<{ session_id: string }>((a, b) => sb.from('assistant_messages').select('session_id').eq('author', 'bot').in('session_id', chunk).order('id').range(a, b));
    for (const r of rows) botSessionIds.add(r.session_id);
  }
  return computeAssistantMetrics({ sessions, botSessionIds, feedback, escalations, botMessages, now });
}

async function alert(sb: Sb, day: string, m: ReturnType<typeof computeAssistantMetrics>, alerts: string[]) {
  const [{ data: bs }, { data: company }, { data: admins }] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle(),
    sb.from('company_profile').select('email').limit(1).maybeSingle(),
    sb.from('user_roles').select('user_id').eq('role_code', 'admin'),
  ]);
  const to = ((bs?.value as { alert_email?: string } | null)?.alert_email || (company?.email as string | null) || '').trim();
  const title = `Assistant metrics alert · ${day}`;
  const body = alerts.join(' ');
  let notified = 0;
  const adminIds = [...new Set((admins ?? []).map((a) => a.user_id as string))];
  if (adminIds.length) {
    const { error } = await sb.from('notifications').insert(adminIds.map((id) => ({ user_id: id, title, body: body.slice(0, 500), link: '/admin/assistant?range=7' })));
    if (!error) notified = adminIds.length;
    else console.error('[cron/assistant-metrics] notifications failed', error.message);
  }
  let emailed = false;
  if (to) {
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
    await getEmail()
      .send({
        to,
        subject: `[Octopus B2B] ${title}`,
        html: `<p>${alerts.map(esc).join('</p><p>')}</p>
          <p>Yesterday: ${m.sessions} conversations · bot resolution ${m.bot_resolution_rate ?? '—'}% · escalations ${m.escalated} · SLA breaches ${m.sla_breaches} (${m.sla_breach_rate ?? '—'}%) · satisfaction ${m.satisfaction ?? '—'}%.</p>
          <p>Review <a href="${site}/admin/assistant?range=7">Admin → Assistant</a> and the <a href="${site}/office/assistant">assistant queue</a>.</p>`,
      })
      .then(() => (emailed = true))
      .catch((e) => console.error('[cron/assistant-metrics] email failed', e));
  }
  return { emailed, notified, alert_to: to || null };
}
