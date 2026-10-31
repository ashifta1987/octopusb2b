import 'server-only';
import crypto from 'node:crypto';
import { connection } from 'next/server';
import { getMaintenance, maintenanceResponse } from '@/lib/backup/maintenance';
import { authenticate, requireScope, type ApiContext } from './auth';
import { problem } from './problem';
import { rateHeaders, rateLimit } from './rate-limit';

/**
 * Public API route wrapper: maintenance mode (503) → token check → rate limit → scope check → Idempotency-Key (POST) → handler (SPEC §9).
 * Errors are RFC 7807 problem+json. Every response carries X-RateLimit-* and Octopus-Mode headers.
 */
export type Params = Record<string, string | string[] | undefined>;
export type HandlerArgs<P extends Params> = { ctx: ApiContext; req: Request; url: URL; body: unknown; params: P };
type Options = { scopes?: string[]; idempotent?: boolean };

export function apiRoute<P extends Params = Params>(opts: Options, fn: (a: HandlerArgs<P>) => Promise<Response>) {
  return async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
    await connection(); // always dynamic (never prerendered)
    try {
      // SPEC §16.3: during a production restore the public API answers 503 + Retry-After (setting cached ~15 s)
      const maintenance = await getMaintenance();
      if (maintenance.enabled) return maintenanceResponse(maintenance);

      const auth = await authenticate(req);
      if (auth instanceof Response) return auth;
      const ctx = auth;

      const rl = rateLimit(`key:${ctx.keyId}`);
      const rh = rateHeaders(rl);
      if (!rl.ok) return problem(429, 'RATE_LIMITED', `Rate limit of ${rl.limit} requests/minute exceeded.`, { headers: rh });

      const denied = requireScope(ctx, ...(opts.scopes ?? []));
      if (denied) return withHeaders(denied, rh, ctx);

      const url = new URL(req.url);
      const params = (await route.params) ?? ({} as P);
      const isWrite = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT';
      let raw = '';
      let body: unknown = undefined;
      if (isWrite) {
        raw = await req.text();
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            return withHeaders(problem(400, 'INVALID_JSON', 'Request body must be valid JSON.'), rh, ctx);
          }
        }
      }

      const needsIdem = opts.idempotent ?? req.method === 'POST';
      if (!needsIdem) return withHeaders(await fn({ ctx, req, url, body, params }), rh, ctx);

      const idem = req.headers.get('idempotency-key')?.trim();
      if (!idem) return withHeaders(problem(400, 'IDEMPOTENCY_KEY_REQUIRED', 'POST requests need an Idempotency-Key header (e.g. a UUID).'), rh, ctx);
      if (idem.length > 255) return withHeaders(problem(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be at most 255 characters.'), rh, ctx);

      const storeKey = `api:${ctx.orgId}:${ctx.mode}:${idem}`;
      const scope = `${req.method} ${url.pathname}`;
      const reqHash = crypto.createHash('sha256').update(raw).digest('hex');
      const claim = await ctx.sb.from('idempotency_keys').insert({ key: storeKey, scope, response: null });
      if (claim.error) {
        if (claim.error.code !== '23505') throw new Error(claim.error.message);
        const { data: prev } = await ctx.sb.from('idempotency_keys').select('scope, response').eq('key', storeKey).maybeSingle();
        const saved = prev?.response as { status: number; body: unknown; hash: string } | null;
        if (prev && prev.scope !== scope) return withHeaders(problem(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different endpoint.'), rh, ctx);
        if (!saved) return withHeaders(problem(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed.', { headers: { 'Retry-After': '2' } }), rh, ctx);
        if (saved.hash !== reqHash) return withHeaders(problem(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request body.'), rh, ctx);
        const replay = new Response(JSON.stringify(saved.body), {
          status: saved.status,
          headers: { 'Content-Type': saved.status >= 400 ? 'application/problem+json' : 'application/json', 'Idempotent-Replayed': 'true' },
        });
        return withHeaders(replay, rh, ctx);
      }

      let res: Response;
      try {
        res = await fn({ ctx, req, url, body, params });
      } catch (e) {
        await ctx.sb.from('idempotency_keys').delete().eq('key', storeKey);
        throw e;
      }
      if (res.status >= 500) {
        await ctx.sb.from('idempotency_keys').delete().eq('key', storeKey); // allow a safe retry
      } else {
        const text = await res.clone().text();
        let saved: unknown = null;
        try {
          saved = text ? JSON.parse(text) : null;
        } catch {
          saved = text;
        }
        await ctx.sb.from('idempotency_keys').update({ response: { status: res.status, body: saved, hash: reqHash } }).eq('key', storeKey);
      }
      return withHeaders(res, rh, ctx);
    } catch (e) {
      console.error('[api] unhandled', e);
      return problem(500, 'INTERNAL', 'Unexpected error. It is safe to retry with the same Idempotency-Key.');
    }
  };
}

function withHeaders(res: Response, h: Record<string, string>, ctx: ApiContext) {
  for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
  res.headers.set('Octopus-Mode', ctx.mode);
  return res;
}

/** Shared paging helper. */
export function range(page: number, perPage: number): [number, number] {
  const from = (page - 1) * perPage;
  return [from, from + perPage - 1];
}

export function pageMeta(page: number, perPage: number, total: number | null) {
  const t = total ?? 0;
  return { page, per_page: perPage, total: t, total_pages: Math.max(1, Math.ceil(t / perPage)) };
}

/** Sandbox ids for simulated (test-mode) writes. */
export function simId(prefix = 'sim') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
