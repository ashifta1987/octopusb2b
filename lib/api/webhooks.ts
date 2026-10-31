import 'server-only';
import crypto from 'node:crypto';
import { signPayload } from '@/lib/adapters';
import type { createAdminClient } from '@/lib/supabase/server';

type Sb = ReturnType<typeof createAdminClient>;
export type Endpoint = { id: string; org_id: string; url: string; secret: string; events: string[]; active: boolean };

/** Internal outbox event → public webhook event (SPEC §7: order.updated, quote.created, shipment.tracking, …). */
export function publicEventFor(eventType: string): string | null {
  if (eventType.startsWith('order.') || eventType === 'quote.approved' || eventType === 'payment.confirmed') return 'order.updated';
  if (eventType === 'quote.sent') return 'quote.created';
  if (eventType === 'shipment.tracking') return 'shipment.tracking';
  if (eventType.startsWith('service_request.')) return 'service_request.updated';
  if (eventType === 'wallet.updated') return 'wallet.updated';
  if (eventType === 'settings.currency_changed') return 'settings.currency_changed';
  return null;
}

/** Platform-wide events have no org_id: they go to every organization's endpoints that subscribe to them. */
export function isBroadcastEvent(publicEvent: string) {
  return publicEvent === 'settings.currency_changed';
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|.*\.internal$|.*\.local$)/i;

/** In production, refuse to call private/internal addresses (basic SSRF guard). */
export function deliverable(url: string) {
  try {
    const u = new URL(url);
    if (process.env.NODE_ENV !== 'production') return u.protocol === 'https:' || u.protocol === 'http:';
    return u.protocol === 'https:' && !PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Signs and POSTs one event to one endpoint and logs a webhook_deliveries row.
 * Receivers verify `Octopus-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret>`.
 */
export async function deliverWebhook(
  sb: Sb,
  ep: Endpoint,
  type: string,
  data: unknown,
  opts: { eventId?: string; attempt?: number; mode?: 'live' | 'test' } = {},
) {
  const eventId = opts.eventId ?? `evt_${crypto.randomBytes(8).toString('hex')}`;
  const payload = { id: eventId, type, created_at: new Date().toISOString(), livemode: opts.mode !== 'test', data };
  const body = JSON.stringify(payload);
  let status = 0;
  let error: string | null = null;
  if (!deliverable(ep.url)) {
    error = 'URL not deliverable (must be public https)';
  } else {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OctopusB2B-Webhooks/1.0',
          'Octopus-Signature': signPayload(body, ep.secret),
          'Octopus-Event': type,
          'Octopus-Delivery': eventId,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const ok = !error;
  await sb.from('webhook_deliveries').insert({
    endpoint_id: ep.id,
    org_id: ep.org_id,
    event_type: type,
    payload: { ...payload, ...(error ? { _error: error } : {}) },
    response_status: status || null,
    attempts: opts.attempt ?? 1,
    delivered_at: ok ? new Date().toISOString() : null,
  });
  return { ok, status, error, eventId };
}
