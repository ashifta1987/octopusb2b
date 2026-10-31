import 'server-only';
import { getEmail } from '@/lib/adapters';
import type { createAdminClient } from '@/lib/supabase/server';
import { notificationFor, retryPlan, wantsEmail, type OutboxEvent } from './outbox-rules';
import { deliverWebhook, publicEventFor, type Endpoint } from './webhooks';

type Sb = ReturnType<typeof createAdminClient>;

/**
 * Outbox worker (SPEC §10). Claims due events (SKIP LOCKED + lease), runs consumers notify · email · webhooks_out.
 * Idempotency: every successful consumer writes job_runs(event_id, consumer); reprocessing skips it. Outgoing webhooks
 * are tracked per endpoint (`webhooks_out:<endpoint id>`), so a retry never re-sends to an endpoint that already got it.
 * Failure → attempts+1, backoff 1m/5m/30m/2h/6h, then status 'dead' (Admin → Integrations → Failed jobs).
 */
export async function processOutbox(sb: Sb, limit = 50) {
  const { data: events, error } = await sb.rpc('claim_outbox_events', { p_limit: limit, p_lease_seconds: 300 });
  if (error) throw new Error(error.message);
  const list = (events ?? []) as OutboxEvent[];
  const summary = { claimed: list.length, done: 0, retried: 0, dead: 0, errors: [] as string[] };
  if (!list.length) return summary;

  const { data: runs } = await sb.from('job_runs').select('event_id, consumer').in('event_id', list.map((e) => e.id));
  const doneRuns = new Set((runs ?? []).map((r) => `${r.event_id}|${r.consumer}`));
  const env = await loadEnv(sb);

  for (const ev of list) {
    const failures: string[] = [];
    const run = async (consumer: string, fn: () => Promise<void>) => {
      if (doneRuns.has(`${ev.id}|${consumer}`)) return;
      const t0 = Date.now();
      try {
        await fn();
        const { error: e } = await sb.from('job_runs').insert({ event_id: ev.id, consumer, outcome: 'ok', duration_ms: Date.now() - t0 });
        if (e && e.code !== '23505') throw new Error(e.message);
        doneRuns.add(`${ev.id}|${consumer}`);
      } catch (e) {
        failures.push(`${consumer}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const orgId = typeof ev.payload?.org_id === 'string' ? (ev.payload.org_id as string) : null;
    if (orgId) {
      await run('notify', () => notify(sb, ev, orgId));
      if (wantsEmail(ev)) await run('email', () => email(sb, ev, orgId, env));
      const pub = publicEventFor(ev.event_type);
      if (pub) await run('webhooks_out', () => webhooksOut(sb, ev, orgId, pub, doneRuns));
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
        console.error('[outbox] dead letter', ev.id, ev.event_type, failures);
      } else summary.retried++;
      summary.errors.push(`${ev.event_type} ${ev.id}: ${failures.join(' | ')}`);
    }
  }
  return summary;
}

async function loadEnv(sb: Sb) {
  const { data: company } = await sb.from('company_profile').select('brand, legal_name, email, address').eq('id', 1).maybeSingle();
  return { site: (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, ''), company };
}

async function notify(sb: Sb, ev: OutboxEvent, orgId: string) {
  const n = notificationFor(ev);
  if (!n) return;
  const { error } = await sb.from('notifications').insert({ org_id: orgId, title: n.title, body: n.body, link: n.link });
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
    await mailer.send({ to: r.email!, subject, html });
  }
}

async function webhookData(sb: Sb, ev: OutboxEvent, orgId: string, pub: string) {
  const { org_id: _o, ...rest } = ev.payload ?? {};
  void _o;
  const base: Record<string, unknown> = { source_event: ev.event_type, object: ev.aggregate_type, object_id: ev.aggregate_id, ...rest };
  if (pub === 'order.updated') {
    const orderId = ev.aggregate_type === 'order' ? ev.aggregate_id : (ev.payload?.order_id as string | undefined);
    if (orderId) {
      const { data: o } = await sb.from('orders').select('id, code, status, total_cents, paid_cents, updated_at').eq('id', orderId).eq('org_id', orgId).maybeSingle();
      if (o) base.order = { ...o, balance_cents: o.total_cents - o.paid_cents, currency: 'USD' };
    }
  } else if (pub === 'quote.created' && ev.aggregate_id) {
    const { data: q } = await sb.from('quotes').select('id, code, rfq_id, unit_price_cents, quantity, shipping_cents, incoterm, status, valid_until').eq('id', ev.aggregate_id).maybeSingle();
    if (q) base.quote = q;
  } else if (pub === 'wallet.updated') {
    const { data: bal } = await sb.rpc('wallet_balance', { p_org: orgId });
    base.balance_cents = Number(bal ?? 0);
  }
  return base;
}

async function webhooksOut(sb: Sb, ev: OutboxEvent, orgId: string, pub: string, doneRuns: Set<string>) {
  const { data: eps, error } = await sb.from('webhook_endpoints').select('id, org_id, url, secret, events, active').eq('org_id', orgId).eq('active', true).contains('events', [pub]);
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
