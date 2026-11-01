import { describe, expect, it } from 'vitest';
import { authorLabel, initials, slaInfo } from '@/components/backoffice/assistant/sla';
import { estimateCost, parseCountryMap, parseOfficeHours, parseRules, parseTopics, toggleVip } from '@/components/admin/assistant/settings-schema';
import { computeAssistantMetrics, metricAlerts, yesterdayUtc } from '@/app/api/cron/assistant-metrics/metrics';

const NOW = Date.parse('2026-11-01T10:00:00Z');

describe('assistant queue SLA counter', () => {
  it('counts down and flags overdue with a text label', () => {
    expect(slaInfo('2026-11-01T10:34:00Z', NOW)).toMatchObject({ text: '34 min left', overdue: false });
    expect(slaInfo('2026-11-01T12:05:00Z', NOW).text).toBe('2 h 5 min left');
    expect(slaInfo('2026-11-01T10:10:00Z', NOW).soon).toBe(true);
    const o = slaInfo('2026-11-01T09:48:00Z', NOW);
    expect(o.overdue).toBe(true);
    expect(o.text).toBe('Overdue 12 min');
    expect(slaInfo('2026-11-01T07:00:00Z', NOW).text).toBe('Overdue 3 h');
  });
  it('handles resolved and missing SLA', () => {
    expect(slaInfo('2026-11-01T09:00:00Z', NOW, '2026-11-01T09:30:00Z')).toMatchObject({ text: 'Resolved', overdue: false });
    expect(slaInfo(null, NOW).text).toBe('No SLA');
  });
  it('labels authors and marks internal notes', () => {
    expect(authorLabel('bot', false)).toBe('Octo');
    expect(authorLabel('customer', false)).toBe('Customer');
    expect(authorLabel('staff', true, 'Priya Shah')).toBe('Internal · Priya Shah');
    expect(authorLabel('staff', false, null)).toBe('Staff');
    expect(initials('Priya Shah')).toBe('PS');
    expect(initials('')).toBe('?');
  });
});

describe('assistant admin settings validation', () => {
  it('normalises sensitive topics', () => {
    expect(parseTopics('["Refund", " refund ", "QC   failure"]')).toEqual({ ok: true, value: ['refund', 'qc failure'] });
    expect(parseTopics('[]').ok).toBe(false);
    expect(parseTopics('not json').ok).toBe(false);
    expect(parseTopics(['x']).ok).toBe(false);
  });
  it('builds the team–country map with a default', () => {
    expect(parseCountryMap([{ country: 'de', team: 'Sourcing EU' }, { country: '', team: '' }], 'Sourcing')).toEqual({ ok: true, value: { default: 'Sourcing', DE: 'Sourcing EU' } });
    expect(parseCountryMap([{ country: 'DEU', team: 'X' }], 'Sourcing').ok).toBe(false);
    expect(parseCountryMap([{ country: 'DE', team: 'A' }, { country: 'de', team: 'B' }], 'Sourcing').ok).toBe(false);
    expect(parseCountryMap([], '').ok).toBe(false);
  });
  it('validates numeric rules', () => {
    const good = { confidence_threshold: '0.65', max_customers_per_manager: '50', escalation_sla_minutes: '60', rate_limit_per_min: '20', cost_per_1k_tokens_usd: '0.0006' };
    expect(parseRules(good)).toEqual({ ok: true, value: { confidence_threshold: 0.65, max_customers_per_manager: 50, escalation_sla_minutes: 60, rate_limit_per_min: 20, cost_per_1k_tokens_usd: 0.0006 } });
    expect(parseRules({ ...good, confidence_threshold: '1.5' }).ok).toBe(false);
    expect(parseRules({ ...good, max_customers_per_manager: '2.5' }).ok).toBe(false);
    expect(parseRules({ ...good, escalation_sla_minutes: '' }).ok).toBe(false);
  });
  it('validates office hours', () => {
    expect(parseOfficeHours({ timezone: 'Asia/Shanghai', days: ['5', '1', '1'], start: '09:00', end: '18:00' })).toEqual({ ok: true, value: { timezone: 'Asia/Shanghai', days: [1, 5], start: '09:00', end: '18:00' } });
    expect(parseOfficeHours({ timezone: 'Mars/Base', days: ['1'], start: '09:00', end: '18:00' }).ok).toBe(false);
    expect(parseOfficeHours({ timezone: 'UTC', days: [], start: '09:00', end: '18:00' }).ok).toBe(false);
    expect(parseOfficeHours({ timezone: 'UTC', days: ['1'], start: '18:00', end: '09:00' }).ok).toBe(false);
  });
  it('toggles VIP ids idempotently and estimates cost', () => {
    expect(toggleVip(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleVip(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleVip(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggleVip(null, 'a', true)).toEqual(['a']);
    expect(estimateCost(1_000_000, 0.0006)).toBe(0.6);
    expect(estimateCost(null, 0.0006)).toBe(0);
  });
});

describe('daily assistant metrics (cron)', () => {
  const base = {
    sessions: [
      { id: 's1', escalation_id: null }, { id: 's2', escalation_id: null }, { id: 's3', escalation_id: 'e1' }, { id: 's4', escalation_id: null },
    ],
    botSessionIds: new Set(['s1', 's2', 's3']),
    feedback: [{ thumbs_up: true }, { thumbs_up: true }, { thumbs_up: false }],
    escalations: [{ taken_at: '2026-10-31T10:30:00Z', sla_due_at: '2026-10-31T11:00:00Z' }, { taken_at: null, sla_due_at: '2026-10-31T11:00:00Z' }],
    botMessages: [{ latency_ms: 1000, tokens: 300 }, { latency_ms: 2000, tokens: 200 }, { latency_ms: null, tokens: null }],
    now: NOW,
  };
  it('mirrors assistant_metrics()', () => {
    expect(computeAssistantMetrics(base)).toEqual({
      sessions: 4, resolved_by_bot: 2, escalated: 1, bot_resolution_rate: 75, escalation_rate: 25, satisfaction: 66.7,
      sla_breaches: 1, sla_breach_rate: 50, avg_latency_ms: 1500, tokens: 500,
    });
  });
  it('returns nulls for an empty day and never alerts on no traffic', () => {
    const m = computeAssistantMetrics({ sessions: [], botSessionIds: new Set(), feedback: [], escalations: [], botMessages: [], now: NOW });
    expect(m.bot_resolution_rate).toBeNull();
    expect(m.sla_breach_rate).toBeNull();
    expect(metricAlerts(m)).toEqual([]);
  });
  it('alerts under 70% resolution or over 5% SLA breaches', () => {
    const m = computeAssistantMetrics(base);
    const a = metricAlerts(m);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/SLA breach rate 50%/);
    const low = { ...m, bot_resolution_rate: 60, sla_breach_rate: 0 };
    expect(metricAlerts(low)[0]).toMatch(/below 70%/);
    expect(metricAlerts({ ...m, bot_resolution_rate: 80, sla_breach_rate: 5 })).toEqual([]);
  });
  it('computes yesterday in UTC', () => {
    expect(yesterdayUtc(NOW)).toEqual({ from: '2026-10-31T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', day: '2026-10-31' });
  });
});
