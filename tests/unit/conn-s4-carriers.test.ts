import { describe, expect, it, vi, afterEach } from 'vitest';
import { commercialInvoiceOps, commercialInvoicePdf, usd, type CommercialInvoice } from '@/lib/carriers/commercial-invoice';
import { serviceProblem, type ServiceForRules } from '@/lib/carriers/rules';
import { SandboxCarrierAdapter } from '@/lib/carriers/sandbox';
import { FourPxAdapter } from '@/lib/carriers/fourpx';

const ci: CommercialInvoice = {
  number: 'CI-SH-0001', date: '2026-11-28', sandbox: false, tracking_no: 'PX123456789', service_name: '4PX standard', order_code: 'WO-1', reference: '#1001',
  exporter: { name: 'Lumen & Co', address: 'Returns, 5 Brand St', city: 'Dubai', province: null, postcode: null, country: 'AE' },
  consignee: { name: 'Ann Buyer', phone: '+4930', address: { line1: '1 Way', city: 'Berlin', postcode: '10115' }, country: 'DE' },
  scope: 'dropship', duty_type: 'DAP', incoterm: 'DAP', currency: 'USD', declared_usd_cents: 5000, weight_g: 500,
  items: [
    { sku: 'DS-000001-01', description_en: 'Desk lamp', hs_code: '9405110000', qty: 2, unit_value_cents: 2500, value_cents: 5000, origin_country: 'CN', unit_weight_g: 200 },
    { sku: 'X', description_en: 'Client item', hs_code: null, qty: 1, unit_value_cents: null, value_cents: null, origin_country: null, unit_weight_g: null },
  ],
};
const texts = (c: CommercialInvoice) => commercialInvoiceOps(c).filter((o): o is Extract<ReturnType<typeof commercialInvoiceOps>[number], { t: 'text' }> => o.t === 'text').map((o) => o.text);

describe('CONN S4 · commercial invoice', () => {
  it('prints shipper (brand), consignee, terms, items and the declared total; unknown values say "not set", never 0', () => {
    const t = texts(ci).join('\n');
    expect(t).toContain('COMMERCIAL INVOICE');
    expect(t).toContain('Lumen & Co');
    expect(t).toContain('Ann Buyer');
    expect(t).toContain('10115 Berlin');
    expect(t).toContain('Order #1001 (WO-1)');
    expect(t).toContain('DAP - paid by the receiver');
    expect(t).toContain('9405110000');
    expect(t).toContain('US$ 25.00');
    expect(t).toContain('Total declared value: US$ 50.00');
    expect(t).toMatch(/Client item[\s\S]*not set/);
    expect(t).not.toMatch(/US\$ 0\.00/);
    expect(t).not.toMatch(/octopus/i);
    expect(usd(null)).toBe('not set');
  });
  it('marks a sandbox label as a test document and builds a valid A4 PDF', () => {
    expect(texts({ ...ci, sandbox: true }).join(' ')).toContain('SANDBOX - TEST DOCUMENT, NOT FOR CUSTOMS');
    const pdf = new TextDecoder().decode(commercialInvoicePdf(ci));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

describe('CONN S4 · magnets in the rule tester', () => {
  const s: ServiceForRules = { id: 's', name: 'Air', active: true, accountActive: true, accountName: 'A', sandbox: false, accepts_battery: true, accepts_liquid: true, max_weight_g: null };
  it('refuses magnets only where the service does not take them (older data = takes them)', () => {
    expect(serviceProblem(s, ['magnet'], 100, false)).toBeNull();
    expect(serviceProblem({ ...s, accepts_magnet: true }, ['magnet'], 100, false)).toBeNull();
    expect(serviceProblem({ ...s, accepts_magnet: false }, ['magnet'], 100, false)).toBe('Air does not take magnets');
  });
});

describe('CONN S4 · carrier credential checks', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('sandbox: ok on staging, refused elsewhere', async () => {
    vi.stubEnv('APP_ENVIRONMENT', 'staging');
    expect(await new SandboxCarrierAdapter('4px').validateCredentials()).toMatchObject({ ok: true });
    vi.stubEnv('APP_ENVIRONMENT', 'production');
    expect(() => new SandboxCarrierAdapter('4px')).toThrow(/staging/);
  });
  it('4PX: a key / signature refusal fails, "no such order" passes, unreachable fails; no key in the message', async () => {
    vi.stubEnv('FPXT_APP_KEY', 'key-123');
    vi.stubEnv('FPXT_APP_SECRET', 'secret-456');
    const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const bad = await new FourPxAdapter('FPXT', answer({ result: '0', errors: [{ error_msg: 'invalid sign' }] })).validateCredentials();
    expect(bad).toMatchObject({ ok: false });
    expect(bad.message).not.toMatch(/secret-456|key-123/);
    expect(await new FourPxAdapter('FPXT', answer({ result: '0', msg: 'order not found' })).validateCredentials()).toMatchObject({ ok: true });
    expect(await new FourPxAdapter('FPXT', answer({ result: '1', data: { trackingList: [] } })).validateCredentials()).toEqual({ ok: true, message: '4PX accepted the credentials.' });
    expect(await new FourPxAdapter('FPXT', (async () => { throw new Error('down'); }) as unknown as typeof fetch).validateCredentials()).toMatchObject({ ok: false });
  });
});
