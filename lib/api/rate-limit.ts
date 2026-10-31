/**
 * Fixed-window rate limiter, per API key (SPEC §7: 60 requests/minute → 429 + Retry-After).
 *
 * NOTE: this store is in-memory, i.e. per serverless instance. It protects against bursts on a warm instance but is
 * not a global limit. Production should move this to a shared store (Upstash Redis / Vercel Runtime Cache, or the
 * `rate_limits` table) keyed the same way.
 */
export type RateResult = { ok: boolean; limit: number; remaining: number; resetSec: number; retryAfterSec: number };

const buckets = new Map<string, { windowStart: number; count: number }>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000, now = Date.now()): RateResult {
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  const resetMs = b.windowStart + windowMs - now;
  const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.windowStart >= windowMs) buckets.delete(k);
  }
  const ok = b.count <= limit;
  return { ok, limit, remaining: Math.max(0, limit - b.count), resetSec, retryAfterSec: ok ? 0 : resetSec };
}

export function rateHeaders(r: RateResult): Record<string, string> {
  const h: Record<string, string> = {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(r.resetSec),
  };
  if (!r.ok) h['Retry-After'] = String(r.retryAfterSec);
  return h;
}

/** Test helper. */
export function _resetRateLimits() {
  buckets.clear();
}
