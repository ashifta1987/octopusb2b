import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { redact } from '@/lib/crypto/token-box';
import { getCarrierAdapter } from './index';
import type { CarrierCode } from './types';

/**
 * Warehouse OS · W4 — carrier tracking POLLING (service role). For every live label on the way, ask the carrier for its events and
 * record the new ones through wh_tracking_record_carrier() (idempotent on the carrier's event id). Sandbox labels are never polled.
 * C0: scheduled — pg_cron job_carrier_tracking_poll() → GET /api/cron/carrier-tracking-poll every 30 minutes, only while a live
 * label is on the way (no live carrier account yet → no call at all). Each run writes one integration_logs row
 * (integration_code 'carrier-tracking-poll') that the staff connector health card shows; carrier errors are redacted, never a key.
 */
export async function pollCarrierTracking(limit = 100): Promise<{ checked: number; recorded: number; failed: number }> {
  const sb = createAdminClient();
  const started = Date.now();
  const { data, error } = await sb.rpc('wh_tracking_poll_targets', { p_limit: limit });
  if (error) throw new Error(`poll targets: ${error.message}`);
  let recorded = 0;
  let failed = 0;
  let lastError: string | null = null;
  const rows = (data ?? []) as { shipment_id: string; carrier: CarrierCode; tracking_no: string; credential_env: string | null }[];
  for (const r of rows) {
    try {
      const adapter = getCarrierAdapter({ carrier: r.carrier, mode: 'live', credentialEnv: r.credential_env });
      for (const ev of await adapter.fetchTracking(r.tracking_no)) {
        const { data: added, error: e } = await sb.rpc('wh_tracking_record_carrier', {
          p_carrier: r.carrier, p_tracking_no: r.tracking_no, p_provider_event: ev.providerEventId, p_status: ev.status,
          p_description: ev.description, p_location: ev.location ?? null, p_occurred_at: ev.occurredAt,
        });
        if (e) throw new Error(e.message);
        if (added === true) recorded++;
      }
    } catch (e) {
      failed++;
      lastError = redact(e instanceof Error ? e.message : String(e)).slice(0, 160);
    }
  }
  if (rows.length > 0) {
    await sb.from('integration_logs').insert({
      integration_code: 'carrier-tracking-poll',
      direction: 'out',
      status: failed ? (failed === rows.length ? 502 : 207) : 200,
      duration_ms: Date.now() - started,
      summary: `carrier tracking poll: ${rows.length} label(s) checked, ${recorded} new event(s)${failed ? `, ${failed} failed (last: ${lastError})` : ''}`,
    });
  }
  return { checked: rows.length, recorded, failed };
}
