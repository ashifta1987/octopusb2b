import { describe, expect, it } from 'vitest';
import { dollarsToCents, feeTotals, funnelShare, parseRetentionDays, reportCsv, reportPeriod, settingChangeLabel, type TkFeeRow } from '@/lib/turnkey/reports';

const FEES: TkFeeRow[] = [
  { period: '2026-10-01', service_key: 'consultation', service_name: 'Consultation', issued_count: 1, issued_cents: 9900, paid_cents: 9900, outstanding_cents: 0, void_count: 0 },
  { period: '2026-11-01', service_key: 'consultation', service_name: 'Consultation', issued_count: 2, issued_cents: 45000, paid_cents: 30000, outstanding_cents: 15000, void_count: 1 },
  { period: '2026-11-01', service_key: 'visit_china', service_name: 'Visit China with us', issued_count: 1, issued_cents: 188000, paid_cents: 0, outstanding_cents: 188000, void_count: 0 },
];

describe('turnkey T7 report helpers', () => {
  it('period: whole UTC months back from this month, or all time', () => {
    const now = new Date('2026-11-26T10:00:00Z');
    expect(reportPeriod('1', now)).toMatchObject({ months: 1, from: '2026-11-01T00:00:00.000Z' });
    expect(reportPeriod('6', now).from).toBe('2026-06-01T00:00:00.000Z');
    expect(reportPeriod('12', now).from).toBe('2025-12-01T00:00:00.000Z');
    expect(reportPeriod('all', now)).toMatchObject({ months: 0, from: null, label: 'All time' });
    expect(reportPeriod(undefined, now).months).toBe(6);
    expect(reportPeriod('7', now).months).toBe(6);
  });

  it('fee totals add the months per service in integer cents, biggest first', () => {
    const t = feeTotals(FEES);
    expect(t.map((x) => x.service_key)).toEqual(['visit_china', 'consultation']);
    expect(t[1]).toMatchObject({ issued_count: 3, issued_cents: 54900, paid_cents: 39900, outstanding_cents: 15000, void_count: 1 });
    expect(feeTotals([])).toEqual([]);
  });

  it('funnel share: unknown stays empty', () => {
    expect(funnelShare(1, 3)).toBe(33);
    expect(funnelShare(3, 3)).toBe(100);
    expect(funnelShare(0, 0)).toBeNull();
  });

  it('CSV: integer cents, ISO months and dates, one row per record', () => {
    const fees = reportCsv('fees', FEES);
    expect(fees.head).toEqual(['month', 'service_code', 'service', 'issued_count', 'issued_cents', 'paid_cents', 'outstanding_cents', 'void_count']);
    expect(fees.rows[1]).toEqual(['2026-11', 'consultation', 'Consultation', 2, '45000', '30000', '15000', 1]);
    const age = reportCsv('ageing', [{ bucket: '90+', sort: 4, open_count: 1, outstanding_cents: 70000, oldest_days: 100 }, { bucket: '0–30', sort: 1, open_count: 0, outstanding_cents: 0, oldest_days: null }]);
    expect(age.rows).toEqual([['90+', 1, '70000', 100], ['0–30', 0, '0', '']]);
    const unpaid = reportCsv('unpaid', [{ document_id: 'x', number: 'PF-2026-000001', project_code: 'TKP-00001', client_name: null, service_name: 'Consultation', amount_cents: 15000, paid_cents: 0, outstanding_cents: 15000, issued_at: '2026-11-26T08:00:00Z', age_days: 0 }]);
    expect(unpaid.rows[0]).toEqual(['PF-2026-000001', 'TKP-00001', '', 'Consultation', '15000', '0', '15000', '2026-11-26', 0]);
    expect(reportCsv('inspectors', [{ inspector_id: 'i', inspector_name: 'Li', open_jobs: 1, due_7_days: 0, overdue: 1, awaiting_review: 0, published_in_period: 2, next_on: null }]).rows[0])
      .toEqual(['Li', 1, 0, 1, 0, 2, '']);
    expect(reportCsv('funnel', [{ seq: 1, stage: 'enquiry', stage_name: 'Enquiry', reached: 3, open_now: 1, on_hold_now: 1, cancelled_here: 0, completed_here: 0 }]).rows[0])
      .toEqual([1, 'enquiry', 'Enquiry', 3, 1, 1, 0, 0]);
  });

  it('settings inputs: dollars to cents, retention days', () => {
    expect(dollarsToCents('99')).toBe(9900);
    expect(dollarsToCents('99.5')).toBe(9950);
    expect(dollarsToCents('1,250.05')).toBe(125005);
    expect(dollarsToCents('-1')).toBeNull();
    expect(dollarsToCents('9.999')).toBeNull();
    expect(dollarsToCents('')).toBeNull();
    expect(parseRetentionDays('30')).toBe(30);
    expect(parseRetentionDays('0')).toBeNull();
    expect(parseRetentionDays('366')).toBeNull();
    expect(parseRetentionDays('3.5')).toBeNull();
  });

  it('settings change lines read in plain English', () => {
    expect(settingChangeLabel({ action: 'turnkey.setting', details: { setting: 'extra_traveller_day_cents', old: 9900, new: 12000 } })).toBe('Extra traveller per day: US$ 99.00 → US$ 120.00');
    expect(settingChangeLabel({ action: 'turnkey.setting', details: { setting: 'am_waiver_threshold_cents', old: null, new: 5000000 } })).toBe('Account manager fee waived above: not set → US$ 50,000.00');
    expect(settingChangeLabel({ action: 'turnkey.setting', details: { setting: 'passport_retention_days', old: 30, new: 45 } })).toBe('Passport copies kept: 30 → 45 days after the visit');
    expect(settingChangeLabel({ action: 'turnkey.deposit_pct', details: { old: null, new: 30 } })).toBe('Deposit: not set → 30%');
  });
});
