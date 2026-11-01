import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';

/**
 * Request-scoped trace id (SPEC §21, prompt 21-A "Before running").
 *
 * - `proxy.ts` mints `x-trace-id` on every request (or keeps a valid incoming one) and forwards it as a request header.
 * - Server code reads it with `currentTraceId()`: first from an explicit `withTrace()` scope (outbox worker, cron,
 *   background work), otherwise from the current Next.js request's headers. Outside a request (prerender, `use cache`)
 *   it returns null — those reads never write business rows.
 * - `lib/supabase/server.ts` puts it on every Supabase request as header `x-trace-id`; Postgres reads it with
 *   `app_trace_id()` and BEFORE INSERT triggers stamp `trace_id` on status_history, journals, ledger_entries,
 *   outbox_events, audit_log, integration_logs, webhook_deliveries, notifications, email_deliveries, idempotency_hits.
 */
export const TRACE_HEADER = 'x-trace-id';
/** Header sent to adapters / outbound webhooks so partners can quote the id back (SPEC §21.4 step 3). */
export const OUTBOUND_TRACE_HEADER = 'x-octopus-trace';

const TRACE_RE = /^[A-Za-z0-9._:-]{8,64}$/;
const store = new AsyncLocalStorage<{ traceId: string }>();

export function isTraceId(v: string | null | undefined): v is string {
  return !!v && TRACE_RE.test(v);
}

export function newTraceId() {
  return crypto.randomUUID();
}

/** Runs `fn` with an explicit trace id (worker jobs carry the event's trace id into everything they write). */
export function withTrace<T>(traceId: string | null | undefined, fn: () => T): T {
  return store.run({ traceId: isTraceId(traceId) ? traceId : newTraceId() }, fn);
}

/** The trace id of the current scope, or null when there is none (never throws). */
export function currentTraceId(): string | null {
  const s = store.getStore();
  if (s) return s.traceId;
  try {
    const unit = workUnitAsyncStorage.getStore();
    // only a live request has request headers; prerender / cache scopes must not touch them
    if (unit && unit.type === 'request') {
      const v = unit.headers.get(TRACE_HEADER);
      return isTraceId(v) ? v : null;
    }
  } catch {
    // not inside Next.js (scripts, tests)
  }
  return null;
}

export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');

/** One structured JSON log line carrying the trace id (Vercel log drains parse JSON lines). */
export function traceLog(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, trace_id: currentTraceId(), at: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
