import { describe, expect, it } from 'vitest';
import { TK_PHASES, areaLabel, budgetLabel, earlierPhases, nextPhase, phaseLabel, phaseStates, tkStatus, usdToCents } from '@/lib/turnkey/format';

describe('turnkey T2 client projects (design turnkey-v2: 8 phases)', () => {
  it('phase codes match the database (tk_stages) in order', () => {
    expect(TK_PHASES.map((p) => p.code)).toEqual(['enquiry', 'consultation', 'design', 'sourcing', 'quote_deposit', 'production_qc', 'shipment', 'handover']);
    expect(phaseLabel('consultation')).toBe('Phase 2 of 8 · Consultation');
    expect(nextPhase('enquiry')?.code).toBe('consultation');
    expect(nextPhase('handover')).toBeNull();
    expect(earlierPhases('design').map((p) => p.code)).toEqual(['enquiry', 'consultation']);
    expect(earlierPhases('enquiry')).toEqual([]);
  });

  it('phase states: done before, current, to do after', () => {
    const s = phaseStates('design', [{ stage: 'design', started_at: '2026-12-01T00:00:00Z', completed_at: null, due_on: '2027-01-10' }]);
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(s[2].row?.due_on).toBe('2027-01-10');
    expect(s[0].row).toBeNull();
  });

  it('unknown values are "Not given", never $0 or 0 m²', () => {
    expect(budgetLabel(null)).toBe('Not given');
    expect(budgetLabel(3500000)).toBe('$35,000');
    expect(budgetLabel(1050)).toBe('$10.50');
    expect(areaLabel(null)).toBe('Not given');
    expect(areaLabel(120.5)).toBe('About 120.5 m²');
  });

  it('dollars typed in the form become integer cents', () => {
    expect(usdToCents('')).toBeNull();
    expect(usdToCents('35,000')).toBe(3500000);
    expect(usdToCents('$99.5')).toBe(9950);
    expect(Number.isNaN(usdToCents('lots'))).toBe(true);
    expect(Number.isNaN(usdToCents('-5'))).toBe(true);
  });

  it('status labels', () => {
    expect(tkStatus('open').label).toBe('In progress');
    expect(tkStatus('on_hold')).toEqual({ label: 'On hold', tone: 'amber' });
    expect(tkStatus('weird').label).toBe('weird');
  });
});
