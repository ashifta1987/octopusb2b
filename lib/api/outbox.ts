import 'server-only';
import { getEmail } from '@/lib/adapters';
import { getMaintenance } from '@/lib/backup/maintenance';
import type { createAdminClient } from '@/lib/supabase/server';
import { currentTraceId, traceLog, withTrace } from '@/lib/trace';
import { MAX_ATTEMPTS, notificationFor, retryPlan, wantsEmail, type OutboxEvent } from './outbox-rules';
import { amt, amt0, cur } from './money';
import { deliverWebhook, isBroadcastEvent, publicEventFor, type Endpoint } from './webhooks';

type Sb = ReturnType<typeof createAdminClient>;

/**
 * Outbox worker (SPEC §10). Claims due events (SKIP LOCKED + lease), runs consumers notify · email · webhooks_out.
 * Idempotency: every successful consumer writes job_runs(event_id, consumer); reprocessing skips it. Outgoing webhooks
 * are tracked per endpoint (`webhooks_out:<endpoint id>`), so a retry never re-sends to an endpoint that already got it.
 * Failure → attempts+1, backoff 1m/5m/30m/2h/6h, then status 'dead' (Admin → Integrations → Failed jobs).
 */
export async function processOutbox(sb: Sb, limit = 50) {
  // SPEC §16.3: queues pause while maintenance mode is on (production restore) — events stay pending and resume afterwards
  if ((await getMaintenance()).enabled) return { claimed: 0, done: 0, retried: 0, dead: 0, errors: [] as string[], paused: true };
  const { data: events, error } = await sb.rpc('claim_outbox_events', { p_limit: limit, p_lease_seconds: 300 });
  if (error) throw new Error(error.message);
  const list = (events ?? []) as OutboxEvent[];
  const summary = { claimed: list.length, done: 0, retried: 0, dead: 0, errors: [] as string[], paused: false };
  if (!list.length) return summary;

  const { data: runs } = await sb.from('job_runs').select('event_id, consumer').in('event_id', list.map((e) => e.id));
  const doneRuns = new Set((runs ?? []).map((r) => `${r.event_id}|${r.consumer}`));
  const env = await loadEnv(sb);

  for (const ev of list) {
    // SPEC §21: the event's trace id travels into everything this event causes (job_runs, notifications,
    // email_deliveries, webhook_deliveries, integration_logs) and onto outbound calls as x-octopus-trace
    await withTrace(ev.trace_id ?? currentTraceId(), () => processEvent(sb, ev, doneRuns, env, summary));
  }
  return summary;
}

async function processEvent(
  sb: Sb,
  ev: OutboxEvent,
  doneRuns: Set<string>,
  env: Awaited<ReturnType<typeof loadEnv>>,
  summary: { claimed: number; done: number; retried: number; dead: number; errors: string[]; paused: boolean },
) {
  const failures: string[] = [];
  traceLog('info', 'outbox_pickup', { event_id: ev.id, event_type: ev.event_type, attempt: ev.attempts + 1, queued_ms: ev.created_at ? Date.now() - Date.parse(ev.created_at) : null });
  const run = async (consumer: string, fn: () => Promise<void | 'skipped'>) => {
    if (doneRuns.has(`${ev.id}|${consumer}`)) {
      // SPEC §10.2: redelivery of an event is a no-op per consumer — recorded so a replay is provable (SPEC §21)
      await sb.from('idempotency_hits').insert({ scope: `outbox:${consumer}`, key: ev.id, original_trace_id: ev.trace_id ?? null, detail: { event_type: ev.event_type, attempt: ev.attempts + 1 } });
      return;
    }
    const t0 = Date.now();
    try {
      const r = await fn();
      const { error: e } = await sb.from('job_runs').insert({ event_id: ev.id, consumer, outcome: r === 'skipped' ? 'skipped' : 'ok', duration_ms: Date.now() - t0 });
      if (e && e.code !== '23505') throw new Error(e.message);
      doneRuns.add(`${ev.id}|${consumer}`);
    } catch (e) {
      failures.push(`${consumer}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const orgId = typeof ev.payload?.org_id === 'string' ? (ev.payload.org_id as string) : null;
  // the organization may have been deleted after the event was written (e.g. a removed test org): nothing to deliver,
  // so every consumer is recorded as skipped instead of failing into the dead-letter queue
  const orgGone = orgId ? !(await sb.from('organizations').select('id').eq('id', orgId).maybeSingle()).data : false;
  if (orgId && orgGone) {
    traceLog('warn', 'outbox_org_missing', { event_id: ev.id, event_type: ev.event_type, org_id: orgId });
    await run('notify', async () => 'skipped');
  } else if (orgId) {
    await run('notify', () => notify(sb, ev, orgId));
    if (wantsEmail(ev)) await run('email', () => email(sb, ev, orgId, env));
    const pub = publicEventFor(ev.event_type);
    if (pub) await run('webhooks_out', () => webhooksOut(sb, ev, orgId, pub, doneRuns));
  } else {
    // platform-wide events (settings.currency_changed): deliver to every org's subscribed endpoints
    const pub = publicEventFor(ev.event_type);
    if (pub && isBroadcastEvent(pub)) await run('webhooks_out', () => webhooksOut(sb, ev, null, pub, doneRuns));
  }

  if (!failures.length) {
    await sb.from('outbox_events').update({ status: 'done', last_error: null }).eq('id', ev.id);
    summary.done++;
  } else {
    const plan = retryPlan(ev.attempts);
    await sb
      .from('outbox_events')
      .update({ status: plan.status, attempts: plan.attempts, available_at: plan.availableAt, last_error: failures.join(' | ').slice(0, 2000) })
      .eq('id', ev.id);
    if (plan.status === 'dead') {
      summary.dead++;
      traceLog('error', 'outbox_dead_letter', { event_id: ev.id, event_type: ev.event_type, failures });
      await alertDeadLetter(sb, ev, failures);
    } else {
      summary.retried++;
      traceLog('warn', 'outbox_retry', { event_id: ev.id, event_type: ev.event_type, attempts: plan.attempts, next_at: plan.availableAt, failures });
    }
    summary.errors.push(`${ev.event_type} ${ev.id}: ${failures.join(' | ')}`);
  }
}

/**
 * SPEC §10.2 "alert on dead letters": every admin gets an in-app notification linking to Admin → Integrations →
 * Failed jobs, and integration_logs gets an 'outbox' row with the trace id. (Sentry is not configured — SC/IN-02.)
 */
async function alertDeadLetter(sb: Sb, ev: OutboxEvent, failures: string[]) {
  try {
    const { data: admins } = await sb.from('user_roles').select('user_id').eq('role_code', 'admin');
    const rows = [...new Set((admins ?? []).map((a) => a.user_id as string))].map((user_id) => ({
      user_id,
      title: 'Outbox job failed permanently',
      body: `${ev.event_type} moved to Failed jobs after ${MAX_ATTEMPTS} retries.`,
      link: '/admin/integrations',
      trace_id: ev.trace_id ?? currentTraceId(),
    }));
    if (rows.length) await sb.from('notifications').insert(rows);
    await sb.from('integration_logs').insert({
      integration_code: 'outbox',
      direction: 'out',
      status: 500,
      summary: `dead letter ${ev.event_type} ${ev.id}: ${failures.join(' | ')}`.slice(0, 500),
      endpoint: 'outbox://dead-letter',
      event_id: ev.id,
    });
  } catch (e) {
    traceLog('error', 'outbox_dead_letter_alert_failed', { event_id: ev.id, error: e instanceof Error ? e.message : String(e) });
  }
}

async function loadEnv(sb: Sb) {
  const { data: company } = await sb.from('company_profile').select('brand, legal_name, email, address').eq('id', 1).maybeSingle();
  return { site: (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, ''), company };
}

async function notify(sb: Sb, ev: OutboxEvent, orgId: string) {
  const n = notificationFor(ev);
  if (!n) return;
  const { error } = await sb.from('notifications').insert({ org_id: orgId, title: n.title, body: n.body, link: n.link, trace_id: ev.trace_id ?? currentTraceId() });
  if (error) throw new Error(error.message);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function email(sb: Sb, ev: OutboxEvent, orgId: string, env: Awaited<ReturnType<typeof loadEnv>>) {
  const n = notificationFor(ev);
  if (!n) return;
  const { data: members } = await sb.from('org_members').select('user_id').eq('org_id', orgId);
  const ids = (members ?? []).map((m) => m.user_id);
  if (!ids.length) return;
  const { data: profiles } = await sb.from('profiles').select('email, full_name, active').in('id', ids);
  const recipients = (profiles ?? []).filter((p) => p.email && p.active !== false);
  if (!recipients.length) return;

  const brand = env.company?.brand ?? env.company?.legal_name ?? '';
  const link = env.site ? env.site + n.link : n.link;
  const { data: tpl } = await sb.from('email_templates').select('subject, body').eq('code', ev.event_type).maybeSingle();
  const fill = (s: string, name: string) =>
    s.replaceAll('{{title}}', esc(n.title)).replaceAll('{{body}}', esc(n.body)).replaceAll('{{link}}', esc(link)).replaceAll('{{name}}', esc(name)).replaceAll('{{brand}}', esc(brand));

  const mailer = getEmail();
  for (const r of recipients) {
    const subject = tpl ? fill(tpl.subject, r.full_name ?? '') : `${n.title}${brand ? ` · ${brand}` : ''}`;
    const html = tpl
      ? fill(tpl.body, r.full_name ?? '')
      : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0b1b3f">
  <p>Hello ${esc(r.full_name ?? '')},</p>
  <h2 style="font-size:18px;margin:16px 0 8px">${esc(n.title)}</h2>
  <p>${esc(n.body)}</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#1f5fff;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in your account</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="font-size:12px;color:#6b7280">${esc(brand)}${env.company?.address ? ` · ${esc(env.company.address)}` : ''}${env.company?.email ? ` · ${esc(env.company.email)}` : ''}</p>
</div>`;
    await mailer.send({ to: r.email!, subject, html }, { template: tpl ? ev.event_type : `default:${ev.event_type}`, eventId: ev.id });
  }
}

async function webhookData(sb: Sb, ev: OutboxEvent, orgId: string | null, pub: string) {
  const { org_id: _o, ...rest } = ev.payload ?? {};
  void _o;
  const base: Record<string, unknown> = { source_event: ev.event_type, object: ev.aggregate_type, object_id: ev.aggregate_id, ...rest };
  if (pub === 'settings.currency_changed') {
    const p = ev.payload ?? {};
    return {
      source_event: ev.event_type,
      object: 'currency_switch',
      object_id: ev.aggregate_id,
      from: p.from ?? null,
      to: p.to ?? null,
      currency: p.to ?? null,
      rate: { base: 'USD', quote: 'CNY', rate: p.rate == null ? null : Number(p.rate), fx_rate_id: p.fx_rate_id ?? null },
      wallet_option: p.wallet_option ?? null,
    };
  }
  if (!orgId) return base;
  if (pub === 'order.updated') {
    const orderId = ev.aggregate_type === 'order' ? ev.aggregate_id : (ev.payload?.order_id as string | undefined);
    if (orderId) {
      const { data: o } = await sb.from('orders').select('id, code, status, total_cents, paid_cents, currency, updated_at').eq('id', orderId).eq('org_id', orgId).maybeSingle();
      if (o)
        base.order = {
          id: o.id,
          code: o.code,
          status: o.status,
          currency: cur(o.currency),
          total: amt0(o.total_cents, o.currency),
          paid: amt0(o.paid_cents, o.currency),
          balance: amt0(o.total_cents - o.paid_cents, o.currency),
          updated_at: o.updated_at,
        };
    }
  } else if (pub === 'quote.created' && ev.aggregate_id) {
    const { data: q } = await sb.from('quotes').select('id, code, rfq_id, unit_price_cents, quantity, shipping_cents, currency, incoterm, status, valid_until').eq('id', ev.aggregate_id).maybeSingle();
    if (q) {
      const { unit_price_cents, shipping_cents, currency, ...rest } = q;
      base.quote = {
        ...rest,
        currency: cur(currency),
        unit_price: amt0(unit_price_cents, currency),
        shipping: amt0(shipping_cents, currency),
        total: amt0(unit_price_cents * q.quantity + shipping_cents, currency),
      };
    }
  } else if (pub === 'rfq.created' && ev.aggregate_id) {
    const { data: q } = await sb.from('rfqs').select('id, code, title, quantity, unit, status, destination_country, incoterm, created_at').eq('id', ev.aggregate_id).eq('org_id', orgId).maybeSingle();
    if (q) base.rfq = q;
  } else if (pub === 'wallet.updated') {
    const { data: ws } = await sb.from('wallets').select('currency, balance_minor').eq('org_id', orgId);
    base.balances = (ws ?? []).map((w) => amt(w.balance_minor, w.currency));
    if (typeof ev.payload?.amount_cents === 'number') {
      base.amount = amt(ev.payload.amount_cents, ev.payload.currency);
      delete base.amount_cents;
    }
  }
  // payload fields copied from the DB event must not leak bare *_cents integers
  for (const k of Object.keys(base)) if (k.endsWith('_cents')) delete base[k];
  return base;
}

async function webhooksOut(sb: Sb, ev: OutboxEvent, orgId: string | null, pub: string, doneRuns: Set<string>) {
  let q = sb.from('webhook_endpoints').select('id, org_id, url, secret, events, active').eq('active', true).contains('events', [pub]);
  if (orgId) q = q.eq('org_id', orgId);
  else if (!isBroadcastEvent(pub)) return; // never fan out org events without an org
  const { data: eps, error } = await q;
  if (error) throw new Error(error.message);
  if (!eps?.length) return;
  const data = await webhookData(sb, ev, orgId, pub);
  const failed: string[] = [];
  for (const ep of eps as Endpoint[]) {
    const consumer = `webhooks_out:${ep.id}`;
    if (doneRuns.has(`${ev.id}|${consumer}`)) continue;
    const t0 = Date.now();
    const r = await deliverWebhook(sb, ep, pub, data, { eventId: `evt_${ev.id.replace(/-/g, '')}`, attempt: ev.attempts + 1 });
    if (r.ok) {
      await sb.from('job_runs').insert({ event_id: ev.id, consumer, outcome: 'ok', duration_ms: Date.now() - t0 });
      doneRuns.add(`${ev.id}|${consumer}`);
    } else failed.push(`${ep.url} → ${r.error}`);
  }
  if (failed.length) throw new Error(failed.join('; '));
}
