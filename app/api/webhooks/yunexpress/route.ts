import { getCarrier, verifySignature } from '@/lib/adapters';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/webhooks/yunexpress — carrier tracking webhook (SPEC §7, P6).
 * Verifies `Octopus-Signature`/`X-YunExpress-Signature` (t=…,v1=… HMAC-SHA256) with YUNEXPRESS_WEBHOOK_SECRET
 * (falls back to WEBHOOK_SIGNING_SECRET), parses events through the carrier adapter and records each one with
 * system_record_tracking() — deduped by provider_event_id, shipment status + last_event_at, outbox
 * `shipment.tracking`, and order → delivered when the parcel is delivered. Replays are no-ops.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.YUNEXPRESS_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET || '';
  const sig = req.headers.get('octopus-signature') ?? req.headers.get('x-yunexpress-signature');
  const sb = createAdminClient();
  if (!verifySignature(raw, sig, secret)) {
    console.warn('[webhooks/yunexpress] bad signature');
    await sb.from('integration_logs').insert({ integration_code: 'yunexpress', direction: 'in', status: 401, summary: 'webhook signature rejected' });
    return problem(401, 'BAD_SIGNATURE', 'Invalid or expired signature.');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, 'INVALID_JSON', 'Body must be JSON.');
  }

  const events = await getCarrier('yunexpress').parseWebhook(body, req.headers);
  const result = { received: events.length, recorded: 0, duplicates: 0, unknown: [] as string[] };
  for (const e of events) {
    if (!e.providerEventId || !e.trackingNo || !e.status) {
      result.unknown.push(e.providerEventId ?? '(missing id)');
      continue;
    }
    const { data, error } = await sb.rpc('system_record_tracking', {
      p_tracking_no: e.trackingNo,
      p_provider_event: e.providerEventId,
      p_status: e.status,
      p_description: e.description ?? null,
      p_location: e.location ?? null,
      p_occurred_at: e.occurredAt ? new Date(e.occurredAt).toISOString() : new Date().toISOString(),
    });
    if (error) {
      if (error.message.startsWith('NOT_FOUND')) {
        result.unknown.push(e.trackingNo);
        continue;
      }
      console.error('[webhooks/yunexpress]', error.message);
      await sb.from('integration_logs').insert({ integration_code: 'yunexpress', direction: 'in', status: 500, summary: `record failed: ${error.message}`.slice(0, 500) });
      return problem(500, 'RECORD_FAILED', 'Could not record tracking event; please retry.');
    }
    if (data) result.recorded++;
    else result.duplicates++;
  }
  await sb.from('integration_logs').insert({
    integration_code: 'yunexpress',
    direction: 'in',
    status: 200,
    summary: `tracking webhook: ${result.recorded} new, ${result.duplicates} duplicate, ${result.unknown.length} unknown`,
  });
  return json({ ok: true, ...result });
}
