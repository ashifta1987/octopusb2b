import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { getCarrierAdapter } from './index';
import type { CarrierCode } from './types';

/**
 * Warehouse OS · W4 — carrier tracking POLLING skeleton (service role). For every live label on the way, ask the carrier for its
 * events and record the new ones through wh_tracking_record_carrier() (idempotent on the carrier's event id). Sandbox labels are
 * never polled. Not scheduled yet: wire it into the cron route (app/api/cron/[job]) once a live account has credentials.
 */
export async function pollCarrierTracking(limit = 100): Promise<{ checked: number; recorded: number; failed: number }> {
  const sb = createAdminClient();
  const { data, error } = await sb.rpc('wh_tracking_poll_targets', { p_limit: limit });
  if (error) throw new Error(`poll targets: ${error.message}`);
  let recorded = 0;
  let failed = 0;
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
    } catch {
      failed++;
    }
  }
  return { checked: rows.length, recorded, failed };
}
