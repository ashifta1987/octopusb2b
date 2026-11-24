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
  it('price trial reads shipping_rate_cards (throws "No rate set" when empty) and createShipment fails closed outside staging', async () => {
    const prev = process.env.APP_ENVIRONMENT;
    try {
      // Empty rate card table (e.g. on live before rate cards are published) -> "No rate set", never 0 or hardcoded
      process.env.APP_ENVIRONMENT = 'production';
      await expect(
        new YunExpressAdapter(async () => []).priceTrial({ fromCountry: 'CN', toCountry: 'NL', weightKg: 2, parcels: 1 }),
      ).rejects.toThrow('No rate set');

      await expect(
        new YunExpressAdapter().createShipment({ orderCode: 'ORD-1', toCountry: 'NL', weightKg: 2, parcels: 1, service: 'BKPHR' }),
      ).rejects.toThrow('Carrier not connected');

      // Populated rate card rows -> returns exact integer USD cents
      const seededAdapter = new YunExpressAdapter(async (req) => [
        {
          carrier: 'YunExpress',
          service: 'YunExpress Priority Direct [BKPHR]',
          priceCents: 480 + Math.ceil((req.weightKg * 1000) / 100) * 95,
          days: '3–5',
        },
      ]);
      const q = await seededAdapter.priceTrial({ fromCountry: 'CN', toCountry: 'AE', weightKg: 0.55, parcels: 1 });
      expect(q).toHaveLength(1);
      expect(Number.isInteger(q[0].priceCents)).toBe(true);
      expect(q[0].priceCents).toBe(480 + 6 * 95);
    } finally {
      if (prev === undefined) delete process.env.APP_ENVIRONMENT;
      else process.env.APP_ENVIRONMENT = prev;
    }
  });
});
