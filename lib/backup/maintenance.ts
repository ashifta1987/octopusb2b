import 'server-only';
import { problem } from '@/lib/api/problem';

/**
 * Maintenance mode (SPEC §16.3 step 4): site_settings.maintenance_mode {enabled, message, retry_after, since} (public row).
 * Read through the anon REST endpoint and cached in memory for ~15 s per server instance, so the public API and the
 * outbox worker can check it on every call without a DB round trip. Fails open (a settings outage never takes the API down).
 */
export type Maintenance = { enabled: boolean; message: string; retryAfter: number; since: string | null };

const OFF: Maintenance = { enabled: false, message: '', retryAfter: 900, since: null };
const TTL_MS = 15_000;
let cached: { at: number; value: Maintenance } | null = null;

export function parseMaintenance(v: unknown): Maintenance {
  if (!v || typeof v !== 'object') return OFF;
  const o = v as Record<string, unknown>;
  const retry = Number(o.retry_after);
  return {
    enabled: o.enabled === true || o.enabled === 'true',
    message: typeof o.message === 'string' && o.message ? o.message : 'We are performing scheduled maintenance. Please try again shortly.',
    retryAfter: Number.isFinite(retry) && retry > 0 ? Math.round(retry) : 900,
    since: typeof o.since === 'string' ? o.since : null,
  };
}

export async function getMaintenance(opts: { fresh?: boolean } = {}): Promise<Maintenance> {
  const now = Date.now();
  if (!opts.fresh && cached && now - cached.at < TTL_MS) return cached.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return OFF;
  try {
    const res = await fetch(`${url}/rest/v1/site_settings?key=eq.maintenance_mode&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as { value: unknown }[];
    const value = parseMaintenance(rows[0]?.value);
    cached = { at: now, value };
    return value;
  } catch {
    return cached?.value ?? OFF;
  }
}

/** Test hook / after toggling maintenance in this instance. */
export function resetMaintenanceCache() {
  cached = null;
}

/** 503 problem+json with Retry-After for the public API. */
export function maintenanceResponse(m: Maintenance) {
  return problem(503, 'MAINTENANCE', m.message, { headers: { 'Retry-After': String(m.retryAfter) }, retry_after: m.retryAfter, since: m.since });
}
