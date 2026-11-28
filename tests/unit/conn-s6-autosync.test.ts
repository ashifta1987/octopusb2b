import { describe, expect, it } from 'vitest';
import { ECB_DAILY_URL, fetchEcbDay, parseEcbXml, ratesPerUsd } from '@/lib/fx/ecb';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-11-27'>
      <Cube currency='USD' rate='1.0812'/>
      <Cube currency='JPY' rate='162.35'/>
      <Cube currency='GBP' rate='0.83125'/>
      <Cube currency='TRY' rate='37.4512'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe('CONN S6 · ECB reference rates', () => {
  it('reads the day and the rates per EUR', () => {
    expect(parseEcbXml(XML)).toEqual({ date: '2026-11-27', perEur: { USD: 1.0812, JPY: 162.35, GBP: 0.83125, TRY: 37.4512 } });
    expect(parseEcbXml('<html>maintenance</html>')).toBeNull();
  });
  it('turns them into units per 1 USD (EUR = 1 / USD rate), 6 decimals, no USD row', () => {
    const r = ratesPerUsd(parseEcbXml(XML)!)!;
    expect(r).toEqual([
      { currency: 'EUR', rate_per_usd: 0.924898 },
      { currency: 'GBP', rate_per_usd: 0.768822 },
      { currency: 'JPY', rate_per_usd: 150.157233 },
      { currency: 'TRY', rate_per_usd: 34.63855 },
    ]);
    expect(ratesPerUsd({ date: '2026-11-27', perEur: { GBP: 0.8 } })).toBeNull();
  });
  it('fetches the official feed and fails in words', async () => {
    let url = '';
    const ok = (async (u: string) => { url = u; return new Response(XML, { status: 200 }); }) as unknown as typeof fetch;
    expect((await fetchEcbDay(ok)).date).toBe('2026-11-27');
    expect(url).toBe(ECB_DAILY_URL);
    await expect(fetchEcbDay((async () => new Response('x', { status: 503 })) as unknown as typeof fetch)).rejects.toThrow(/HTTP 503/);
    await expect(fetchEcbDay((async () => new Response('<x/>', { status: 200 })) as unknown as typeof fetch)).rejects.toThrow(/could not be read/);
  });
});
