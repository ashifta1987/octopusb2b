import { buildPostmanFiles, type Examples } from './postman';

/**
 * Postman sync (SPEC §15.2): regenerates the OpenAPI documents + collections and, when configured, pushes them to the
 * Postman workspace through the Postman API. Shared by scripts/postman-sync.mjs (CI, on release) and
 * POST /api/postman/sync (Admin → Integrations → "Sync now"). No server-only imports: plain Node loads it.
 *
 * Env: POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID (required to push), POSTMAN_COLLECTION_ID_PUBLIC,
 * POSTMAN_COLLECTION_ID_SUPPLIER (update in place; created in the workspace when missing — store the returned uid),
 * POSTMAN_API_ID (+ optional POSTMAN_API_SCHEMA_ID) to update the API definition,
 * POSTMAN_ENVIRONMENT_ID_SANDBOX / POSTMAN_ENVIRONMENT_ID_LIVE (optional; environments are pushed with empty secrets).
 */
export const POSTMAN_API = 'https://api.getpostman.com';

export type SyncStep = { target: string; action: 'updated' | 'created' | 'skipped' | 'failed'; id?: string | null; status?: number; error?: string };
export type SyncResult = {
  ok: boolean;
  pushed: boolean;
  reason?: string;
  steps: SyncStep[];
  files: string[];
  startedAt: string;
  durationMs: number;
};

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const pick = (env: Env, k: string) => (env[k] ?? '').trim() || null;

async function call(fetcher: FetchLike, key: string, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetcher(POSTMAN_API + path, {
    method,
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json?.error as { message?: string; name?: string } | undefined) ?? undefined;
    throw Object.assign(new Error(err?.message ?? err?.name ?? `HTTP ${res.status}`), { status: res.status });
  }
  return { status: res.status, json };
}

async function upsertCollection(f: FetchLike, key: string, ws: string, id: string | null, collection: unknown, label: string): Promise<SyncStep> {
  try {
    if (id) {
      const r = await call(f, key, 'PUT', `/collections/${encodeURIComponent(id)}`, { collection });
      return { target: label, action: 'updated', id, status: r.status };
    }
    const r = await call(f, key, 'POST', `/collections?workspace=${encodeURIComponent(ws)}`, { collection });
    const uid = ((r.json?.collection as { uid?: string; id?: string } | undefined)?.uid ?? null) as string | null;
    return { target: label, action: 'created', id: uid, status: r.status };
  } catch (e) {
    return { target: label, action: 'failed', id, status: (e as { status?: number }).status, error: (e as Error).message };
  }
}

async function upsertEnvironment(f: FetchLike, key: string, ws: string, id: string | null, environment: unknown, label: string): Promise<SyncStep> {
  if (!id) return { target: label, action: 'skipped', error: 'no environment id configured' };
  try {
    const r = await call(f, key, 'PUT', `/environments/${encodeURIComponent(id)}?workspace=${encodeURIComponent(ws)}`, { environment });
    return { target: label, action: 'updated', id, status: r.status };
  } catch (e) {
    return { target: label, action: 'failed', id, status: (e as { status?: number }).status, error: (e as Error).message };
  }
}

/** Updates the OpenAPI definition of a Postman API (v10 APIs: schema file `openapi.json`). */
async function updateApiDefinition(f: FetchLike, key: string, apiId: string, schemaId: string | null, openapi: unknown): Promise<SyncStep> {
  const v10 = { Accept: 'application/vnd.api.v10+json' };
  try {
    let sid = schemaId;
    if (!sid) {
      const r = await call(f, key, 'GET', `/apis/${encodeURIComponent(apiId)}?include=schemas`, undefined, v10);
      const schemas = (r.json?.schemas as { id: string }[] | undefined) ?? [];
      sid = schemas[0]?.id ?? null;
    }
    if (!sid) {
      const r = await call(f, key, 'POST', `/apis/${encodeURIComponent(apiId)}/schemas`, { type: 'openapi:3_1', files: [{ path: 'openapi.json', content: JSON.stringify(openapi) }] }, v10);
      return { target: 'api definition', action: 'created', id: (r.json?.id as string | undefined) ?? null, status: r.status };
    }
    const r = await call(f, key, 'PUT', `/apis/${encodeURIComponent(apiId)}/schemas/${encodeURIComponent(sid)}/files/openapi.json`, { content: JSON.stringify(openapi) }, v10);
    return { target: 'api definition', action: 'updated', id: sid, status: r.status };
  } catch (e) {
    return { target: 'api definition', action: 'failed', id: apiId, status: (e as { status?: number }).status, error: (e as Error).message };
  }
}

export async function runPostmanSync(opts: { env: Env; examples?: Examples; fetch?: FetchLike }): Promise<{ result: SyncResult; files: Record<string, unknown> }> {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const files = buildPostmanFiles(opts.examples ?? {});
  const names = Object.keys(files);
  const key = pick(opts.env, 'POSTMAN_API_KEY');
  const ws = pick(opts.env, 'POSTMAN_WORKSPACE_ID');
  if (!key || !ws) {
    return {
      files,
      result: { ok: true, pushed: false, reason: 'POSTMAN_API_KEY / POSTMAN_WORKSPACE_ID not set — files regenerated only', steps: [], files: names, startedAt, durationMs: Date.now() - t0 },
    };
  }
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const steps: SyncStep[] = [];
  steps.push(await upsertCollection(f, key, ws, pick(opts.env, 'POSTMAN_COLLECTION_ID_PUBLIC'), files['octopus-b2b-api-v1.postman_collection.json'], 'collection: Octopus B2B API v1'));
  steps.push(await upsertCollection(f, key, ws, pick(opts.env, 'POSTMAN_COLLECTION_ID_SUPPLIER'), files['octopus-b2b-supplier-api-v1.postman_collection.json'], 'collection: Octopus B2B Supplier API v1'));
  steps.push(await upsertEnvironment(f, key, ws, pick(opts.env, 'POSTMAN_ENVIRONMENT_ID_SANDBOX'), files['sandbox.postman_environment.json'], 'environment: Sandbox'));
  steps.push(await upsertEnvironment(f, key, ws, pick(opts.env, 'POSTMAN_ENVIRONMENT_ID_LIVE'), files['live.postman_environment.json'], 'environment: Live'));
  const apiId = pick(opts.env, 'POSTMAN_API_ID');
  if (apiId) steps.push(await updateApiDefinition(f, key, apiId, pick(opts.env, 'POSTMAN_API_SCHEMA_ID'), files['openapi.json']));
  else steps.push({ target: 'api definition', action: 'skipped', error: 'POSTMAN_API_ID not set' });
  const ok = !steps.some((s) => s.action === 'failed');
  return { files, result: { ok, pushed: true, steps, files: names, startedAt, durationMs: Date.now() - t0 } };
}

/** One-line summary for integration_logs.summary (max 500 chars). */
export function syncSummary(r: SyncResult) {
  const head = r.pushed ? (r.ok ? 'Postman sync OK' : 'Postman sync FAILED') : 'Postman files regenerated (push not configured)';
  const steps = r.steps.map((s) => `${s.target}: ${s.action}${s.id ? ` (${s.id})` : ''}${s.error && s.action === 'failed' ? ` — ${s.error}` : ''}`).join('; ');
  return `${head}${steps ? ` · ${steps}` : ''}`.slice(0, 500);
}

/** Row for integration_logs (integration_code 'postman'). */
export function syncLogRow(r: SyncResult, direction: 'sync' | 'ci' = 'sync') {
  return { integration_code: 'postman', direction, status: !r.pushed ? 204 : r.ok ? 200 : 502, summary: syncSummary(r) };
}
