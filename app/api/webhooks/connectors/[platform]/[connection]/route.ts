import { after } from 'next/server';
import { json, problem } from '@/lib/api/problem';
import { createAdminClient } from '@/lib/supabase/server';
import { readCredential } from '@/lib/connectors/credentials';
import { getConnector } from '@/lib/connectors/registry';
import { connectorInboxNow } from '@/lib/connectors/runtime-server';
import { handleConnectorWebhook, headerRecord, WEBHOOK_MAX_BYTES } from '@/lib/connectors/webhook';
import { traceLog } from '@/lib/trace';

/**
 * POST /api/webhooks/connectors/{platform}/{connection} — CONN S1: one signed webhook address per store connection (Shopify keeps its
 * own app route). The connector verifies the platform signature over the raw body with the connection's sealed webhook secret; the
 * event lands in webhook_inbox (deduped) and is processed right after the answer (after()) and again by the 5-minute job if that fails.
 * Answers fast; never echoes the payload, the store or a secret.
 */
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ platform: string; connection: string }> }) {
  const { platform, connection } = await params;
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > WEBHOOK_MAX_BYTES) return problem(413, 'TOO_LARGE', 'The body is larger than 1 MB.');
  const rawBody = await req.text();
  const sb = createAdminClient();
  try {
    const out = await handleConnectorWebhook({
      getConnector,
      findConnection: async (id) => {
        const { data, error } = await sb.from('store_connections').select('id, platform, status').eq('id', id).maybeSingle();
        if (error) throw new Error('lookup failed');
        return data;
      },
      readSecret: async (id) => (await readCredential(id, 'webhook_secret'))?.value ?? null,
      receive: async (i) => {
        const { data, error } = await sb.rpc('c1_webhook_receive', {
          p_platform: i.platform, p_connection: i.connectionId, p_event_id: i.eventId, p_topic: i.topic, p_signature_ok: i.signatureOk, p_payload: i.payload,
        });
        if (error) throw new Error('inbox write failed');
        return data as { id: string | null; duplicate: boolean };
      },
    }, { platform, connection, headers: headerRecord(req.headers), rawBody });
    if (out.status !== 200) {
      if (out.status === 401) traceLog('warn', 'connector_webhook_bad_signature', { platform });
      return problem(out.status, out.code, out.detail);
    }
    if (out.process) after(async () => { try { await connectorInboxNow(10); } catch (e) { traceLog('warn', 'connector_inbox_after_failed', { platform, error: e instanceof Error ? e.message.slice(0, 200) : 'error' }); } });
    return json(out.body);
  } catch (e) {
    traceLog('error', 'connector_webhook_failed', { platform, error: e instanceof Error ? e.message.slice(0, 200) : 'error' });
    // 503 → the platform retries later; nothing was lost
    return problem(503, 'TRY_LATER', 'Could not record the event. Try again.');
  }
}
