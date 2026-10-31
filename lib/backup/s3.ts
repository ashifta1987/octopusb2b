import crypto from 'node:crypto';

/**
 * Minimal AWS Signature Version 4 for S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO…),
 * built on node:crypto only (SPEC §16.2 — no SDK dependency). Used for presigned downloads (10 min), the off-site
 * connection test, and small PUT/HEAD/DELETE calls. Pure functions are unit-tested against AWS's published vectors.
 */
export type SigV4Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
export type S3Config = SigV4Credentials & { endpoint: string | null; bucket: string; region: string };

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export const sha256Hex = (data: string | Buffer | Uint8Array) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding as SigV4 requires (unreserved: A-Z a-z 0-9 - _ . ~). */
export function uriEncode(s: string, encodeSlash = true) {
  let out = '';
  for (const ch of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-_.~]/.test(c)) out += c;
    else if (c === '/' && !encodeSlash) out += c;
    else out += '%' + ch.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** "20150830T123600Z" and "20150830" from a Date. */
export function amzDates(now: Date) {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: amz, dateStamp: amz.slice(0, 8) };
}

export function signingKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = hmac('AWS4' + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/** S3 style canonical URI: each path segment URI-encoded once, slashes kept, no normalisation. */
export function canonicalUri(pathname: string) {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        /* keep raw */
      }
      return uriEncode(decoded);
    })
    .join('/');
}

export function canonicalQuery(params: [string, string][]) {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

const normValue = (v: string) => v.trim().replace(/\s+/g, ' ');

type CanonicalInput = { method: string; url: URL; headers: Record<string, string>; payloadHash: string; query?: [string, string][] };

export function canonicalRequest({ method, url, headers, payloadHash, query }: CanonicalInput) {
  const lower = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), normValue(v)] as const);
  lower.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(';');
  const canonicalHeaders = lower.map(([k, v]) => `${k}:${v}\n`).join('');
  const q = query ?? [...url.searchParams.entries()];
  const text = [method.toUpperCase(), canonicalUri(url.pathname), canonicalQuery(q), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  return { text, signedHeaders };
}

export function stringToSign(amzDate: string, scope: string, canonical: string) {
  return ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
}

export type SignInput = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** hex sha256 of the body, or UNSIGNED-PAYLOAD. Defaults to sha256(body ?? ''). */
  payloadHash?: string;
  body?: string | Buffer | Uint8Array;
  credentials: SigV4Credentials;
  region: string;
  service?: string;
  now?: Date;
};

/** Signs a request with an Authorization header. Returns the headers to send (host is implied by fetch). */
export function signRequest(i: SignInput) {
  const url = new URL(i.url);
  const service = i.service ?? 's3';
  const { amzDate, dateStamp } = amzDates(i.now ?? new Date());
  const payloadHash = i.payloadHash ?? (i.body !== undefined ? sha256Hex(i.body) : EMPTY_SHA256);
  const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate, ...(i.headers ?? {}) };
  if (i.credentials.sessionToken) headers['x-amz-security-token'] = i.credentials.sessionToken;
  const { text, signedHeaders } = canonicalRequest({ method: i.method, url, headers, payloadHash });
  const scope = `${dateStamp}/${i.region}/${service}/aws4_request`;
  const signature = crypto
    .createHmac('sha256', signingKey(i.credentials.secretAccessKey, dateStamp, i.region, service))
    .update(stringToSign(amzDate, scope, text))
    .digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${i.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export type PresignInput = { method?: string; url: string; credentials: SigV4Credentials; region: string; expiresIn?: number; service?: string; now?: Date };

/** Query-string presigned URL (host-only signed header, UNSIGNED-PAYLOAD) — e.g. a 10-minute download link. */
export function presignUrl(i: PresignInput) {
  const url = new URL(i.url);
  const service = i.service ?? 's3';
  const { amzDate, dateStamp } = amzDates(i.now ?? new Date());
  const scope = `${dateStamp}/${i.region}/${service}/aws4_request`;
  const query: [string, string][] = [...url.searchParams.entries()];
  query.push(
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${i.credentials.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(i.expiresIn ?? 600)],
    ['X-Amz-SignedHeaders', 'host'],
  );
  if (i.credentials.sessionToken) query.push(['X-Amz-Security-Token', i.credentials.sessionToken]);
  const { text } = canonicalRequest({ method: i.method ?? 'GET', url, headers: { host: url.host }, payloadHash: UNSIGNED_PAYLOAD, query });
  const signature = crypto
    .createHmac('sha256', signingKey(i.credentials.secretAccessKey, dateStamp, i.region, service))
    .update(stringToSign(amzDate, scope, text))
    .digest('hex');
  const qs = canonicalQuery(query) + `&X-Amz-Signature=${signature}`;
  return `${url.origin}${canonicalUri(url.pathname)}?${qs}`;
}

/* ───────── S3-compatible bucket helpers (env BACKUP_S3_*) ───────── */

export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3Config | null {
  const bucket = env.BACKUP_S3_BUCKET?.trim();
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint = env.BACKUP_S3_ENDPOINT?.trim().replace(/\/+$/, '') || null;
  const region = env.BACKUP_S3_REGION?.trim() || (endpoint ? 'auto' : 'us-east-1');
  return { bucket, accessKeyId, secretAccessKey, region, endpoint };
}

/** Path-style for custom endpoints (R2/B2/MinIO), virtual-hosted style for AWS. */
export function objectUrl(cfg: Pick<S3Config, 'endpoint' | 'bucket' | 'region'>, key: string) {
  const k = key.replace(/^\/+/, '').split('/').map((s) => uriEncode(s)).join('/');
  if (cfg.endpoint) return `${cfg.endpoint}/${uriEncode(cfg.bucket)}/${k}`;
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${k}`;
}

/** `s3://bucket/BK-2026-1101-0200/` → `BK-2026-1101-0200` (object prefix inside the bucket). */
export function prefixFromLocation(location: string | null | undefined, bucket?: string) {
  if (!location) return null;
  let p = location.trim();
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(p);
  if (m) {
    if (bucket && m[1] !== bucket) return null;
    p = m[2];
  }
  return p.replace(/^\/+|\/+$/g, '') || null;
}

export function presignGet(cfg: S3Config, key: string, expiresIn = 600, now?: Date) {
  return presignUrl({ url: objectUrl(cfg, key), credentials: cfg, region: cfg.region, expiresIn, now });
}

export async function s3Request(cfg: S3Config, method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, body?: string | Buffer, extraHeaders: Record<string, string> = {}) {
  const url = objectUrl(cfg, key);
  const payloadHash = body !== undefined ? sha256Hex(body) : EMPTY_SHA256;
  const headers = signRequest({
    method,
    url,
    credentials: cfg,
    region: cfg.region,
    payloadHash,
    headers: { 'x-amz-content-sha256': payloadHash, ...extraHeaders },
  });
  delete (headers as Record<string, string>).host; // fetch sets Host itself
  return fetch(url, { method, headers, body: body as BodyInit | undefined, cache: 'no-store' });
}

/** Off-site connection test: PUT a small object, HEAD it back, then DELETE it. */
export async function testBucket(cfg: S3Config) {
  const key = `_octopus-connection-test/${Date.now()}.txt`;
  const steps: { step: string; status: number; ok: boolean }[] = [];
  const run = async (step: string, method: 'PUT' | 'HEAD' | 'DELETE', body?: string) => {
    const r = await s3Request(cfg, method, key, body, method === 'PUT' ? { 'content-type': 'text/plain' } : {});
    steps.push({ step, status: r.status, ok: r.ok });
    return r.ok;
  };
  try {
    const ok = (await run('put', 'PUT', `octopus backup connection test ${new Date().toISOString()}`)) && (await run('head', 'HEAD'));
    await run('delete', 'DELETE').catch(() => false);
    return { ok, steps };
  } catch (e) {
    return { ok: false, steps, error: e instanceof Error ? e.message : String(e) };
  }
}
