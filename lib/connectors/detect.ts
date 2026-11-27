import 'server-only';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isBlockedAddress, marketplaceFor, matchSignature, normaliseStoreUrl, type PageSample } from './signatures';
import type { DetectResult } from './types';

/**
 * C0 · Server-side store-link detection (merchant pastes a link → which platform is it?). A link alone gives NO access.
 *
 * SSRF guard: the host name is RESOLVED (all A / AAAA records) and refused when ANY address is private, loopback, link-local,
 * metadata (169.254.169.254, fd00:ec2::254), CGNAT, multicast or reserved. The connection is made to the address that was checked
 * (custom `lookup` on the socket, so DNS rebinding between check and connect can't switch it). Every redirect is parsed and checked
 * the same way (max 3, https or a plain-http → https upgrade only, ports 80 / 443). Short timeouts (4 s per hop, 8 s total), the body
 * is capped at 256 KB, no cookies or credentials are sent, nothing is executed.
 */
const MAX_REDIRECTS = 3;
const HOP_TIMEOUT_MS = 4_000;
const TOTAL_TIMEOUT_MS = 8_000;
const MAX_BODY = 256 * 1024;
const UA = 'OctopusStoreCheck/1.0 (+https://www.hostoctopus.com)';

export class BlockedAddressError extends Error {
  constructor(message: string) { super(message); this.name = 'BlockedAddressError'; }
}

type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Resolves and checks every address; returns the first safe one to connect to. */
export async function resolveSafe(host: string, resolve: Resolver = systemResolver): Promise<{ address: string; family: number }> {
  let addrs: { address: string; family: number }[];
  try { addrs = await resolve(host); } catch { throw new Error('NOT_FOUND'); }
  if (!addrs.length) throw new Error('NOT_FOUND');
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  if (bad) throw new BlockedAddressError('This address points to a private or internal network.');
  return addrs[0];
}

type Hop = { status: number; headers: http.IncomingHttpHeaders; body: string };

function requestOnce(url: URL, pinned: { address: string; family: number }, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_host, opts, cb) => {
      if (typeof opts === 'object' && opts && 'all' in opts && opts.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
      else cb(null, pinned.address, pinned.family);
    };
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET', lookup, signal, timeout: HOP_TIMEOUT_MS, agent: false,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity', 'accept-language': 'en' },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
        else { res.destroy(); }
      });
      const done = () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.on('end', done);
      res.on('close', done);
      res.on('error', () => done());
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

const lowerHeaders = (h: http.IncomingHttpHeaders): Record<string, string> =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v ?? '')]));
const cookieNames = (h: http.IncomingHttpHeaders): string[] => (h['set-cookie'] ?? []).map((c) => c.split('=')[0].trim()).filter(Boolean);

/** Fetches a public page under the SSRF guard. Exported for tests (inject a resolver and a requester). */
export async function guardedFetch(start: string, deps: { resolve?: Resolver; request?: typeof requestOnce } = {}): Promise<{ finalUrl: URL; page: PageSample; status: number }> {
  const resolve = deps.resolve ?? systemResolver;
  const request = deps.request ?? requestOnce;
  const ac = new AbortController();
  const total = setTimeout(() => ac.abort(), TOTAL_TIMEOUT_MS);
  try {
    let url = new URL(start);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.username || url.password) throw new BlockedAddressError('Addresses with a user name are not followed.');
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedAddressError('Only web addresses are followed.');
      const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
      if (![80, 443].includes(port)) throw new BlockedAddressError('Redirect to an unusual port was not followed.');
      const n = normaliseStoreUrl(url.toString());
      if ('error' in n) throw new BlockedAddressError(n.error);
      const pinned = await resolveSafe(url.hostname.toLowerCase(), resolve);
      const res = await request(url, pinned, ac.signal);
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
        const next = new URL(String(res.headers.location), url);
        // never downgrade from https to http
        if (url.protocol === 'https:' && next.protocol === 'http:') throw new BlockedAddressError('The store redirected to an unencrypted address.');
        url = next;
        continue;
      }
      return { finalUrl: url, status: res.status, page: { host: url.hostname.toLowerCase(), headers: lowerHeaders(res.headers), html: res.body, cookies: cookieNames(res.headers) } };
    }
    throw new BlockedAddressError('The store address redirected too many times.');
  } finally {
    clearTimeout(total);
  }
}

/** Paste a link → found / marketplace / unknown / unreachable / blocked. Never throws; messages are for the merchant. */
export async function detectPlatform(input: string, deps: Parameters<typeof guardedFetch>[1] = {}): Promise<DetectResult> {
  const n = normaliseStoreUrl(input);
  if ('error' in n) return { outcome: 'blocked', host: null, url: null, reason: n.error };
  const market = marketplaceFor(n.host);
  if (market) return { outcome: 'marketplace', platform: market, host: n.host, url: n.url, evidence: ['marketplace address'] };
  try {
    const { finalUrl, page, status } = await guardedFetch(n.url, deps);
    const sig = matchSignature(page);
    const host = finalUrl.hostname.toLowerCase();
    if (sig) return { outcome: 'found', platform: sig.platform, host, url: `https://${host}/`, evidence: sig.evidence };
    if (status >= 500 || status === 0) return { outcome: 'unreachable', host, url: `https://${host}/`, reason: 'The store did not answer properly. Check the address or try again later.' };
    return { outcome: 'unknown', host, url: `https://${host}/`, evidence: [] };
  } catch (e) {
    if (e instanceof BlockedAddressError) return { outcome: 'blocked', host: n.host, url: n.url, reason: e.message };
    const msg = e instanceof Error ? e.message : '';
    return {
      outcome: 'unreachable', host: n.host, url: n.url,
      reason: msg === 'NOT_FOUND' ? 'This address does not exist. Check the spelling.' : /TIMEOUT|abort/i.test(msg) ? 'The store took too long to answer. Try again.' : 'We could not reach this store. Check the address and try again.',
    };
  }
}
