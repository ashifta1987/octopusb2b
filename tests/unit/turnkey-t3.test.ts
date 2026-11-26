import { describe, expect, it } from 'vitest';
import { PAY_STATE, TK_GATED_PHASES, TK_PHASES, TK_PHASE_SERVICE, coverActive, feeNeedsApproval, feePayState, feeStatusLabel, isGatedPhase } from '@/lib/turnkey/format';

describe('turnkey T3 helpers', () => {
  it('gated phases are paid phases with a default service (tk_stage_fee_rules)', () => {
    expect(TK_GATED_PHASES).toEqual(['consultation', 'design', 'sourcing', 'production_qc']);
    for (const c of TK_GATED_PHASES) {
      expect(TK_PHASES.find((p) => p.code === c)?.paid).toBe(true);
      expect(TK_PHASE_SERVICE[c]).toBeTruthy();
    }
    expect(isGatedPhase('enquiry')).toBe(false);
    expect(isGatedPhase('quote_deposit')).toBe(false);
  });

  it('2x rule: within 2x the starting fee is active at once; above, or without a starting fee, an admin approves', () => {
    expect(feeNeedsApproval(9900, 9900)).toBe(false);
    expect(feeNeedsApproval(19800, 9900)).toBe(false);
    expect(feeNeedsApproval(19801, 9900)).toBe(true);
    expect(feeNeedsApproval(5000, 9900)).toBe(false);
    expect(feeNeedsApproval(5000, null)).toBe(true);
    expect(feeNeedsApproval(5000, 0)).toBe(true);
  });

  it('pay state: paid only when fully paid; unknown proforma is never paid', () => {
    expect(feePayState(15000, null)).toBe('to_pay');
    expect(feePayState(15000, { paid_cents: 0, status: 'awaiting_payment' })).toBe('to_pay');
    expect(feePayState(15000, { paid_cents: 5000, status: 'part_paid' })).toBe('part_paid');
    expect(feePayState(15000, { paid_cents: 15000, status: 'invoiced' })).toBe('paid');
    expect(feePayState(15000, { paid_cents: 15000, status: 'void' })).toBe('part_paid');
    expect(PAY_STATE.paid.label).toBe('Paid');
  });

  it('fee status labels', () => {
    expect(feeStatusLabel('pending_approval').label).toBe('Waiting for admin approval');
    expect(feeStatusLabel('active').tone).toBe('green');
    expect(feeStatusLabel('rejected').tone).toBe('red');
  });

  it('cover period includes both ends', () => {
    expect(coverActive('2031-01-10', '2031-01-12', '2031-01-10')).toBe(true);
    expect(coverActive('2031-01-10', '2031-01-12', '2031-01-12')).toBe(true);
    expect(coverActive('2031-01-10', '2031-01-12', '2031-01-13')).toBe(false);
    expect(coverActive(null, '2031-01-12', '2031-01-11')).toBe(false);
  });
});
