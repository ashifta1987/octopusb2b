import crypto from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isBlockedAddress, marketplaceFor, matchSignature, normaliseStoreUrl, type PageSample } from '@/lib/connectors/signatures';
import { detectPlatform, guardedFetch, resolveSafe } from '@/lib/connectors/detect';
import { open, seal, needsReseal, redact, TokenBoxError } from '@/lib/crypto/token-box';
import { decimalToMinor, minorToDecimal, toIntakeOrder } from '@/lib/connectors/formats';
import { parseOrdersCsv, ORDERS_CSV_TEMPLATE, guessColumns } from '@/lib/connectors/csv';
import { FourPxAdapter, asciiText, fourPxDutyType } from '@/lib/carriers/fourpx';
import { getConnector, connectorStatuses } from '@/lib/connectors/registry';
import type { LabelRequest } from '@/lib/carriers/types';

const page = (p: Partial<PageSample>): PageSample => ({ host: 'shop.example.com', headers: {}, html: '', cookies: [], ...p });
const KEY = crypto.randomBytes(32).toString('base64');
const KEY2 = crypto.randomBytes(32).toString('base64');

describe('C0 store-link: URL normalisation', () => {
  it('adds https and lower-cases the host', () => {
    expect(normaliseStoreUrl('  MyStore.COM/collections ')).toEqual({ url: 'https://mystore.com/collections', host: 'mystore.com', port: 443, path: '/collections' });
  });
  it.each([
    ['', 'Paste'], ['http://user:pw@shop.com', 'user name'], ['ftp://shop.com', 'https'], ['https://127.0.0.1', 'IP address'], ['https://[::1]/', 'IP address'],
    ['https://0x7f000001', 'IP address'], ['https://localhost', 'not a public'], ['https://intranet.corp', 'not a public'], ['https://shop.com:8080', 'port'], ['shop', 'full store address'],
  ])('refuses %s', (input, msg) => {
    const r = normaliseStoreUrl(input);
    expect('error' in r && r.error).toMatch(new RegExp(msg, 'i'));
  });
});

describe('C0 store-link: SSRF address ranges', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00:ec2::254', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::10.0.0.1', '2002:7f00:1::', '2001:db8::1', 'ff02::1', 'not-an-ip'])(
    'blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '23.227.38.65', '104.16.0.1', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e'])('allows public %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
  it('resolveSafe refuses a host when ANY address is private (DNS rebinding with mixed answers)', async () => {
    await expect(resolveSafe('evil.example', async () => [{ address: '23.227.38.65', family: 4 }, { address: '10.0.0.5', family: 4 }])).rejects.toThrow(/private/);
    await expect(resolveSafe('ok.example', async () => [{ address: '23.227.38.65', family: 4 }])).resolves.toEqual({ address: '23.227.38.65', family: 4 });
  });
});

describe('C0 store-link: signatures', () => {
  it.each([
    ['shopify', page({ host: 'x.myshopify.com', html: '<script>Shopify.theme = {}</script>' })],
    ['shopify', page({ headers: { 'x-shopid': '123' }, html: '<link href="//cdn.shopify.com/s/files/x.css">' })],
    ['woocommerce', page({ html: '<link href="/wp-content/plugins/woocommerce/assets/css/x.css"><body class="home woocommerce-no-js">' })],
    ['wix', page({ headers: { 'x-wix-request-id': 'abc' }, html: '<script src="https://static.parastorage.com/x.js"></script>' })],
    ['bigcommerce', page({ html: '<img src="https://cdn11.bigcommerce.com/s-abc123/images/x.png">' })],
    ['magento', page({ html: '<script type="text/x-magento-init">{}</script><link href="/static/version123/frontend/x.css">' })],
    ['prestashop', page({ html: '<meta name="generator" content="PrestaShop"><script>var prestashop = {};</script>' })],
  ])('recognises %s', (platform, p) => expect(matchSignature(p)?.platform).toBe(platform));
  it('a plain page is unknown; one weak hint is not enough', () => {
    expect(matchSignature(page({ html: '<html><body>Hello</body></html>' }))).toBeNull();
    expect(matchSignature(page({ html: '<p>we love bigcommerce</p>' }))).toBeNull();
  });
  it('marketplaces by address (never fetched)', () => {
    expect(marketplaceFor('www.amazon.ae')).toBe('amazon');
    expect(marketplaceFor('ebay.co.uk')).toBe('ebay');
    expect(marketplaceFor('www.etsy.com')).toBe('etsy');
    expect(marketplaceFor('shop.tiktok.com')).toBe('tiktok_shop');
    expect(marketplaceFor('amazon-deals.example.com')).toBeNull();
  });
});

describe('C0 store-link: guarded fetch + detect (no network: injected resolver / requester)', () => {
  const pub = async () => [{ address: '23.227.38.65', family: 4 }];
  it('detects Shopify through a redirect and connects to the checked address only', async () => {
    const calls: { url: string; ip: string }[] = [];
    const request = vi.fn(async (url: URL, pinned: { address: string }) => {
      calls.push({ url: url.toString(), ip: pinned.address });
      if (url.hostname === 'mystore.com') return { status: 301, headers: { location: 'https://www.mystore.com/' }, body: '' };
      return { status: 200, headers: { 'powered-by': 'Shopify' }, body: '<script>window.Shopify = {}</script>' };
    });
    const r = await detectPlatform('mystore.com', { resolve: pub, request });
    expect(r).toMatchObject({ outcome: 'found', platform: 'shopify', host: 'www.mystore.com' });
    expect(calls.map((c) => c.ip)).toEqual(['23.227.38.65', '23.227.38.65']);
  });
  it('blocks a host that resolves to the metadata address', async () => {
    const r = await detectPlatform('metadata.example.com', { resolve: async () => [{ address: '169.254.169.254', family: 4 }], request: vi.fn() });
    expect(r.outcome).toBe('blocked');
  });
  it('blocks a redirect to a private address, to http, to an odd port, and too many redirects', async () => {
    const resolve = async (h: string) => (h === 'internal.example.com' ? [{ address: '10.0.0.8', family: 4 }] : [{ address: '23.227.38.65', family: 4 }]);
    const to = (location: string) => vi.fn(async (url: URL) => (url.hostname === 'shop.example.com' ? { status: 302, headers: { location }, body: '' } : { status: 200, headers: {}, body: '' }));
    expect((await detectPlatform('shop.example.com', { resolve, request: to('https://internal.example.com/') })).outcome).toBe('blocked');
    expect((await detectPlatform('shop.example.com', { resolve, request: to('http://other.example.com/') })).outcome).toBe('blocked');
    expect((await detectPlatform('shop.example.com', { resolve, request: to('https://other.example.com:8443/') })).outcome).toBe('blocked');
    const loop = vi.fn(async (url: URL) => ({ status: 302, headers: { location: `https://${url.hostname === 'a.example.com' ? 'b' : 'a'}.example.com/` }, body: '' }));
    expect((await detectPlatform('a.example.com', { resolve, request: loop })).outcome).toBe('blocked');
  });
  it('unknown, unreachable and not-found are told apart', async () => {
    expect((await detectPlatform('plain.example.com', { resolve: pub, request: vi.fn(async () => ({ status: 200, headers: {}, body: '<p>hi</p>' })) })).outcome).toBe('unknown');
    expect((await detectPlatform('down.example.com', { resolve: pub, request: vi.fn(async () => { throw new Error('TIMEOUT'); }) }))).toMatchObject({ outcome: 'unreachable', reason: expect.stringMatching(/too long/) });
    expect((await detectPlatform('nope.example.com', { resolve: async () => { throw new Error('ENOTFOUND'); }, request: vi.fn() }))).toMatchObject({ outcome: 'unreachable', reason: expect.stringMatching(/does not exist/) });
  });
  it('marketplace links are answered without any request', async () => {
    const request = vi.fn();
    expect((await detectPlatform('https://www.ebay.com/str/myshop', { resolve: pub, request })).outcome).toBe('marketplace');
    expect(request).not.toHaveBeenCalled();
  });
  it('guardedFetch never downgrades https → http', async () => {
    await expect(guardedFetch('https://shop.example.com/', { resolve: pub, request: vi.fn(async () => ({ status: 301, headers: { location: 'http://shop.example.com/' }, body: '' })) })).rejects.toThrow(/unencrypted/);
  });
});

describe('C0 token box (AES-256-GCM)', () => {
  const env = { CONNECTOR_TOKEN_KEY: KEY, CONNECTOR_TOKEN_KEY_VERSION: '2' } as unknown as NodeJS.ProcessEnv;
  it('round trip; the sealed text matches the database format and never contains the token', () => {
    const { sealed, keyVersion } = seal('shpat_0123456789abcdef0123', 'conn-1:access_token', env);
    expect(keyVersion).toBe(2);
    expect(sealed).toMatch(/^v[0-9]{1,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('shpat_');
    expect(open(sealed, 'conn-1:access_token', env)).toBe('shpat_0123456789abcdef0123');
  });
  it('a changed byte, another row (associated data) or another key does not open; errors carry no secret', () => {
    const { sealed } = seal('secret-value-123', 'conn-1:api_key', env);
    const parts = sealed.split('.');
    const flipped = [...parts.slice(0, 3), (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1)].join('.');
    expect(() => open(flipped, 'conn-1:api_key', env)).toThrow(TokenBoxError);
    expect(() => open(sealed, 'conn-2:api_key', env)).toThrow(/could not be opened/);
    try { open(sealed, 'conn-1:api_key', { CONNECTOR_TOKEN_KEY: KEY2, CONNECTOR_TOKEN_KEY_VERSION: '2' } as unknown as NodeJS.ProcessEnv); } catch (e) { expect(String(e)).not.toContain('secret-value-123'); }
  });
  it('rotation: the previous key still opens; needsReseal tells which rows to re-seal', () => {
    const old = { CONNECTOR_TOKEN_KEY: KEY2, CONNECTOR_TOKEN_KEY_VERSION: '1' } as unknown as NodeJS.ProcessEnv;
    const { sealed } = seal('tok', 'c:refresh_token', old);
    const rotated = { CONNECTOR_TOKEN_KEY: KEY, CONNECTOR_TOKEN_KEY_VERSION: '2', CONNECTOR_TOKEN_KEY_PREVIOUS: KEY2, CONNECTOR_TOKEN_KEY_PREVIOUS_VERSION: '1' } as unknown as NodeJS.ProcessEnv;
    expect(open(sealed, 'c:refresh_token', rotated)).toBe('tok');
    expect(needsReseal(sealed, rotated)).toBe(true);
  });
  it('no key → a clear "not configured" error; a short key is refused', () => {
    expect(() => seal('x', 'c:k', {} as NodeJS.ProcessEnv)).toThrow(/CONNECTOR_TOKEN_KEY is missing/);
    expect(() => seal('x', 'c:k', { CONNECTOR_TOKEN_KEY: 'c2hvcnQ=' } as unknown as NodeJS.ProcessEnv)).toThrow(/32 random bytes/);
  });
  it('redact removes tokens, bearer values and sealed text from log lines', () => {
    const { sealed } = seal('abc', 'c:k', env);
    const line = redact(`Authorization: Bearer abc.def.ghi access_token=shpat_123456789abc&x=1 consumer_secret: cs_ABCDEFGHIJ ${sealed}`);
    expect(line).not.toMatch(/abc\.def|shpat_|cs_ABC|v2\./);
  });
});

describe('C0 internal formats + CSV file connector', () => {
  it('decimal → integer minor units by currency (no floating point)', () => {
    expect(decimalToMinor('12.50', 'USD')).toBe(1250);
    expect(decimalToMinor('0.1', 'USD')).toBe(10);
    expect(decimalToMinor('1,234.56', 'USD')).toBe(123456);
    expect(decimalToMinor('1.234,56', 'EUR')).toBe(123456);
    expect(decimalToMinor('12,5', 'EUR')).toBe(1250);
    expect(decimalToMinor('3.125', 'KWD')).toBe(3125);
    expect(decimalToMinor('1500', 'JPY')).toBe(1500);
    expect(decimalToMinor('12.345', 'USD')).toBeNull();
    expect(decimalToMinor('-1', 'USD')).toBeNull();
    expect(decimalToMinor('abc', 'USD')).toBeNull();
    expect(minorToDecimal(3125, 'KWD')).toBe('3.125');
    expect(minorToDecimal(5, 'USD')).toBe('0.05');
  });
  it('the template parses into one order with the buyer price on its line', () => {
    const r = parseOrdersCsv(ORDERS_CSV_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].rows).toEqual([2]);
    expect(r.orders[0].order.lines[0]).toMatchObject({ modelNo: 'DS-000001-01', qty: 1, buyerUnitPriceMinor: 9900 });
    expect(r.orders[0].order.fxRateToUsd).toBeCloseTo(0.2723);
  });
  it('row errors with row numbers; an order with one bad row is skipped whole; a missing price is a row error', () => {
    const csv = [
      'order_id,buyer_name,address1,city,country,currency,sku,qty,unit_price',
      'A1,Sara,1 Way,Dubai,AE,USD,DS-000001-01,1,10.00',
      'A1,Sara,1 Way,Dubai,AE,USD,DS-000002-01,two,10.00',
      'B2,Omar,2 Way,Riyadh,SA,USD,DS-000001-01,1,',
      'C3,Lina,3 Way,London,GB,GBP,DS-000001-01,1,5.00',
      'D4,Ali,4 Way,Doha,QA,USD,DS-000001-01,2,7.5',
    ].join('\n');
    const r = parseOrdersCsv(csv);
    expect(r.orders.map((o) => o.order.externalOrderId)).toEqual(['D4']);
    expect(r.errors.find((e) => e.row === 3)?.message).toMatch(/quantity/);
    expect(r.errors.find((e) => e.row === 4)?.message).toMatch(/price the buyer paid/);
    expect(r.errors.find((e) => e.row === 5)?.message).toMatch(/FX rate to USD is needed for GBP/);
    expect(r.errors.some((e) => /Order A1 is skipped because row 3/.test(e.message))).toBe(true);
    expect(r.orders[0].order.lines[0].buyerUnitPriceMinor).toBe(750);
  });
  it('a missing required column is reported on row 1; columns are guessed from common store exports', () => {
    expect(parseOrdersCsv('order_id,qty\n1,1').errors[0]).toMatchObject({ row: 1, message: expect.stringMatching(/Choose a column for/) });
    const map = guessColumns(['Name', 'Shipping Name', 'Shipping Street', 'Shipping City', 'Shipping Country', 'Currency', 'Lineitem sku', 'Lineitem quantity', 'Lineitem price']);
    expect(map).toMatchObject({ order_id: 0, buyer_name: 1, address1: 2, city: 3, country: 4, currency: 5, sku: 6, qty: 7, unit_price: 8 });
  });
  it('toIntakeOrder writes the ds_order_intake keys (buyer price in the order currency)', () => {
    const j = toIntakeOrder({ externalOrderId: ' 1001 ', currency: 'aed', fxRateToUsd: 0.2723, address: { name: 'Sara', line1: '1 Way', city: 'Dubai', country: 'ae' },
      lines: [{ modelNo: 'ds-000001-01', qty: 2, buyerUnitPriceMinor: 10000, buyerPaidMinor: 18000 }] });
    expect(j).toEqual({ external_order_id: '1001', currency: 'AED', fx_rate_to_usd: 0.2723, address: { name: 'Sara', line1: '1 Way', city: 'Dubai', country: 'AE' },
      lines: [{ model_no: 'DS-000001-01', qty: 2, buyer_unit_price_cents: 10000, buyer_paid_cents: 18000 }] });
  });
});

describe('C0 connector registry', () => {
  it('every planned platform is registered and not configured / not built; CSV works now', async () => {
    const s = connectorStatuses();
    expect(s.find((c) => c.id === 'csv')?.status).toBe('ready');
    expect(s.filter((c) => c.id !== 'csv').every((c) => c.status === 'not_configured' || c.status === 'not_built')).toBe(true);
    await expect(getConnector('shopify').startConnect({ orgId: 'o', shopDomain: 'x.myshopify.com', returnPath: '/' })).rejects.toThrow(/store-connection release/);
    expect(getConnector('shopify').missingEnv().join(',')).not.toMatch(/=|[a-z0-9]{20}/);
  });
});

describe('C0 4PX label: customs declaration', () => {
  afterEach(() => { delete process.env.FOURPX_C0_APP_KEY; delete process.env.FOURPX_C0_APP_SECRET; });
  const req = (customs: LabelRequest['customs']): LabelRequest => ({
    orderCode: 'WO-1', reference: '#1001', parcelSeq: 1, parcelCount: 1, weightG: 600, serviceCode: 'PX-STD', serviceName: 'Standard', dangerousGoods: [],
    shipTo: { name: 'Buyer', country: 'US', line1: '1 Main St', city: 'Austin' }, shipFrom: { name: 'Foshan', city: 'Foshan', country: 'CN' },
    items: [{ sku: 'DS-000001-01', name: 'Lamp', qty: 2, unitWeightG: 250 }], customs,
  });
  it('sends the declared value (what the buyer paid), HS code and the duty type of the order (US = DDP → P)', async () => {
    process.env.FOURPX_C0_APP_KEY = 'k'; process.env.FOURPX_C0_APP_SECRET = 's';
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('ds.xms.order.create')) { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ result: '1', data: { '4px_tracking_no': 'px123456789' } })); }
      if (u.includes('ds.xms.label.get')) return new Response(JSON.stringify({ result: '1', data: { label_url_info: { logistics_label: 'https://label.example/x.pdf' } } }));
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }) as unknown as typeof fetch;
    const a = new FourPxAdapter('FOURPX_C0', fetchImpl);
    const out = await a.createLabel(req({ scope: 'dropship', currency: 'USD', declaredValueCents: 4901, dutyType: 'DDP',
      items: [{ sku: 'DS-000001-01', descriptionEn: 'TEST – Cordless LED Desk Lamp', hsCode: '9405110000', qty: 2, unitValueCents: 2451, valueCents: 4901, originCountry: 'CN', unitWeightG: 250, battery: false, liquid: false, magnet: false }] }));
    expect(out.trackingNo).toBe('PX123456789');
    const b = bodies[0] as { duty_type: string; parcel_list: { parcel_value: string; currency: string; declare_product_info: Record<string, unknown>[] }[] };
    expect(b.duty_type).toBe('P');
    expect(b.parcel_list[0]).toMatchObject({ parcel_value: '49.01', currency: 'USD' });
    expect(b.parcel_list[0].declare_product_info[0]).toMatchObject({ declare_product_name_en: 'TEST - Cordless LED Desk Lamp', hscode_export: '9405110000', declare_unit_price_export: '24.51', declare_product_code_qty: 2, origin_country: 'CN' });
  });
  it('refuses a Dropship label without the customs declaration (never sends a label without a value)', async () => {
    process.env.FOURPX_C0_APP_KEY = 'k'; process.env.FOURPX_C0_APP_SECRET = 's';
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const a = new FourPxAdapter('FOURPX_C0', fetchImpl);
    await expect(a.createLabel(req(null))).rejects.toThrow(/customs declaration is missing/);
    await expect(a.createLabel(req({ scope: 'dropship', currency: 'USD', declaredValueCents: null, dutyType: 'DDP', items: [] }))).rejects.toThrow(/customs declaration/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('duty type + ASCII text helpers', () => {
    expect(fourPxDutyType('DDP')).toBe('P');
    expect(fourPxDutyType('DAP')).toBe('U');
    expect(fourPxDutyType(null)).toBe('U');
    expect(asciiText('Café “Lamp” ×2 – blue')).toBe('Cafe "Lamp" x2 - blue');
  });
});
