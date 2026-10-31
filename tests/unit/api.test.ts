import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '@/lib/api/openapi';
import { buildPostman } from '@/lib/api/postman';
import { notificationFor, retryPlan, wantsEmail, BACKOFF_SECONDS } from '@/lib/api/outbox-rules';
import { problem, problemFromDb } from '@/lib/api/problem';
import { _resetRateLimits, rateLimit } from '@/lib/api/rate-limit';
import { isBroadcastEvent, publicEventFor } from '@/lib/api/webhooks';

describe('rate limit (60/min per key)', () => {
  it('allows 60 then 429 with Retry-After, resets after the window', () => {
    _resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 60; i++) expect(rateLimit('k', 60, 60_000, t).ok).toBe(true);
    const blocked = rateLimit('k', 60, 60_000, t + 30_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(30);
    expect(rateLimit('other', 60, 60_000, t).ok).toBe(true);
    expect(rateLimit('k', 60, 60_000, t + 60_000).ok).toBe(true);
  });
});

describe('outbox rules', () => {
  it('backs off 1m, 5m, 30m, 2h, 6h then dead-letters', () => {
    const now = 0;
    const delays = [0, 1, 2, 3, 4].map((n) => (new Date(retryPlan(n, now).availableAt).getTime() - now) / 1000);
    expect(delays).toEqual([...BACKOFF_SECONDS]);
    expect(retryPlan(4, now)).toMatchObject({ status: 'pending', attempts: 5 });
    expect(retryPlan(5, now)).toMatchObject({ status: 'dead', attempts: 6 });
  });
  it('maps internal events to public webhook events', () => {
    expect(publicEventFor('order.shipped')).toBe('order.updated');
    expect(publicEventFor('quote.approved')).toBe('order.updated');
    expect(publicEventFor('quote.sent')).toBe('quote.created');
    expect(publicEventFor('shipment.tracking')).toBe('shipment.tracking');
    expect(publicEventFor('service_request.paid')).toBe('service_request.updated');
    expect(publicEventFor('wallet.updated')).toBe('wallet.updated');
    expect(publicEventFor('settings.currency_changed')).toBe('settings.currency_changed');
    expect(isBroadcastEvent('settings.currency_changed')).toBe(true);
    expect(isBroadcastEvent('order.updated')).toBe(false);
    expect(publicEventFor('product.published')).toBeNull();
  });
  it('emails only for the documented events', () => {
    expect(wantsEmail({ event_type: 'quote.sent', payload: {} })).toBe(true);
    expect(wantsEmail({ event_type: 'order.confirmed', payload: {} })).toBe(true);
    expect(wantsEmail({ event_type: 'ticket.replied', payload: { staff: true } })).toBe(true);
    expect(wantsEmail({ event_type: 'ticket.replied', payload: { staff: false } })).toBe(false);
    expect(wantsEmail({ event_type: 'rfq.submitted', payload: {} })).toBe(false);
  });
  it('builds notification copy with links', () => {
    expect(notificationFor({ event_type: 'order.shipped', aggregate_id: 'o1', payload: {} })).toMatchObject({ title: 'Order shipped', link: '/account/orders/o1' });
    expect(notificationFor({ event_type: 'product.published', aggregate_id: 'p', payload: {} })).toBeNull();
  });
});

describe('problem+json', () => {
  it('is RFC 7807 shaped', async () => {
    const r = problem(404, 'NOT_FOUND', 'Nope');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toBe('application/problem+json');
    expect(await r.json()).toMatchObject({ status: 404, title: 'Not Found', code: 'NOT_FOUND', detail: 'Nope', type: expect.stringContaining('not-found') });
  });
  it('maps DB error codes to HTTP status', () => {
    expect(problemFromDb({ message: 'WALLET_INSUFFICIENT: balance 1 needed 2' }).status).toBe(409);
    expect(problemFromDb({ message: 'NOT_FOUND' }).status).toBe(404);
  });
});

describe('API docs', () => {
  it('OpenAPI 3.1 document has all endpoints with Zod-generated bodies', () => {
    const doc = buildOpenApi('https://example.test');
    expect(doc.openapi).toBe('3.1.0');
    for (const p of ['/oauth/token', '/settings/currency', '/products', '/products/{id}', '/categories', '/rfqs', '/quotes', '/orders', '/orders/{id}', '/shipments/{id}/tracking', '/wallet', '/service-requests', '/webhooks'])
      expect(doc.paths).toHaveProperty([p]);
    const rfqBody = (doc.paths['/rfqs'].post as { requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } } }).requestBody.content['application/json'].schema;
    expect(rfqBody.properties).toHaveProperty('quantity');
    // every $ref resolves
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/(\w+)/g) ?? [];
    for (const r of refs) expect(doc.components.schemas).toHaveProperty(r.split('/').pop()!);
  });
  it('Postman collection is v2.1 with the required variables', () => {
    const c = buildPostman('https://example.test');
    expect(c.info.schema).toContain('v2.1.0');
    const vars = c.variable.map((v) => v.key);
    for (const k of ['base_url', 'client_id', 'client_secret', 'access_token', 'currency']) expect(vars).toContain(k);
    expect(c.variable.find((v) => v.key === 'base_url')!.value).toBe('https://example.test/api/v1');
    expect(c.event[0].listen).toBe('prerequest');
  });
});
