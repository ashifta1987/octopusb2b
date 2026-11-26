import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCountries, pickService, productTypeMatches, ruleText, serviceProblem, type RuleDraft, type ServiceForRules } from '@/lib/carriers/rules';
import { buildPdf, pdfAscii } from '@/lib/carriers/pdf';
import { fourPxSign, fourPxStatus } from '@/lib/carriers/fourpx';
import { getCarrierAdapter, credentialsPresent, CarrierError } from '@/lib/carriers';
import { sandboxTrackingNo } from '@/lib/carriers/sandbox';
import { labelPath } from '@/lib/warehouse-w4';

/** Warehouse OS · W4 — carrier rule evaluator (mirror of wh_carrier_pick), label PDF writer, adapter switch. */
const svc = (id: string, over: Partial<ServiceForRules> = {}): ServiceForRules => ({
  id, name: id, active: true, accountActive: true, accountName: `acc-${id}`, sandbox: false, accepts_battery: false, accepts_liquid: false, max_weight_g: null, ...over,
});
const STD = svc('4PX standard', { accepts_battery: true, max_weight_g: 2000 });
const EXP = svc('4PX express', { max_weight_g: 30000 });
const YT = svc('YunExpress', { accepts_liquid: true });
const services = [STD, EXP, YT];
const rules: RuleDraft[] = [
  { seq: 1, countries: ['DE', 'FR'], product_type: 'battery', min_weight_g: null, max_weight_g: 2000, service_id: STD.id },
  { seq: 2, countries: ['DE', 'FR'], product_type: 'general', min_weight_g: 0, max_weight_g: 30000, service_id: EXP.id },
  { seq: 3, countries: [], product_type: 'liquid', min_weight_g: null, max_weight_g: null, service_id: YT.id },
];
const pick = (country: string, dg: string[], weightG: number | null, extra: Partial<Parameters<typeof pickService>[0]> = {}) =>
  pickService({ rules, fallbackId: YT.id, services, country, dg, weightG, staging: true, ...extra });

describe('carrier rules: evaluation', () => {
  it('matches the first rule by country, product type and weight', () => {
    const r = pick('de', ['battery'], 800);
    expect(r).toMatchObject({ ok: true, serviceId: STD.id, ruleSeq: 1, fallback: false });
    expect(r.reason).toBe('Rule 1 (DE, FR · battery · up to 2,000 g) → 4PX standard');
    expect(pick('FR', [], 1200)).toMatchObject({ serviceId: EXP.id, ruleSeq: 2 });
  });
  it('dangerous goods change the rule: a battery never matches the "no dangerous goods" rule', () => {
    expect(pick('DE', ['battery', 'magnet'], 500).ruleSeq).toBe(1);
    expect(pick('DE', ['magnet'], 500)).toMatchObject({ fallback: true, serviceId: YT.id });
    expect(pick('US', ['liquid'], 300)).toMatchObject({ ruleSeq: 3, serviceId: YT.id });
  });
  it('weight outside the range falls through to the next rule or the fallback', () => {
    const r = pick('FR', [], 40000);
    expect(r).toMatchObject({ ok: true, fallback: true, serviceId: YT.id, ruleSeq: null });
    expect(r.reason).toBe('No rule matched → fallback YunExpress');
    // a 2.5 kg battery parcel is above rule 1 and the fallback takes no batteries → no service at all
    expect(pick('DE', ['battery'], 2500)).toMatchObject({ ok: false, serviceId: null });
  });
  it('a matching rule whose service cannot carry the parcel is skipped, with the reason', () => {
    const r = pick('DE', ['battery', 'liquid'], 500);
    // rule 1 matches but 4PX standard takes no liquids; rule 3 matches but YunExpress takes no batteries; fallback = YunExpress → none
    expect(r.ok).toBe(false);
    expect(r.serviceId).toBeNull();
    expect(r.skipped.map((s) => s.seq)).toEqual([1, 3, null]);
    expect(r.reason).toContain('rule 1: 4PX standard does not take liquids');
    expect(r.reason).toContain('fallback: YunExpress does not take batteries');
  });
  it('switched-off services, accounts and sandbox outside staging are never chosen', () => {
    const off = [svc(STD.id, { ...STD, active: false }), EXP, YT];
    expect(pickService({ rules, fallbackId: YT.id, services: off, country: 'DE', dg: ['battery'], weightG: 100, staging: true }).reason)
      .toContain('rule 1: 4PX standard is switched off');
    const sandbox = [svc(STD.id, { ...STD, sandbox: true }), EXP, YT];
    expect(pickService({ rules, fallbackId: YT.id, services: sandbox, country: 'DE', dg: ['battery'], weightG: 100, staging: false }).skipped[0].why)
      .toBe('acc-4PX standard is a sandbox account (staging only)');
  });
  it('unknown weight skips weight-bound rules and uses the fallback', () => {
    const r = pick('DE', [], null);
    expect(r).toMatchObject({ fallback: true, serviceId: YT.id });
    expect(r.reason).toContain('rule 2: weight unknown');
  });
  it('without a fallback nothing is chosen', () => {
    expect(pick('JP', [], 100, { fallbackId: null })).toMatchObject({ ok: false, reason: 'Choose a fallback service' });
  });
  it('helpers: product types, rule text, service problem, countries', () => {
    expect(productTypeMatches('general', [])).toBe(true);
    expect(productTypeMatches('dangerous', ['powder'])).toBe(true);
    expect(productTypeMatches('battery', ['liquid'])).toBe(false);
    expect(ruleText([], 'any', null, null)).toBe('any country · any product · any weight');
    expect(ruleText(['US'], 'dangerous', 500, null)).toBe('US · any dangerous goods · from 500 g');
    expect(ruleText(['US'], 'general', 100, 20000)).toBe('US · no dangerous goods · 100–20,000 g');
    expect(serviceProblem(STD, [], 2001, true)).toBe('4PX standard takes up to 2,000 g');
    expect(parseCountries('de, fr ;us de')).toEqual(['DE', 'FR', 'US']);
    expect(parseCountries('')).toEqual([]);
    expect(parseCountries('Germany')).toBeNull();
  });
});

describe('label PDF and sandbox numbers', () => {
  it('writes a valid one-page PDF with exact xref offsets', () => {
    const bytes = buildPdf([{ t: 'text', x: 10, y: 10, size: 12, text: 'Hello (world) · Müller' }, { t: 'barcode', x: 10, y: 40, w: 200, h: 50, value: 'SBXPX123456789012' }], 'T');
    const s = new TextDecoder().decode(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...s.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(s).toContain('(Hello \\(world\\) - Muller) Tj');
    expect(pdfAscii('配送')).toBe('??');
  });
  it('sandbox tracking numbers say SBX and the label path matches the database rule', () => {
    expect(sandboxTrackingNo('4px')).toMatch(/^SBXPX\d{12}$/);
    expect(sandboxTrackingNo('yunexpress')).toMatch(/^SBXYT\d{12}$/);
    expect(labelPath('FS-01', 'WO-000123', 2, 'SBXPX000000000001')).toBe('FS-01/WO-000123/P2-SBXPX000000000001.pdf');
  });
});

describe('adapter switch per account', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });
  it('sandbox only on staging; live 4PX only with credentials; YunExpress live not built yet', () => {
    process.env.APP_ENVIRONMENT = 'production';
    expect(() => getCarrierAdapter({ carrier: '4px', mode: 'sandbox', credentialEnv: null })).toThrow(CarrierError);
    expect(credentialsPresent({ carrier: '4px', mode: 'sandbox', credentialEnv: null })).toBe(false);
    process.env.APP_ENVIRONMENT = 'staging';
    expect(getCarrierAdapter({ carrier: '4px', mode: 'sandbox', credentialEnv: null }).mode).toBe('sandbox');
    delete process.env.FOURPX_T1_APP_KEY;
    expect(() => getCarrierAdapter({ carrier: '4px', mode: 'live', credentialEnv: 'FOURPX_T1' })).toThrow(/not connected/);
    process.env.FOURPX_T1_APP_KEY = 'k';
    process.env.FOURPX_T1_APP_SECRET = 's';
    expect(credentialsPresent({ carrier: '4px', mode: 'live', credentialEnv: 'FOURPX_T1' })).toBe(true);
    expect(getCarrierAdapter({ carrier: '4px', mode: 'live', credentialEnv: 'FOURPX_T1' }).mode).toBe('live');
    expect(() => getCarrierAdapter({ carrier: 'yunexpress', mode: 'live', credentialEnv: 'YT_X' })).toThrow(/not connected in Warehouse OS yet/);
  });
  it('sandbox labels are made without calling any carrier', async () => {
    process.env.APP_ENVIRONMENT = 'staging';
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await getCarrierAdapter({ carrier: '4px', mode: 'sandbox', credentialEnv: null }).createLabel({
      orderCode: 'WO-000001', reference: 'CL6-1', parcelSeq: 1, parcelCount: 1, weightG: 600, serviceCode: 'PX-STD', serviceName: '4PX standard',
      dangerousGoods: ['battery'], shipTo: { name: 'Erika Muster', city: 'Berlin', country: 'DE' }, shipFrom: { name: 'Foshan', city: 'Foshan', country: 'CN' }, items: [],
    });
    expect(spy).not.toHaveBeenCalled();
    expect(res.trackingNo).toMatch(/^SBXPX/);
    const text = new TextDecoder().decode(res.pdf);
    expect(text).toContain('SANDBOX - NOT A REAL LABEL');
    expect(text).toContain('Contains lithium battery');
  });
  it('4PX signature and status mapping are stable', () => {
    expect(fourPxSign({ appKey: 'k', format: 'json', method: 'm', timestamp: '1', v: '1.0.0', body: '{}', appSecret: 's' })).toMatch(/^[0-9a-f]{32}$/);
    expect(fourPxStatus('FPX_S_OK')).toBe('delivered');
    expect(fourPxStatus('weird')).toBe('info');
  });
});
