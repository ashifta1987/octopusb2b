import { describe, expect, it } from 'vitest';
import { brandMoves, brandStatusError, brandDestination } from '@/lib/brand-projects';

/** Bug 2 (8 Nov 2026): which status controls Admin offers (the database enforces the same rules). */
describe('brandMoves', () => {
  it('open project: every other step, plus Close (needs a reason)', () => {
    const m = brandMoves({ status: 'submitted', closed_from: null, paid: false }, false);
    expect(m.map((x) => x.to)).toEqual(['proof', 'sample', 'quoted', 'production', 'stocked', 'closed']);
    expect(m.find((x) => x.to === 'closed')).toMatchObject({ needsReason: true, disabled: undefined });
  });
  it('paid project: Close is admin only', () => {
    expect(brandMoves({ status: 'quoted', closed_from: null, paid: true }, false).find((x) => x.to === 'closed')?.disabled).toMatch(/only an admin/);
    expect(brandMoves({ status: 'quoted', closed_from: null, paid: true }, true).find((x) => x.to === 'closed')?.disabled).toBeUndefined();
  });
  it('closed project: only an admin can reopen, and only to the step it was closed from', () => {
    expect(brandMoves({ status: 'closed', closed_from: 'sample', paid: false }, false)).toEqual([]);
    expect(brandMoves({ status: 'closed', closed_from: 'sample', paid: false }, true)).toEqual([{ to: 'sample', label: 'Reopen → Sample', needsReason: false, reopen: true }]);
  });
  it('database rule codes become plain messages', () => {
    expect(brandStatusError('REASON_REQUIRED: give an internal reason for closing')).toBe('Give an internal reason for closing.');
    expect(brandStatusError('ADMIN_ONLY_PAID: payment received on this project — only an admin can close it')).toMatch(/^Payment received/);
  });
  it('stock destination', () => {
    expect(brandDestination({ stock_destination: 'bulk', bulk_country: 'AU' })).toBe('Bulk to Australia');
    expect(brandDestination({ stock_destination: 'warehouse', bulk_country: null })).toBe('Octopus warehouse');
  });
});

