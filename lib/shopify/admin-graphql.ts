import 'server-only';

/**
 * Octopus Dropship · Step 6 — Shopify Admin GraphQL client (skeleton for the push executor).
 *
 * Not called anywhere yet: the store connection (Step 5: OAuth / token exchange, encrypted tokens) is waiting on the owner's
 * Shopify setup, so there is no shop or token to call on staging. The client is unit-tested with a mocked fetch
 * (tests/unit/shopify-admin-graphql.test.ts).
 *
 *  · POST https://{shop}.myshopify.com/admin/api/{version}/graphql.json with X-Shopify-Access-Token (the token is never
 *    logged or put in an error message).
 *  · Cost-based rate limit: every response's extensions.cost.throttleStatus is remembered; before the next call the
 *    client waits until enough points are restored for the estimated cost. A THROTTLED error waits
 *    ceil((requested − available) / restoreRate) seconds and retries.
 *  · HTTP 429 → waits Retry-After; 5xx / network → exponential backoff with jitter; at most `maxRetries` retries.
 *  · 401 / 403 → ShopifyAuthError (no retry: the merchant must reconnect).
 */

export const SHOPIFY_API_VERSION = '2026-10';
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export type ThrottleStatus = { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
export type GraphQLCost = { requestedQueryCost?: number; actualQueryCost?: number; throttleStatus?: ThrottleStatus };
export type UserError = { field?: string[] | null; message: string; code?: string | null };

export class ShopifyAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 ? 'Store access expired or was revoked.' : 'The app is missing a permission in this store.');
    this.name = 'ShopifyAuthError';
    this.status = status;
  }
}

export class ShopifyHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ShopifyHttpError';
    this.status = status;
  }
}

export class ShopifyThrottledError extends Error {
  readonly retryAfterS: number;
  constructor(retryAfterS: number) {
    super('Shopify is busy (rate limit).');
    this.name = 'ShopifyThrottledError';
    this.retryAfterS = retryAfterS;
  }
}

export class ShopifyGraphQLError extends Error {
  readonly errors: { message: string; extensions?: Record<string, unknown> }[];
  constructor(errors: { message: string; extensions?: Record<string, unknown> }[]) {
    super(errors.map((e) => e.message).join('; ') || 'Shopify returned an error.');
    this.name = 'ShopifyGraphQLError';
    this.errors = errors;
  }
}

export type ShopifyClientOptions = {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1, for backoff jitter (injectable for tests) */
  random?: () => number;
  now?: () => number;
  maxRetries?: number;
};

export type ShopifyAdminClient = {
  request<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>, opts?: { estimatedCost?: number }): Promise<{ data: T; cost?: GraphQLCost }>;
  /** last known bucket (for tests and logging; no secrets) */
  throttle(): ThrottleStatus | null;
};

type GqlResponse<T> = { data?: T; errors?: { message: string; extensions?: Record<string, unknown> }[]; extensions?: { cost?: GraphQLCost } };

export function createShopifyAdminClient(opts: ShopifyClientOptions): ShopifyAdminClient {
  const shop = (opts.shopDomain ?? '').trim().toLowerCase();
  if (!SHOP_RE.test(shop)) throw new Error('Invalid shop domain (expected name.myshopify.com).');
  if (!opts.accessToken) throw new Error('Missing access token.');
  const url = `https://${shop}/admin/api/${opts.apiVersion ?? SHOPIFY_API_VERSION}/graphql.json`;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const maxRetries = opts.maxRetries ?? 5;
  let bucket: (ThrottleStatus & { at: number }) | null = null;

  /** points available now, counting what was restored since the last response */
  const availableNow = () => (bucket ? Math.min(bucket.maximumAvailable, bucket.currentlyAvailable + ((now() - bucket.at) / 1000) * bucket.restoreRate) : Infinity);

  async function waitForPoints(cost: number) {
    if (!bucket || !(cost > 0)) return;
    const missing = Math.min(cost, bucket.maximumAvailable) - availableNow();
    if (missing > 0 && bucket.restoreRate > 0) await sleep(Math.ceil(missing / bucket.restoreRate) * 1000);
  }

  async function request<T>(query: string, variables?: Record<string, unknown>, ro?: { estimatedCost?: number }) {
    let attempt = 0;
    for (;;) {
      await waitForPoints(ro?.estimatedCost ?? 0);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Shopify-Access-Token': opts.accessToken },
          body: JSON.stringify({ query, variables: variables ?? {} }),
        });
      } catch {
        if (attempt >= maxRetries) throw new ShopifyHttpError(0, 'Could not reach Shopify.');
        await sleep(backoffMs(attempt++));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ShopifyAuthError(res.status);
      if (res.status === 429) {
        const ra = Number(res.headers.get('Retry-After'));
        const waitS = Number.isFinite(ra) && ra > 0 ? ra : 2;
        if (attempt >= maxRetries) throw new ShopifyThrottledError(waitS);
        attempt++;
        await sleep(waitS * 1000);
        continue;
      }
      if (res.status >= 500) {
        if (attempt >= maxRetries) throw new ShopifyHttpError(res.status, `Shopify had a problem (${res.status}).`);
        await sleep(backoffMs(attempt++));
        continue;
      }
      if (!res.ok) throw new ShopifyHttpError(res.status, `Shopify refused the request (${res.status}).`);
      const body = (await res.json()) as GqlResponse<T>;
      const cost = body.extensions?.cost;
      if (cost?.throttleStatus) bucket = { ...cost.throttleStatus, at: now() };
      const throttled = body.errors?.find((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        const requested = cost?.requestedQueryCost ?? ro?.estimatedCost ?? 0;
        const ts = cost?.throttleStatus;
        const waitS = ts && ts.restoreRate > 0 ? Math.max(1, Math.ceil((requested - ts.currentlyAvailable) / ts.restoreRate)) : 2;
        if (attempt >= maxRetries) throw new ShopifyThrottledError(waitS);
        attempt++;
        await sleep(waitS * 1000);
        continue;
      }
      if (body.errors?.length) throw new ShopifyGraphQLError(body.errors);
      return { data: body.data as T, cost };
    }
  }

  function backoffMs(attempt: number) {
    const base = Math.min(30_000, 500 * 2 ** attempt);
    return Math.round(base / 2 + random() * (base / 2));
  }

  return { request, throttle: () => (bucket ? { maximumAvailable: bucket.maximumAvailable, currentlyAvailable: bucket.currentlyAvailable, restoreRate: bucket.restoreRate } : null) };
}
