import 'server-only';
import { currentTraceId, OUTBOUND_TRACE_HEADER, sha256, traceLog } from '@/lib/trace';

/**
 * Adapter call logging (SPEC §7 "logs every call to integration_logs", §21.4 step 4): every outbound adapter call writes
 * one integration_logs row with the trace id, endpoint, request/response body SHA-256, status and duration.
 * Logging never breaks the business call: failures to log are written to the structured log only.
 */
export type IntegrationLog = {
  code: string;
  direction: 'out' | 'in';
  endpoint: string;
  status: number;
  summary: string;
  request?: unknown;
  response?: unknown;
  durationMs?: number;
  eventId?: string | null;
};

const body = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v) ?? '');

export async function logIntegration(l: IntegrationLog) {
  const row = {
    integration_code: l.code,
    direction: l.direction,
    status: l.status,
    summary: l.summary.slice(0, 500),
    endpoint: l.endpoint.slice(0, 300),
    request_sha: l.request === undefined ? null : sha256(body(l.request)),
    response_sha: l.response === undefined ? null : sha256(body(l.response)),
    duration_ms: l.durationMs ?? null,
    event_id: l.eventId ?? null,
    trace_id: currentTraceId(),
  };
  try {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const { error } = await createAdminClient().from('integration_logs').insert(row);
    if (error) throw new Error(error.message);
  } catch (e) {
    traceLog('warn', 'integration_log_failed', { code: l.code, endpoint: l.endpoint, error: e instanceof Error ? e.message : String(e) });
  }
  traceLog(l.status >= 400 ? 'warn' : 'info', 'adapter_call', { code: l.code, endpoint: l.endpoint, status: l.status, duration_ms: l.durationMs });
}

/** Headers every adapter adds to outbound HTTP calls so the partner can quote the trace id back. */
export function outboundTraceHeaders(): Record<string, string> {
  const id = currentTraceId();
  return id ? { [OUTBOUND_TRACE_HEADER]: id } : {};
}

/**
 * Wraps the listed async methods of an adapter: each call is timed and logged with request/response SHAs.
 * `endpointFor(method)` names the remote endpoint (sandbox adapters use a `sandbox://` pseudo-endpoint).
 */
export function traceAdapter<T extends object>(code: string, adapter: T, methods: readonly (keyof T & string)[], endpointFor: (m: string) => string): T {
  const wrapped = new Set<string>(methods);
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !wrapped.has(prop) || typeof v !== 'function') return v;
      return async (...args: unknown[]) => {
        const t0 = Date.now();
        try {
          const res = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          await logIntegration({ code, direction: 'out', endpoint: endpointFor(prop), status: 200, summary: `${prop} ok`, request: args, response: res ?? null, durationMs: Date.now() - t0 });
          return res;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logIntegration({ code, direction: 'out', endpoint: endpointFor(prop), status: 502, summary: `${prop} failed: ${msg}`, request: args, response: msg, durationMs: Date.now() - t0 });
          throw e;
        }
      };
    },
  });
}

/** One email_deliveries row per message (SPEC §21.4 step 5). Never throws. */
export async function logEmailDelivery(d: {
  template: string;
  to: string;
  provider: string;
  messageId: string | null;
  status: 'sent' | 'logged' | 'failed';
  error?: string | null;
  eventId?: string | null;
  durationMs?: number;
}) {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const { error } = await createAdminClient()
      .from('email_deliveries')
      .insert({
        template: d.template,
        recipient_hash: sha256(d.to.trim().toLowerCase()),
        provider: d.provider,
        provider_message_id: d.messageId,
        status: d.status,
        error: d.error ?? null,
        event_id: d.eventId ?? null,
        duration_ms: d.durationMs ?? null,
        trace_id: currentTraceId(),
      });
    if (error) throw new Error(error.message);
  } catch (e) {
    traceLog('warn', 'email_delivery_log_failed', { template: d.template, error: e instanceof Error ? e.message : String(e) });
  }
}
