import { describe, expect, it } from 'vitest';
import { YunExpressAdapter, signPayload, verifySignature, type CarrierAdapter } from '@/lib/adapters';

describe('webhook signatures (HMAC-SHA256, t=…,v1=…)', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'order.updated' });

  it('round-trips', () => {
    expect(verifySignature(body, signPayload(body, secret), secret)).toBe(true);
  });
  it('has the documented header format', () => {
    expect(signPayload(body, secret, 1700000000)).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });
  it('rejects a tampered body, wrong secret, missing header', () => {
    const sig = signPayload(body, secret);
    expect(verifySignature(body + ' ', sig, secret)).toBe(false);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, sig, '')).toBe(false);
    expect(verifySignature(body, 'garbage', secret)).toBe(false);
  });
  it('rejects replays outside the 5 minute window', () => {
    const old = signPayload(body, secret, Math.floor(Date.now() / 1000) - 301);
    expect(verifySignature(body, old, secret)).toBe(false);
    const recent = signPayload(body, secret, Math.floor(Date.now() / 1000) - 200);
    expect(verifySignature(body, recent, secret)).toBe(true);
  });
});

describe('YunExpress adapter mapper', () => {
  it('maps webhook payload to internal tracking events', async () => {
    const events = await (new YunExpressAdapter() as CarrierAdapter).parseWebhook(
      { events: [{ id: 'yx_1', tracking_no: 'YT1', status: 'in_transit', description: 'Departed', location: 'Shenzhen, CN', time: '2026-10-01T10:00:00Z' }] },
      new Headers(),
    );
    expect(events).toEqual([
      { providerEventId: 'yx_1', trackingNo: 'YT1', status: 'in_transit', description: 'Departed', location: 'Shenzhen, CN', occurredAt: '2026-10-01T10:00:00Z' },
    ]);
  });
  it('tolerates an empty body', async () => {
    expect(await (new YunExpressAdapter() as CarrierAdapter).parseWebhook({}, new Headers())).toEqual([]);
  });
  it('price trial returns USD cents', async () => {
    const q = await new YunExpressAdapter().priceTrial({ fromCountry: 'CN', toCountry: 'NL', weightKg: 2, parcels: 1 });
    expect(q.length).toBeGreaterThan(0);
    for (const r of q) expect(Number.isInteger(r.priceCents)).toBe(true);
  });
});
