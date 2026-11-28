import 'server-only';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { BlockedAddressError, resolveSafe } from './detect';
import { normaliseStoreUrl } from './signatures';

/**
 * CONN S2 · API calls to a MERCHANT's store (a host the merchant typed): the same SSRF guard as the store-link check
 * (lib/connectors/detect.ts) — every address of the host resolved and checked, the socket pinned to the checked address (no DNS
 * rebinding), https on port 443 only, NO redirects followed (an API that redirects is refused, so keys are never sent elsewhere),
 * 15 s timeout, body capped at 2 MB. Credentials go in the request only; errors never contain them.
 */
const TIMEOUT_MS = 15_000;
const MAX_BODY = 2 * 1024 * 1024;
const UA = 'OctopusConnector/1.0';

export type StoreResponse = { status: number; headers: Record<string, string>; body: string };
export type StoreRequest = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; headers?: Record<string, string>; body?: string };
type Pinned = { address: string; family: number };
export type Requester = (url: URL, init: StoreRequest, pinned: Pinned) => Promise<StoreResponse>;
type Resolver = Parameters<typeof resolveSafe>[1];

export class StoreUnreachableError extends Error {
  constructor(message: string) { super(message); this.name = 'StoreUnreachableError'; }
}

const requestOnce: Requester = (url, init, pinned) => new Promise((resolve, reject) => {
  const lookup: LookupFunction = (_host, opts, cb) => {
    if (typeof opts === 'object' && opts && 'all' in opts && opts.all) (cb as unknown as (e: null, a: Pinned[]) => void)(null, [pinned]);
    else cb(null, pinned.address, pinned.family);
  };
  const req = https.request(url, {
    method: init.method, lookup, timeout: TIMEOUT_MS, agent: false,
    headers: { 'user-agent': UA, accept: 'application/json', 'accept-encoding': 'identity', ...(init.body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(init.body)) } : {}), ...(init.headers ?? {}) },
  }, (res: http.IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    res.on('data', (c: Buffer) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); else { over = true; res.destroy(); } });
    const done = () => {
      if (over) { reject(new StoreUnreachableError('The store answered with too much data.')); return; }
      const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v ?? '')]));
      resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') });
    };
    res.on('end', done);
    res.on('error', () => reject(new StoreUnreachableError('The store connection broke off.')));
  });
  req.on('timeout', () => req.destroy(new StoreUnreachableError('The store did not answer in time.')));
  req.on('error', (e) => reject(e instanceof StoreUnreachableError ? e : new StoreUnreachableError('The store could not be reached.')));
  if (init.body) req.write(init.body);
  req.end();
});

export async function storeRequest(init: StoreRequest, deps: { resolve?: Resolver; request?: Requester } = {}): Promise<StoreResponse> {
  const url = new URL(init.url);
  if (url.protocol !== 'https:') throw new BlockedAddressError('Store API calls use https only.');
  if (url.username || url.password) throw new BlockedAddressError('Addresses with a user name are not used.');
  if (url.port && url.port !== '443') throw new BlockedAddressError('Store API calls use the normal https port only.');
  const n = normaliseStoreUrl(`https://${url.hostname}/`);
  if ('error' in n) throw new BlockedAddressError(n.error);
  let pinned: Pinned;
  try { pinned = await resolveSafe(url.hostname.toLowerCase(), deps.resolve); }
  catch (e) { if (e instanceof BlockedAddressError) throw e; throw new StoreUnreachableError('The store address could not be found.'); }
  const res = await (deps.request ?? requestOnce)(url, init, pinned);
  if ([301, 302, 303, 307, 308].includes(res.status)) throw new StoreUnreachableError('The store API redirected to another address. Check the store address (https and www).');
  return res;
}
