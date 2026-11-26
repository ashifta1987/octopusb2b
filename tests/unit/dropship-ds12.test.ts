import { describe, expect, it } from 'vitest';
import {
  bpPct, csvCell, pctChange, periodRange, planNotice, pointsChange, reportCsvRows, shareOf, toCsv, usd, usdWhole, REPORT_CSV_HEADERS,
} from '@/lib/dropship-ds12-shared';
import { packingSlipHtml } from '@/lib/dropship-print';

/** Release 5 · Steps 12 / 13 — shared helpers for Plan and billing, Dashboard, Reports and the CSV exports. */
describe('money and change labels', () => {
  it('formats US$ with two decimals; unknown stays unknown', () => {
    expect(usd(1820)).toBe('US$18.20');
    expect(usd(-1280)).toBe('−US$12.80');
    expect(usd(null)).toBe('Not known yet');
    expect(usdWhole(7998)).toBe('US$80');
  });
  it('change vs previous period, share of sales, refund points', () => {
    expect(pctChange(108, 100)).toBe('+8%');
    expect(pctChange(90, 100)).toBe('−10%');
    expect(pctChange(5, 0)).toBeNull();
    expect(shareOf(50, 100)).toBe('50% of sales');
    expect(shareOf(1, 0)).toBeNull();
    expect(bpPct(3333)).toBe('33.3%');
    expect(bpPct(null)).toBe('No orders yet');
    expect(pointsChange(210, 250)).toBe('−0.4 points');
    expect(pointsChange(210, 210)).toBe('no change');
  });
});

describe('report period', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  it('last 30 / 7 days and this quarter', () => {
    expect(periodRange('30d', now)!.from).toBe('2026-10-27T12:00:00.000Z');
    expect(periodRange('7d', now)!.from).toBe('2026-11-19T12:00:00.000Z');
    expect(periodRange('quarter', now)!.from).toBe('2026-10-01T00:00:00.000Z');
  });
  it('custom: end date included, refuses reversed or too long ranges', () => {
    expect(periodRange('custom', now, '2026-11-01', '2026-11-03')).toEqual({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' });
    expect(periodRange('custom', now, '2026-11-05', '2026-11-01')).toBeNull();
    expect(periodRange('custom', now, '2024-01-01', '2026-11-01')).toBeNull();
    expect(periodRange('custom', now, 'x', '2026-11-01')).toBeNull();
  });
});

describe('CSV', () => {
  it('cells are quoted and spreadsheet-safe (no formula injection), negatives kept', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"HYPERLINK(""x"")"');
    expect(csvCell('+1+2')).toBe('"1+2"');
    expect(csvCell('-12.80')).toBe('"-12.80"');
    expect(csvCell(null)).toBe('""');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('"a","b"\r\n"1","x,y"\r\n');
  });
  it('report rows: USD with two decimals, unknown sales empty, refund label', () => {
    const rows = reportCsvRows([{
      order_number: 'SO-1', external_order_name: '#1002', created_at: '2026-11-23T10:00:00Z', country: 'AE', shipping_method: 'standard', buyer_currency: 'AED',
      fx_rate_to_usd: 0.2723, sales_usd_cents: null, product_cents: 800, processing_cents: 120, shipping_cents: 400, duties_cents: 0, refunds_cents: 0,
      costs_cents: 1320, profit_cents: null, refunded: true, full_refund: true, delivered_at: null, delivery_days: null,
    }]);
    expect(rows[0]).toHaveLength(REPORT_CSV_HEADERS.length);
    expect(rows[0][7]).toBe('');
    expect(rows[0][8]).toBe('8.00');
    expect(rows[0][15]).toBe('Fully refunded');
  });
});

describe('plan notices (States-Money)', () => {
  const base = { billing_enabled: false, status: 'free', channel: 'wallet' as const, trial_days: 30, trial_days_left: null, trial_ends_at: null, grace_ends_at: null,
    plan_name: null, plan_approved: false, free_forever: false, current_period_end: null, last_charge_error: null };
  it('plans free while plan fees are off', () => {
    expect(planNotice(base).title).toBe('Plans are free for now');
    expect(planNotice(base).text).toContain('30 days free');
  });
  it('trial, grace, paused, Shopify stub, free forever', () => {
    expect(planNotice({ ...base, billing_enabled: true, status: 'trial', trial_days_left: 22, trial_ends_at: '2026-12-15T00:00:00Z' }).title).toBe('Free trial: 22 days left');
    expect(planNotice({ ...base, billing_enabled: true, status: 'grace', grace_ends_at: '2026-12-22T00:00:00Z' }).text).toContain('Paid orders keep shipping');
    expect(planNotice({ ...base, billing_enabled: true, status: 'paused' }).title).toBe('New pushes are paused');
    expect(planNotice({ ...base, billing_enabled: true, status: 'trial', channel: 'shopify' }).text).toContain('once your store is connected');
    expect(planNotice({ ...base, billing_enabled: true, status: 'free_forever', free_forever: true }).tone).toBe('ok');
  });
});

describe('packing slip extras (Settings › Branding / Policies)', () => {
  const brand = { brand_name: 'Anna Home', return_name: 'Anna', return_line1: '1 Road', return_line2: null, return_city: 'Dubai', return_region: null, return_postal_code: null, return_country: 'AE' };
  const slip = (extras?: Parameters<typeof packingSlipHtml>[0]['extras']) => packingSlipHtml({ brand, orderCode: '#1', date: '2026-11-26', tracking: null, shipTo: { name: 'Omar' }, items: [], extras });
  it('unchanged without extras; logo only over https; policy escaped', () => {
    expect(slip()).not.toContain('<img');
    expect(slip({ logoUrl: 'javascript:alert(1)' })).not.toContain('<img');
    const html = slip({ logoUrl: 'https://x.supabase.co/storage/v1/object/sign/l.png?token=a', returnsPolicy: '<b>14 days</b>', supportEmail: 'help@anna.example' });
    expect(html).toContain('<img src="https://x.supabase.co');
    expect(html).toContain('&lt;b&gt;14 days&lt;/b&gt;');
    expect(html).toContain('help@anna.example');
    expect(html).not.toMatch(/octopus/i);
  });
});
