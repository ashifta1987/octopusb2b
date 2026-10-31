import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deref, validate } from '@/lib/api/json-schema';
import { findBareAmounts } from '@/lib/api/money';
import { buildOpenApi, OPERATIONS, operationId, SUPPLIER_OPERATIONS } from '@/lib/api/openapi';
import { buildEnvironment, buildPostmanFiles, buildPublicCollection, buildSupplierCollection, POSTMAN_SCHEMA, VERIFY_FOLDER, type Examples } from '@/lib/api/postman';
import { runPostmanSync, syncLogRow } from '@/lib/api/postman-sync';
import { runInPostmanUrl } from '@/lib/api/postman-links';
import { signPayload } from '@/lib/adapters';

/* eslint-disable @typescript-eslint/no-explicit-any */
const root = path.resolve(__dirname, '../..');
const examples = JSON.parse(fs.readFileSync(path.join(root, 'postman/examples.json'), 'utf8')) as Examples;
const pub = buildPublicCollection({ examples });
const sup = buildSupplierCollection({ examples });
const publicSpec = buildOpenApi('https://octopusb2b.com');
const components = publicSpec.components.schemas as Record<string, unknown>;

type Item = { id?: string; name: string; request: any; event?: { listen: string; script: { exec: string[] } }[]; response?: any[]; item?: Item[] };
const flat = (items: Item[]): Item[] => items.flatMap((i) => (i.item ? flat(i.item) : [i]));
const script = (i: { event?: Item['event'] }, listen: string) => (i.event ?? []).find((e) => e.listen === listen)?.script.exec.join('\n') ?? '';

/** Minimal Postman sandbox: enough of `pm` to run the generated scripts against a saved example. */
function runScript(src: string, opts: { code?: number; body?: string; request?: any; vars?: Record<string, string>; env?: Record<string, string> } = {}) {
  const results: { name: string; ok: boolean; error?: string }[] = [];
  const colVars: Record<string, string> = { ...(opts.vars ?? {}) };
  const envVars: Record<string, string> = { ...(opts.env ?? {}) };
  const headers: { key: string; value: string }[] = [...(opts.request?.header ?? [])];
  const sent: any[] = [];
  let skipped = false;
  const expect = (actual: unknown, msg?: string) => ({
    to: {
      include: (x: unknown) => {
        if (!(actual as unknown[]).includes(x)) throw new Error(msg ?? `${JSON.stringify(actual)} does not include ${JSON.stringify(x)}`);
      },
      eql: (x: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(x)) throw new Error(msg ?? `${JSON.stringify(actual)} != ${JSON.stringify(x)}`);
      },
    },
  });
  const pm = {
    test: (name: string, fn: () => void) => {
      try {
        fn();
        results.push({ name, ok: true });
      } catch (e) {
        results.push({ name, ok: false, error: (e as Error).message });
      }
    },
    expect,
    variables: {
      get: (k: string) => envVars[k] ?? colVars[k] ?? '',
      replaceIn: (s: string) => s.replace('{{$guid}}', crypto.randomUUID()),
      set: (k: string, v: string) => (envVars[k] = v),
    },
    collectionVariables: { get: (k: string) => colVars[k] ?? '', set: (k: string, v: string) => (colVars[k] = v) },
    environment: { has: (k: string) => k in envVars, set: (k: string, v: string) => (envVars[k] = v) },
    execution: { skipRequest: () => (skipped = true) },
    sendRequest: (req: any, cb: (err: unknown, res: unknown) => void) => {
      sent.push(req);
      cb(null, { code: 200, json: () => ({ access_token: 'tok_123', expires_in: 3600 }), text: () => '' });
    },
    request: {
      method: opts.request?.method ?? 'GET',
      auth: opts.request?.auth,
      body: { raw: opts.request?.body?.raw ?? '' },
      url: { getPath: () => opts.request?.url?.raw ?? '' },
      headers: {
        has: (k: string) => headers.some((h) => h.key.toLowerCase() === k.toLowerCase()),
        get: (k: string) => headers.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value,
        upsert: (h: { key: string; value: string }) => {
          const i = headers.findIndex((x) => x.key.toLowerCase() === h.key.toLowerCase());
          if (i >= 0) headers[i] = h;
          else headers.push(h);
        },
      },
    },
    response: {
      code: opts.code ?? 200,
      text: () => opts.body ?? '',
      json: () => JSON.parse(opts.body ?? 'null'),
      headers: { get: () => 'application/json' },
      to: {
        have: {
          jsonSchema: (schema: unknown) => {
            const errs = validate(schema, JSON.parse(opts.body ?? 'null'));
            if (errs.length) throw new Error(errs.slice(0, 5).join('; '));
          },
        },
      },
    },
  };
  const cryptoJs = {
    HmacSHA256: (msg: string, key: string) => ({ toString: () => crypto.createHmac('sha256', key).update(msg).digest('hex') }),
    enc: { Hex: 'hex' },
  };
  const requireFn = (m: string) => {
    if (m === 'crypto-js') return cryptoJs;
    throw new Error(`unexpected require ${m}`);
  };
  new Function('pm', 'require', 'console', src)(pm, requireFn, { log: () => {}, warn: () => {}, error: () => {} });
  return { results, colVars, envVars, headers, sent, skipped };
}

describe('Postman collections (SPEC §15.2)', () => {
  it('are Postman v2.1 with the required folders', () => {
    expect(pub.info.schema).toBe(POSTMAN_SCHEMA);
    expect(pub.info.name).toBe('Octopus B2B API v1');
    expect(pub.item.map((f) => f.name)).toEqual(['Auth', 'Settings', 'Catalog', 'RFQs & quotes', 'Orders', 'Shipments', 'Wallet & ledger', 'Service requests', 'Webhooks', VERIFY_FOLDER]);
    expect(sup.info.name).toBe('Octopus B2B Supplier API v1');
    expect(sup.item.map((f) => f.name)).toEqual(['Auth', 'Products', 'Inventory', 'RFQs & quotes', 'Orders']);
    for (const c of [pub, sup]) {
      expect(c.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{access_token}}', type: 'string' }] });
      const ids = flat(c.item as unknown as Item[]).map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('contain every OpenAPI operation exactly once, with a saved example', () => {
    const items = flat(pub.item as unknown as Item[]);
    for (const op of OPERATIONS) {
      const it = items.find((i) => i.id === `public-${operationId(op)}`);
      expect(it, operationId(op)).toBeDefined();
      expect(it!.request.method).toBe(op.method.toUpperCase());
      expect(it!.request.url.raw.startsWith('{{base_url}}/')).toBe(true);
      expect(it!.response!.length).toBeGreaterThan(0);
      expect(it!.response![0].code).toBe(op.status ?? 200);
    }
    // every public endpoint has a saved example from seed data
    for (const op of OPERATIONS) expect(examples, operationId(op)).toHaveProperty(operationId(op));
    const supItems = flat(sup.item as unknown as Item[]);
    expect(supItems.filter((i) => i.id?.startsWith('supplier-')).length).toBe(SUPPLIER_OPERATIONS.length);
  });

  it('collection pre-request fetches + caches the OAuth token and adds Idempotency-Key to POST', () => {
    const src = pub.event[0].script.exec.join('\n');
    expect(pub.event[0].listen).toBe('prerequest');
    const post = { method: 'POST', header: [], url: { raw: '{{base_url}}/rfqs' } };
    const first = runScript(src, { request: post, env: { base_url: 'https://x.test/api/v1', client_id: 'cli_1', client_secret: 'oct_test_x', access_token: '' } });
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0].url).toBe('https://x.test/api/v1/oauth/token');
    expect(first.colVars.access_token).toBe('tok_123');
    expect(Number(first.colVars.access_token_expires_at)).toBeGreaterThan(Date.now());
    expect(first.envVars.access_token).toBe('tok_123'); // environment value is kept in sync (it would shadow the collection var)
    expect(first.headers.find((h) => h.key === 'Idempotency-Key')?.value).toMatch(/^[0-9a-f-]{36}$/);
    // cached: no second token request
    const again = runScript(src, { request: { method: 'GET', header: [] }, vars: first.colVars, env: { base_url: 'https://x.test/api/v1', client_id: 'cli_1', client_secret: 'oct_test_x' } });
    expect(again.sent).toHaveLength(0);
    expect(again.headers.some((h) => h.key === 'Idempotency-Key')).toBe(false);
    // different client → refetch
    expect(runScript(src, { request: { method: 'GET', header: [] }, vars: first.colVars, env: { base_url: 'https://x.test/api/v1', client_id: 'cli_2', client_secret: 's' } }).sent).toHaveLength(1);
    // the token request itself is not authenticated
    expect(runScript(src, { request: { method: 'POST', header: [], auth: { type: 'noauth' } }, env: { base_url: 'b', client_id: 'c', client_secret: 's' } }).sent).toHaveLength(0);
  });

  it('every request runs its tests (status, OpenAPI schema, amounts carry a currency) green against its saved example', () => {
    for (const it of flat(pub.item as unknown as Item[]).filter((i) => i.id?.startsWith('public-'))) {
      const src = script(it, 'test');
      expect(src).toContain("pm.test('status is");
      expect(src).toContain('every amount carries a currency');
      if (it.response![0].code !== 204) expect(src).toContain('pm.response.to.have.jsonSchema(schema)');
      const ex = it.response![0];
      const r = runScript(src, { code: ex.code, body: ex.body });
      const failed = r.results.filter((x) => !x.ok);
      expect(failed, `${it.id}: ${JSON.stringify(failed)}`).toEqual([]);
      expect(r.results.length).toBeGreaterThanOrEqual(ex.code === 204 ? 1 : 3);
    }
  });

  it('tests fail on a wrong status, a schema break and a bare amount', () => {
    const products = flat(pub.item as unknown as Item[]).find((i) => i.id === 'public-getProducts')!;
    const src = script(products, 'test');
    const ex = JSON.parse(products.response![0].body);
    expect(runScript(src, { code: 500, body: '{}' }).results.find((r) => r.name.startsWith('status'))!.ok).toBe(false);
    const broken = { ...ex, data: [{ ...ex.data[0], from_price: 1999 }] };
    const r1 = runScript(src, { code: 200, body: JSON.stringify(broken) });
    expect(r1.results.find((r) => r.name.startsWith('response matches'))!.ok).toBe(false);
    const bare = { ...ex, data: [{ ...ex.data[0], from_price: { amount_minor: 1999 }, legacy_cents: 5 }] };
    const r2 = runScript(src, { code: 200, body: JSON.stringify(bare) });
    const cur = r2.results.find((r) => r.name === 'every amount carries a currency')!;
    expect(cur.ok).toBe(false);
    expect(cur.error).toContain('$.data[0].from_price');
    expect(cur.error).toContain('legacy_cents');
  });

  it('chains ids between requests and skips requests whose ids are missing', () => {
    const items = flat(pub.item as unknown as Item[]);
    const list = items.find((i) => i.id === 'public-getProducts')!;
    const r = runScript(script(list, 'test'), { code: 200, body: list.response![0].body });
    expect(r.colVars.product_id).toBe(JSON.parse(list.response![0].body).data[0].id);
    const detail = items.find((i) => i.id === 'public-getProductsById')!;
    expect(detail.request.url.raw).toBe('{{base_url}}/products/{{product_id}}');
    expect(runScript(script(detail, 'prerequest')).skipped).toBe(true);
    expect(runScript(script(detail, 'prerequest'), { vars: { product_id: 'p1' } }).skipped).toBe(false);
    const settings = items.find((i) => i.id === 'public-getSettingsCurrency')!;
    const s = runScript(script(settings, 'test'), { code: 200, body: settings.response![0].body, env: { currency: '' } });
    expect(s.envVars.currency).toMatch(/^(USD|CNY)$/);
  });

  it('webhook verification example signs like the platform and verifies like a receiver', () => {
    const folder = pub.item.find((f) => f.name === VERIFY_FOLDER) as unknown as { description: string; item: Item[] };
    expect(folder.description).toContain('Octopus-Signature');
    expect(folder.description).toContain('mock server');
    const req = folder.item[0];
    expect(req.request.url.raw).toBe('{{mock_url}}/octopus/webhooks');
    expect(req.response![0]).toMatchObject({ code: 200, body: JSON.stringify({ received: true }, null, 2) });
    // no mock_url → skipped (keeps CI runs green)
    expect(runScript(script(req, 'prerequest'), { request: req.request }).skipped).toBe(true);
    const pre = runScript(script(req, 'prerequest'), { request: req.request, vars: { mock_url: 'https://mock.pstmn.io', webhook_secret: 'sek' } });
    const header = pre.headers.find((h) => h.key === 'Octopus-Signature')!.value;
    const t = Number(/t=(\d+)/.exec(header)![1]);
    expect(header).toBe(signPayload(req.request.body.raw, 'sek', t)); // identical to lib/adapters signPayload
    const post = runScript(script(req, 'test'), { code: 200, body: '{"received":true}', request: { ...req.request, header: pre.headers }, vars: { webhook_secret: 'sek' } });
    expect(post.results.every((x) => x.ok), JSON.stringify(post.results)).toBe(true);
    const tampered = runScript(script(req, 'test'), { code: 200, body: '{}', request: { ...req.request, header: pre.headers, body: { raw: req.request.body.raw + ' ' } }, vars: { webhook_secret: 'sek' } });
    expect(tampered.results.find((x) => x.name.startsWith('Octopus-Signature'))!.ok).toBe(false);
  });

  it('supplier collection documents 403/501 while the portal is closed', () => {
    for (const it of flat(sup.item as unknown as Item[]).filter((i) => i.id?.startsWith('supplier-'))) {
      const src = script(it, 'test');
      expect(src).toMatch(/var expected = \[\d+,403,501\]/);
      const r = runScript(src, { code: 403, body: JSON.stringify({ type: 'x', title: 'Forbidden', status: 403, code: 'SUPPLIER_PORTAL_DISABLED', detail: 'closed' }) });
      expect(r.results.filter((x) => !x.ok), it.id).toEqual([]);
      expect(runScript(src, { code: it.response![0].code, body: it.response![0].body }).results.filter((x) => !x.ok), it.id).toEqual([]);
    }
  });

  it('environments ship with empty secrets', () => {
    for (const kind of ['sandbox', 'live'] as const) {
      const env = buildEnvironment(kind);
      const vals = Object.fromEntries(env.values.map((v) => [v.key, v]));
      for (const k of ['base_url', 'client_id', 'client_secret', 'access_token', 'currency']) expect(vals).toHaveProperty(k);
      for (const k of ['client_id', 'client_secret', 'access_token', 'webhook_secret']) expect(vals[k].value).toBe('');
      expect(vals.client_secret.type).toBe('secret');
      expect(env._postman_variable_scope).toBe('environment');
    }
    const secrets = JSON.stringify([pub.variable, sup.variable]);
    expect(secrets).not.toMatch(/oct_(test|live)_[a-z0-9]/i);
    expect(JSON.stringify(examples)).not.toMatch(/oct_(test|live)_[a-z0-9]|"secret":\s*"[0-9a-f]{48}"/);
  });

  it('committed postman/*.json files are up to date (run: node scripts/postman-sync.mjs --no-push)', () => {
    for (const [name, json] of Object.entries(buildPostmanFiles(examples))) {
      const file = path.join(root, 'postman', name);
      expect(fs.existsSync(file), name).toBe(true);
      expect(fs.readFileSync(file, 'utf8') === JSON.stringify(json, null, 2) + '\n', `${name} is stale`).toBe(true);
    }
  });

  it('saved examples validate against the OpenAPI schemas', () => {
    for (const op of OPERATIONS) {
      const ex = examples[operationId(op)];
      if (!op.response || !ex) continue;
      expect(validate(deref({ $ref: `#/components/schemas/${op.response}` }, components), ex.body), operationId(op)).toEqual([]);
      expect(findBareAmounts(ex.body), operationId(op)).toEqual([]);
    }
  });
});

describe('Postman sync', () => {
  it('regenerates only when the Postman API is not configured', async () => {
    const { result } = await runPostmanSync({ env: {} });
    expect(result).toMatchObject({ ok: true, pushed: false });
    expect(syncLogRow(result)).toMatchObject({ integration_code: 'postman', status: 204 });
  });

  it('PUTs collections by id, creates missing ones in the workspace and updates the API definition', async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, ...init });
      const body = url.includes('?include=schemas') ? { schemas: [{ id: 'sch_1' }] } : init.method === 'POST' ? { collection: { uid: '123-new' } } : { ok: true };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const { result } = await runPostmanSync({
      env: { POSTMAN_API_KEY: 'PMAK-x', POSTMAN_WORKSPACE_ID: 'ws1', POSTMAN_COLLECTION_ID_PUBLIC: '123-pub', POSTMAN_API_ID: 'api1' },
      fetch: fetcher,
    });
    expect(result.ok).toBe(true);
    expect(calls.every((c) => c.headers['X-Api-Key'] === 'PMAK-x')).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://api.getpostman.com/collections/123-pub' });
    expect(JSON.parse(calls[0].body!).collection.info.name).toBe('Octopus B2B API v1');
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://api.getpostman.com/collections?workspace=ws1' });
    expect(result.steps.find((s) => s.target.includes('Supplier'))).toMatchObject({ action: 'created', id: '123-new' });
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', url: 'https://api.getpostman.com/apis/api1/schemas/sch_1/files/openapi.json' });
    expect(JSON.parse(JSON.parse(calls.at(-1)!.body!).content).openapi).toBe('3.1.0');
    expect(syncLogRow(result)).toMatchObject({ status: 200, integration_code: 'postman' });
  });

  it('reports failures', async () => {
    const fetcher = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { name: 'AuthenticationError', message: 'Invalid API Key' } }) });
    const { result } = await runPostmanSync({ env: { POSTMAN_API_KEY: 'bad', POSTMAN_WORKSPACE_ID: 'ws', POSTMAN_COLLECTION_ID_PUBLIC: 'c' }, fetch: fetcher });
    expect(result.ok).toBe(false);
    expect(result.steps[0]).toMatchObject({ action: 'failed', status: 401, error: 'Invalid API Key' });
    expect(syncLogRow(result).status).toBe(502);
    expect(syncLogRow(result).summary).toContain('FAILED');
  });

  it('builds the Run in Postman fork link', () => {
    expect(runInPostmanUrl(null)).toBeNull();
    const u = new URL(runInPostmanUrl('123-abc', 'env-1', 'ws-9')!);
    expect(u.origin + u.pathname).toBe('https://god.gw.postman.com/run-collection/123-abc');
    expect(u.searchParams.get('action')).toBe('collection/fork');
    expect(u.searchParams.get('collection-url')).toBe('entityId=123-abc&entityType=collection&workspaceId=ws-9');
    expect(u.searchParams.get('environment-url')).toBe('entityId=env-1&entityType=environment&workspaceId=ws-9');
  });
});
